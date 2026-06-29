# Tryout → Agent-Building Trainer — Design (Vertical Slice)

> Written 2026-06-29.
> Pivot of Tryout from two-sided hiring screen → a training product that teaches
> fresh/junior devs to build AI agents.
> Companion to `docs/tryout-strategy.md` (prior direction) and `docs/team-sim-spec-v1.md` (engine spec).
> This document specs the **first vertical slice only** — see Scope.

## The pivot

Tryout today: a candidate gets a real repo + ticket, builds, AI teammates (PM, senior
engineer) review the PR, a judge scores tech + professional behavior. Sold as a hiring screen.

The two-sided hiring direction is shelved (cold-start: needs candidates AND companies at once).
New direction: **keep the engine, swap the subject and the goal.**

- **Subject:** the task a student does is now *building an AI agent* — not a generic backend ticket.
- **Goal:** teaching, not gatekeeping. The verdict is no longer terminal; the student fixes
  and resubmits, the mentor re-reviews, the scorecard becomes a growth artifact.

One audience (learners), not two. Distribution is still cold, but only one side to seed.

## What the student walks away able to do

Build a real, reliable AI agent — not just chat with an API. The full curriculum is a
ladder of skills, each delivered as a Tryout scenario (task + mentor review, retry to learn).

### The skill ladder (full target — most rungs are deferred, see Scope)

| # | Scenario (what they build) | Skill taught | How it's graded (deterministic) |
|---|---|---|---|
| 0 | **Call the model** — one Claude API call, structured output, handle errors/timeouts | claude-api basics, prompt/context | Mock SDK → assert request shape + error handling |
| 1 | **Give it a tool** — define a tool schema, wire function-calling, execute, return result | tool/function-calling design | Fixed model response → assert tool invoked w/ right args, schema validates |
| 2 | **Make it reliable** — retry + timeout + cost/budget guard + logging | cost-aware pipeline, harness | Inject failures/expensive calls → assert guard fires |
| 3 | **Give it knowledge** — RAG over a fixed corpus, retrieve + inject context | retrieval | Fixed query → assert correct chunks retrieved |
| 4 | **Prove it works** — write an eval harness, catch a planted regression | eval-driven dev | Plant a known-bad output → assert eval flags it |
| 5 | **Orchestrate** — planner→worker or a loop with a stop condition | multi-agent orchestration | Scripted responses → assert trajectory + termination |
| 6 | **Capstone** — ship a small real agent (MCP server or CLI agent) end-to-end | shipping to prod | Behavioral suite, like Tryout today |

The ladder merges the agent-building fundamentals (prompt/context, tool calling,
orchestration, RAG/eval/cost, shipping) with ECC skills as source material
(`claude-api`, `agent-harness-construction`, `cost-aware-llm-pipeline`, `eval-harness`,
`mcp-server-patterns`).

## The core grading bet

AI agents are non-deterministic — "is the agent good" is fuzzy, and the strategy doc
warns hard against shipping a hidden suite that scores on LLM vibes (a wrong suite kills
trust). The resolution:

**Agent code has deterministic seams even though the LLM does not. Grade the engineering
*around* the model, with the LLM mocked/fixed — never the model's output quality.**

The hidden suite injects a fake LLM client with recorded/scripted responses. Tests assert:
request correctness, error handling, tool wiring, guard behavior, retrieval correctness,
control-flow termination. All deterministic. This reuses the existing `grading.service`
(reads `rubric` + `ground_truth` from scenario JSON, grades behavior) almost unchanged.

**Reference-gate still applies** (strategy doc §"trust enough to sell"): each hidden suite
MUST pass a known-good reference solution before going live. Never ship a hidden suite blind.

## Scope — this slice

Prove the bet with the smallest end-to-end slice before mass-authoring:

**In scope:** Rungs 0 + 1, in **one stack (Python first)**.

This validates, end-to-end: the mock-LLM grading bet, the retry-to-learn loop, and the
PM/senior personas operating in the agent domain — before committing to authoring 7
hidden suites or porting to multiple stacks.

**Deferred (Phase 2+):** Rungs 2–6; multi-stack port (student picks stack at intake —
author A/D/E/F once, port B+C per stack, per strategy doc); intake rewording & marketing;
monetization.

### Stack decision

Python is the first *authored* stack (largest junior-AI audience; the ecosystem, jobs, and
tutorials are Python-first). TypeScript is the documented **port target** for a later phase.
Student stack-choice at intake is a Phase-2 concern; this slice authors Python only.

## Architecture — reused vs new

The engine is reused as-is. Only scenario content + one behavioral change are new.

**Reused unchanged:**
- Intake "Sam" (stack/level chat) — `IntakeModule`
- `scenarioRuns` orchestration — `scenario-runs.service.ts`
- PM + senior persona engine — `agents/pm.service.ts`, `agents/senior-review.service.ts`
- GitHub repo loop — `github.service.ts` (template → candidate repo)
- PR → CI → review pipeline — `queue/processors/poll-pr`, `poll-ci`, `review` processor
- Judge — `grading.service` (reads `rubric` + `ground_truth` from scenario JSON)
- Scorecard

**New:**
1. **2 scenario definitions** (parts A/D/E/F — stack-agnostic): agent-domain tickets +
   clarification answer keys + weighted rubrics + PM/senior persona answer keys.
2. **1 Python template repo** (part B): agent skeleton — compiles, CI green on clean
   checkout, pytest wired, a fake-LLM-client test helper provided to the student.
3. **2 hidden suites** (part C, Python/pytest): LLM mocked, assert the engineering. Each
   reference-gated against a known-good solution.
4. **Retry-to-learn flip** (the one behavioral change): review verdict is no longer
   terminal. Student fixes + resubmits; re-review runs; scorecard tracks improvement
   across attempts.

## The two scenarios (parts A + C concretely)

### Rung 0 — "Wire up the model"
- **Ticket (A):** Implement a function that calls Claude with a structured-output
  requirement and handles timeout + error paths. Ticket is intentionally vague on edge
  cases (teaches asking the clarifying question — the professional signal).
- **Hidden suite (C):** Inject a fake SDK client. Assert request shape (model, messages,
  structured-output config), success parsing, and each error/timeout path.

### Rung 1 — "Give it a tool"
- **Ticket (A):** Add a tool — define its schema, wire function-calling, execute the tool,
  return the result to the model loop.
- **Hidden suite (C):** Feed a fixed `tool_use` response. Assert the tool schema validates,
  the tool is invoked with the correct arguments, and the result is returned correctly.

## Teaching flip — detail

Today: the first submission is forced to `request_changes` and the run is effectively done.

New behavior:
- Review verdict carries **teaching feedback** (already produced by `senior-review.service`).
- The run is **not** marked done on `request_changes`. The student fixes and resubmits.
- Re-review runs on the new PR state; the loop repeats until the student chooses to stop
  or the hidden suite passes.
- The scorecard is a **growth artifact** — shows improvement across attempts — not a
  pass/fail gate.

This is a minimal change: the feedback path exists; we stop treating the run as terminal on
`request_changes`. (`ponytail`: keep it simple — non-terminal verdict + resubmit, no new
state machine; add attempt-level scoring later if the growth narrative needs it.)

## Error handling

- Template repo must compile and pass CI green on clean checkout (part B invariant).
- Hidden suite must pass the reference solution before going live (reference-gate).
- Mock-LLM helper failures (e.g. student didn't wire the injectable client) must produce a
  clear, teaching-oriented failure message, not an opaque stack trace.
- GitHub/CI failures reuse the existing graceful-failure path (no orphan runs — already in place).

## Testing

- **Reference-gate:** each hidden suite runs against the known-good reference and must pass.
- **Negative gate:** each hidden suite runs against a deliberately-broken reference and must
  fail (proves the suite actually discriminates — guards against a suite that passes everything).
- **Engine regression:** existing API unit + e2e suites must stay green (the engine is reused;
  this slice must not break it).

## Open decisions

- Python agent SDK/framework for the template: raw `anthropic` SDK vs a thin framework.
  Lean raw SDK for rungs 0–1 (teaches fundamentals, fewer moving parts; `ponytail`: add a
  framework only when a rung needs what it provides).
- Candidate-acquisition channel for the learner audience (cold start) — out of scope here,
  but the first real-world risk after the slice works.
- Monetization model (juniors are broke) — deferred; revisit once the learning loop retains users.
