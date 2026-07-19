from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage

from tutor_agent.app import app, model_provider
from tutor_agent.settings import settings
from tests.fakes import FakeToolModel, tool_call

client = TestClient(app)

BODY = {
    "scenario": {"title": "Disk full", "tutor_brief": "fault: disk fills"},
    "phase": "orient",
    "history": [],
    "message": "where do I start?",
}


def _use(responses):
    app.dependency_overrides[model_provider] = lambda: FakeToolModel(responses=responses)


def test_turn_rejects_bad_token():
    r = client.post("/agent/turn", json=BODY, headers={"X-Internal-Token": "wrong"})
    assert r.status_code == 401


def test_turn_happy_path_with_fake_model():
    _use([AIMessage("Start by reading the architecture.\nNEXT_PHASE: detect")])
    try:
        r = client.post(
            "/agent/turn",
            json=BODY,
            headers={"X-Internal-Token": settings.internal_token},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["phase"] == "detect"
        assert "NEXT_PHASE" not in data["reply"]
    finally:
        app.dependency_overrides.clear()


def test_turn_uses_tool_then_replies():
    _use(
        [
            tool_call("lookup_runbook", {"query": "start"}),
            AIMessage("Look at disk usage first."),
        ]
    )
    try:
        r = client.post(
            "/agent/turn",
            json=BODY,
            headers={"X-Internal-Token": settings.internal_token},
        )
        assert r.status_code == 200
        assert r.json()["reply"] == "Look at disk usage first."
    finally:
        app.dependency_overrides.clear()
