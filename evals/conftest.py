import os

import pytest

from client import api_up


def pytest_configure(config):
    config.addinivalue_line("markers", "judge: needs an LLM judge (OPENAI_* env set)")


@pytest.fixture(scope="session", autouse=True)
def require_api():
    """Skip the whole suite cleanly if the Tryout API isn't running."""
    if not api_up():
        pytest.skip("Tryout API not reachable (start the stack first).", allow_module_level=True)


def judge_model() -> str:
    return os.environ.get("JUDGE_MODEL", "llama-3.3-70b-versatile")


def judge_ready() -> bool:
    # deepeval's default metrics use the OpenAI client; point it at any
    # OpenAI-compatible endpoint (Groq/Gemini/OpenAI) via these env vars.
    return bool(os.environ.get("OPENAI_API_KEY"))
