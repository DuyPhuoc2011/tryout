from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from tutor_agent.app import app, model_provider
from tutor_agent.settings import settings

client = TestClient(app)

BODY = {
    "scenario": {"title": "Disk full", "tutor_brief": "fault: disk fills"},
    "phase": "orient",
    "history": [],
    "message": "where do I start?",
}


def test_turn_rejects_bad_token():
    r = client.post("/agent/turn", json=BODY, headers={"X-Internal-Token": "wrong"})
    assert r.status_code == 401


def test_turn_happy_path_with_fake_model():
    app.dependency_overrides[model_provider] = lambda: FakeListChatModel(
        responses=["Start by reading the architecture.\nNEXT_PHASE: detect"]
    )
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
