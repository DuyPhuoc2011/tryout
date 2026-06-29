"""TICKET AGENT-1: wire up a tool.

Implement:
  - WEATHER_TOOL: a tool schema dict with keys "name" == "get_weather",
    "description" (non-empty), and "input_schema" requiring a string "city".
  - run_tool(name, arguments): dispatch "get_weather" to get_weather(city);
    raise UnknownToolError for any other name.
  - get_weather(city): return f"Weather in {city}: sunny, 24C".

Do NOT change the test file. Make the tests pass.
"""
from __future__ import annotations

from typing import Any


class UnknownToolError(Exception):
    pass


WEATHER_TOOL: dict[str, Any] = {}


def get_weather(city: str) -> str:
    raise NotImplementedError("Implement get_weather() — see the ticket docstring.")


def run_tool(name: str, arguments: dict[str, Any]) -> str:
    raise NotImplementedError("Implement run_tool() — see the ticket docstring.")
