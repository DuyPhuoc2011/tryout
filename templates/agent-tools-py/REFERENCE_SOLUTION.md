# Reference solution (gate only — do not ship in the student template)

`agent/tools.py`:

```python
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
```
