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

The pytest suite injects a fake LLM client with recorded/scripted responses. Tests assert:
request correctness, error handling, tool wiring, guard behavior — all deterministic.

**Important — how grading actually works in this engine (corrected after reading the code):**
`grading.service` does NOT run the test suite. The flow is:
1. The candidate repo's **own CI** (GitHub Actions) runs its pytest suite → `poll-ci`
   records `ciStatus` = `success`/`failure`.
2. `grading.service.gradeRun()` makes an **LLM grader call** — fed the rubric, ground_truth,
   the transcript, the review thread, the PR diff, and that `ciStatus` string — and the LLM
   returns the scores. `def.grading.hidden_acceptance_suite` is referenced but read by no code.

So the mock-LLM trick buys a **deterministic CI signal**, not a deterministic *grade*: the
final score is still an anchored LLM judgment. That is acceptable for this slice (decision
2026-06-29). A true suite-run grader (score the technical dimension from real pass/fail
counts) is deferred. **Reference-gate still applies**: each suite must pass a known-good
reference solution (green CI) before going live.

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

Most of the engine is reused. Two engine changes are required (discovered when reading the
code — the first draft under-counted these). Everything else is new content.

**Reused unchanged:**
- Intake "Sam" (stack/level chat) — `IntakeModule`
- `scenarioRuns` orchestration — `scenario-runs.service.ts`
- PM + senior persona engine — `agents/pm.service.ts`, `agents/senior-review.service.ts`
- Judge — `grading.service` (LLM grader; see grading section)
- Scorecard

**Engine changes (required):**
- **E1 — Per-scenario template repo.** `github.service.createRepoFromTemplate(userId)` uses a
  single `GITHUB_TEMPLATE_REPO` env var and ignores the scenario. Thread the scenario's
  `repo.template_ref` through so the Python template provisions for these scenarios while the
  NestJS one still works for scenario-01.
- **E2 — Repeatable review loop (retry-to-learn).** Today `poll-pr` inserts one submission on
  the first PR and stops; `poll-ci` polls only the first `headSha`. Fixes pushed after a
  review are never re-detected. After a review posts, re-arm polling for the next commit
  (new `headSha`) → new submission → new review. This is what makes "fix and resubmit" real.

**New content:**
1. **2 scenario definitions** (parts A/D/E/F — stack-agnostic): agent-domain tickets +
   clarification answer keys + weighted rubrics + PM/senior persona answer keys, seeded into
   a new `ai-agents` track.
2. **1 Python template repo** (part B): agent skeleton — installs, CI green on clean checkout,
   pytest wired, a fake-LLM-client test helper provided to the student. Must exist as a real
   GitHub template repo for `createRepoFromTemplate` to clone.
3. **Visible acceptance tests (part C)**, Python/pytest, mocking the LLM. (Not separately
   "hidden-injected" — no such mechanism exists; they ship in the template and drive CI. The
   reference-gate is: a known-good solution makes them green.)

## The two scenarios (parts A + C concretely)

### Rung 0 — "Wire up the model"
- **Ticket (A):** Implement a function that calls Claude with a structured-output
  requirement and handles timeout + error paths. Ticket is intentionally vague on edge
  cases (teaches asking the clarifying question — the professional signal).
- **Acceptance tests (C):** Inject a fake SDK client. Assert request shape (model, messages,
  structured-output config), success parsing, and each error/timeout path.

### Rung 1 — "Give it a tool"
- **Ticket (A):** Add a tool — define its schema, wire function-calling, execute the tool,
  return the result to the model loop.
- **Acceptance tests (C):** Feed a fixed `tool_use` response. Assert the tool schema validates,
  the tool is invoked with the correct arguments, and the result is returned correctly.

## Teaching flip — detail

Reality check (corrected): the run is already **not** auto-terminal — nothing sets it to
`complete` on `request_changes`; grading only runs when the candidate explicitly requests it.
The missing piece is purely E2: the review loop is one-shot, so a student's fix is never
re-reviewed. Once E2 lands, "fix and resubmit" works:

- Review verdict carries **teaching feedback** (already produced by `senior-review.service`).
- Student pushes a fix → E2 re-arm detects the new commit → new submission → re-review.
- Loop repeats until the student requests grading (their choice) or CI is green and the
  senior approves.
- The scorecard is a **growth artifact**, not a pass/fail gate.

(`ponytail`: E2 is the whole flip — re-arm the existing poll loop, no new state machine, no
attempt-level scoring table yet. Add per-attempt scoring later only if the growth narrative
needs it.)

## Error handling

- Template repo must install and pass CI green on clean checkout (part B invariant).
- Acceptance tests must pass the reference solution (green CI) before going live (reference-gate).
- The fake-LLM test helper must fail with a clear, teaching-oriented message when the student
  hasn't wired the injectable client, not an opaque stack trace.
- E1/E2 must not break scenario-01: the NestJS template still provisions, and a one-shot run
  (no fixes pushed) still completes exactly as today.
- GitHub/CI failures reuse the existing graceful-failure path (no orphan runs — already in place).

## Testing

- **Reference-gate:** the acceptance tests run against the known-good reference and pass (green CI).
- **Negative gate:** the acceptance tests run against a deliberately-broken reference and fail
  (proves the suite discriminates — guards against a suite that passes everything).
- **E1 regression:** scenario-01 still provisions its NestJS template (env fallback intact).
- **E2 regression:** a run where no fix is pushed behaves exactly as today (one review, no loop).
- **Engine regression:** existing API unit + e2e suites stay green.

## Open decisions

- Python agent SDK/framework for the template: raw `anthropic` SDK vs a thin framework.
  Lean raw SDK for rungs 0–1 (teaches fundamentals, fewer moving parts; `ponytail`: add a
  framework only when a rung needs what it provides).
- Candidate-acquisition channel for the learner audience (cold start) — out of scope here,
  but the first real-world risk after the slice works.
- Monetization model (juniors are broke) — deferred; revisit once the learning loop retains users.
