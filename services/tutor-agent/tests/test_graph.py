from langchain_core.language_models.fake_chat_models import FakeListChatModel
from tutor_agent.graph import build_graph
from tutor_agent.models import Scenario, Turn


def run(model, phase, message, history=None):
    graph = build_graph(model)
    state = {
        "scenario": Scenario(title="Disk full", tutor_brief="fault: disk fills"),
        "phase": phase,
        "history": history or [],
        "message": message,
        "reply": "",
        "next_phase": phase,
    }
    return graph.invoke(state)


def test_reply_and_phase_stay_when_no_control_line():
    model = FakeListChatModel(responses=["What symptoms do you see so far?"])
    out = run(model, "orient", "I just started.")
    assert out["reply"] == "What symptoms do you see so far?"
    assert out["next_phase"] == "orient"


def test_control_line_advances_phase_and_is_stripped():
    model = FakeListChatModel(
        responses=["Good, you've oriented. Move on.\nNEXT_PHASE: detect"]
    )
    out = run(model, "orient", "I've read the architecture.")
    assert out["next_phase"] == "detect"
    assert "NEXT_PHASE" not in out["reply"]
    assert out["reply"].strip().endswith("Move on.")


def test_invalid_control_phase_is_ignored():
    model = FakeListChatModel(responses=["ok\nNEXT_PHASE: bogus"])
    out = run(model, "detect", "x")
    assert out["next_phase"] == "detect"
    assert "NEXT_PHASE" not in out["reply"]
