# Agent Foundations — Ticket AGENT-0

Your team is building an AI summarizer. Your first ticket: implement `summarize()`
in `agent/model_call.py`. The acceptance tests in `tests/` already describe the
behavior — make them pass, open a PR, and the senior engineer will review it.

## Run the tests

```
pip install -e ".[dev]"
pytest -q
```

The tests mock the LLM — you never call the real API to pass them. That's deliberate:
real agents are tested against a fake model so the tests are fast and deterministic.
