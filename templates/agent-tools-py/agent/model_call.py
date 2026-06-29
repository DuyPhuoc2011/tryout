"""The model call from AGENT-0, already implemented. Don't change this file —
your ticket (AGENT-1) is about tools, in agent/tools.py.
"""
from __future__ import annotations

from .llm_client import LlmClient

MODEL = "claude-haiku-4-5"
MAX_TOKENS = 256


class SummarizationError(Exception):
    pass


def summarize(client: LlmClient, text: str) -> str:
    try:
        response = client.create_message(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": f"Summarize in one sentence:\n\n{text}"}],
        )
    except Exception as exc:  # noqa: BLE001 - wrap any client failure
        raise SummarizationError(str(exc)) from exc
    if not getattr(response, "content", None):
        raise SummarizationError("model returned no content")
    return response.content[0].text.strip()
