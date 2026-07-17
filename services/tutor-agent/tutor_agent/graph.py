import re
from typing import Any, TypedDict

from langgraph.graph import StateGraph, START, END

from tutor_agent.models import Scenario, Turn
from tutor_agent.phases import is_valid_phase

_CONTROL = re.compile(r"^NEXT_PHASE:\s*(\w+)\s*$", re.MULTILINE)

_SYSTEM = """You are a calm senior SRE tutoring a learner through a real \
incident, one phase at a time. Current phase: {phase}.

Scenario: {title}
Private brief (never paste it wholesale; use it to guide): {brief}

Rules:
- Guide, do not dump. Ask what they observe; give one concrete nudge at a time.
- Never reveal the whole answer at once. Keep the learner doing the work.
- When the learner has clearly completed the current phase, end your reply with \
a line exactly: NEXT_PHASE: <next-phase> (one of orient, detect, triage, \
mitigate, resolve, postmortem, done). Otherwise do not emit that line.
"""


class TutorState(TypedDict):
    scenario: Scenario
    phase: str
    history: list[Turn]
    message: str
    reply: str
    next_phase: str


def _respond(model):
    def node(state: TutorState) -> dict[str, Any]:
        sys = _SYSTEM.format(
            phase=state["phase"],
            title=state["scenario"].title,
            brief=state["scenario"].tutor_brief,
        )
        messages: list[tuple[str, str]] = [("system", sys)]
        for turn in state["history"]:
            role = "assistant" if turn.role == "assistant" else "user"
            messages.append((role, turn.content))
        messages.append(("user", state["message"]))
        result = model.invoke(messages)
        text = result.content if hasattr(result, "content") else str(result)
        return {"reply": text}

    return node


def _advance(state: TutorState) -> dict[str, Any]:
    reply = state["reply"]
    match = _CONTROL.search(reply)
    next_phase = state["phase"]
    if match and is_valid_phase(match.group(1)):
        next_phase = match.group(1)
    cleaned = _CONTROL.sub("", reply).strip()
    return {"reply": cleaned, "next_phase": next_phase}


def build_graph(model):
    g = StateGraph(TutorState)
    g.add_node("respond", _respond(model))
    g.add_node("advance", _advance)
    g.add_edge(START, "respond")
    g.add_edge("respond", "advance")
    g.add_edge("advance", END)
    return g.compile()
