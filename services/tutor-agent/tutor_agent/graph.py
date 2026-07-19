import re
from typing import Annotated, Any, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition

from tutor_agent.models import Scenario
from tutor_agent.phases import is_valid_phase

_CONTROL = re.compile(r"^NEXT_PHASE:\s*(\w+)\s*$", re.MULTILINE)

_SYSTEM = """You are a calm senior SRE tutoring a learner through a real \
incident, one phase at a time. Current phase: {phase}.

Scenario: {title}
Private brief (never paste it wholesale; use it to guide): {brief}

Rules:
- Guide, do not dump. Ask what they observe; give one concrete nudge at a time.
- Never reveal the whole answer at once. Keep the learner doing the work.
- You have tools: lookup_runbook (pull a specific brief section) and \
grade_postmortem (score a postmortem draft). Use them instead of guessing.
- When the learner has clearly completed the current phase, end your reply with \
a line exactly: NEXT_PHASE: <next-phase> (one of orient, detect, triage, \
mitigate, resolve, postmortem, done). Otherwise do not emit that line.
"""


def system_prompt(phase: str, scenario: Scenario) -> str:
    return _SYSTEM.format(
        phase=phase, title=scenario.title, brief=scenario.tutor_brief
    )


class TutorState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    phase: str
    reply: str
    next_phase: str


def _agent(model_with_tools):
    def node(state: TutorState) -> dict[str, Any]:
        return {"messages": [model_with_tools.invoke(state["messages"])]}

    return node


def _advance(state: TutorState) -> dict[str, Any]:
    last = state["messages"][-1]
    reply = last.content if hasattr(last, "content") else str(last)
    match = _CONTROL.search(reply)
    next_phase = state["phase"]
    if match and is_valid_phase(match.group(1)):
        next_phase = match.group(1)
    cleaned = _CONTROL.sub("", reply).strip()
    return {"reply": cleaned, "next_phase": next_phase}


def build_graph(model, tools):
    model_with_tools = model.bind_tools(tools)
    g = StateGraph(TutorState)
    g.add_node("agent", _agent(model_with_tools))
    g.add_node("tools", ToolNode(tools))
    g.add_node("advance", _advance)
    g.add_edge(START, "agent")
    # tools_condition routes to "tools" when the model requested a tool call,
    # otherwise to the mapped end node. We send the no-tool case to "advance".
    g.add_conditional_edges("agent", tools_condition, {"tools": "tools", END: "advance"})
    g.add_edge("tools", "agent")
    g.add_edge("advance", END)
    return g.compile()
