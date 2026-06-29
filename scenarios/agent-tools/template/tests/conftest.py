from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import pytest


@dataclass
class _Block:
    text: str


@dataclass
class _Response:
    content: list[_Block]


class FakeLlmClient:
    """Records the last call and returns a scripted response (or raises)."""

    def __init__(self, *, responder: Callable[..., Any]) -> None:
        self._responder = responder
        self.last_call: dict[str, Any] | None = None

    def create_message(self, **kwargs: Any) -> Any:
        self.last_call = kwargs
        return self._responder(**kwargs)


@pytest.fixture
def make_client():
    def _make(responder: Callable[..., Any]) -> FakeLlmClient:
        return FakeLlmClient(responder=responder)

    return _make
