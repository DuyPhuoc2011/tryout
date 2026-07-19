from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from tutor_agent.graph import build_graph, system_prompt
from tutor_agent.models import Scenario
from tutor_agent.tools import make_tools
from tests.fakes import FakeToolModel, tool_call

SCENARIO = Scenario(
    title="Disk full",
    tutor_brief="fault: disk fills\n\ndetection: alert on 90% usage\n\nmitigation: rotate logs",
)


def run(agent_msgs, phase, judge=None, message="go"):
    model = FakeToolModel(responses=agent_msgs)
    tools = make_tools(SCENARIO.tutor_brief, judge_model=judge or model)
    graph = build_graph(model, tools)
    messages = [SystemMessage(system_prompt(phase, SCENARIO)), HumanMessage(message)]
    return graph.invoke(
        {"messages": messages, "phase": phase, "reply": "", "next_phase": phase}
    )


def test_reply_and_phase_stay_when_no_control_line():
    out = run([AIMessage("What symptoms do you see so far?")], "orient")
    assert out["reply"] == "What symptoms do you see so far?"
    assert out["next_phase"] == "orient"


def test_control_line_advances_phase_and_is_stripped():
    out = run([AIMessage("Good, move on.\nNEXT_PHASE: detect")], "orient")
    assert out["next_phase"] == "detect"
    assert "NEXT_PHASE" not in out["reply"]
    assert out["reply"].strip().endswith("move on.")


def test_invalid_control_phase_is_ignored():
    out = run([AIMessage("ok\nNEXT_PHASE: bogus")], "detect")
    assert out["next_phase"] == "detect"
    assert "NEXT_PHASE" not in out["reply"]


def test_tool_call_runs_tool_then_replies():
    # First turn: model asks for the runbook; ToolNode runs it; model then replies.
    out = run(
        [
            tool_call("lookup_runbook", {"query": "detection signals"}),
            AIMessage("Check the 90% usage alert."),
        ],
        "detect",
    )
    assert out["reply"] == "Check the 90% usage alert."
    # tool output landed in the transcript between the two AI messages
    contents = [m.content for m in out["messages"]]
    assert any("alert on 90% usage" in c for c in contents)
