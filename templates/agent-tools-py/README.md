# Agent Tools — Ticket AGENT-1

The summarizer works. Now the agent needs to *use a tool*. Your ticket: implement
`agent/tools.py` — define the `get_weather` tool schema and a dispatcher that runs
the right tool when the model asks for it (and refuses unknown tools). The
acceptance tests in `tests/` describe the contract — make them pass, open a PR, and
the senior engineer will review it.

## Run the tests

```
pip install -e ".[dev]"
pytest -q
```

The tests mock the LLM — you assert on the tool wiring, not on model output.
