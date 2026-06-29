"""TICKET AGENT-1: wire up a tool."""
from __future__ import annotations

from typing import Any


class UnknownToolError(Exception):
    pass


WEATHER_TOOL: dict[str, Any] = {
    "name": "get_weather",
    "description": "Get the current weather for a city.",
    "input_schema": {
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"],
    },
}


def get_weather(city: str) -> str:
    return f"Weather in {city}: sunny, 24C"


def run_tool(name: str, arguments: dict[str, Any]) -> str:
    if name == "get_weather":
        return get_weather(arguments["city"])
    raise UnknownToolError(name)
