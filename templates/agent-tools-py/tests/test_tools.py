from __future__ import annotations

import pytest

from agent.tools import WEATHER_TOOL, UnknownToolError, run_tool


def test_tool_schema_shape():
    assert WEATHER_TOOL["name"] == "get_weather"
    assert WEATHER_TOOL["description"]
    schema = WEATHER_TOOL["input_schema"]
    assert schema["type"] == "object"
    assert "city" in schema["properties"]
    assert schema["properties"]["city"]["type"] == "string"
    assert "city" in schema["required"]


def test_run_tool_dispatches_get_weather():
    # Simulates the arguments the model would emit in a tool_use block.
    tool_use = {"name": "get_weather", "input": {"city": "Hanoi"}}
    result = run_tool(tool_use["name"], tool_use["input"])
    assert "Hanoi" in result


def test_run_tool_rejects_unknown_tool():
    with pytest.raises(UnknownToolError):
        run_tool("delete_database", {})
