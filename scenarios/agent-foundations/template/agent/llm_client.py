"""The LLM seam. Tests inject a fake; production uses Anthropic.

Keep all real network access behind this Protocol so the rest of the agent is
deterministically testable.
"""
from __future__ import annotations

from typing import Any, Protocol


class LlmClient(Protocol):
    def create_message(self, *, model: str, max_tokens: int, messages: list[dict[str, Any]]) -> Any:
        """Return an object exposing `.content` (a list of content blocks)."""
        ...


class AnthropicClient:
    """Thin real client. Not exercised in tests."""

    def __init__(self, api_key: str) -> None:
        import anthropic

        self._client = anthropic.Anthropic(api_key=api_key)

    def create_message(self, *, model: str, max_tokens: int, messages: list[dict[str, Any]]) -> Any:
        return self._client.messages.create(model=model, max_tokens=max_tokens, messages=messages)
