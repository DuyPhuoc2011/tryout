# Sam intake evals (DeepEval)

Black-box evals for the Sam intake agent. They drive the **running** Tryout API
over HTTP, so this Python harness stays decoupled from the TS app.

## What's here

| File | What it checks | Needs a judge? |
|------|----------------|----------------|
| `test_profile.py` | Profile extraction: languages, strengths, gaps, goals, confidence climb | No (deterministic) |
| `test_conversation.py` | Multi-turn quality: knowledge retention, focused follow-ups, role adherence | Yes (LLM judge) |
| `personas.py` | Golden candidate scripts + expected fields | — |
| `client.py` | HTTP driver for the intake endpoints | — |

## Setup

```bash
cd evals
python -m venv .venv
. .venv/Scripts/activate        # Windows git-bash;  use .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
```

## Run

Start the stack first (`start tryout` — API must be on :3001 with a working LLM provider).

```bash
# Deterministic profile checks only (no judge, free):
TRYOUT_API=http://localhost:3001 deepeval test run test_profile.py

# Everything, including LLM-judged conversation quality:
export OPENAI_BASE_URL=https://api.groq.com/openai/v1   # reuse your free Groq endpoint
export OPENAI_API_KEY=<groq-key>
export JUDGE_MODEL=llama-3.3-70b-versatile
deepeval test run .
```

Plain `pytest` also works (`pytest -v`); `deepeval test run` adds metric reporting.

## Notes

- **API must be up** with a working `LLM_PROVIDER`; the suite auto-skips if `/health` is unreachable.
- **Judge model matters.** A cheap/free judge (Groq) is fine for smoke-testing but noisy
  for real scoring — use a stronger judge (Claude/GPT) when comparing models seriously.
- **Rate limits.** Each persona = ~4 live LLM turns against your provider; on free Groq,
  large runs will hit 429s. Keep persona count small or use a paid provider for full runs.
- Throwaway users (`eval-*@tryout.dev`) and their profiles accumulate in the DB; clear them
  periodically if they clutter.
- `deepeval` API can shift between majors — if an import breaks, check the installed version.
