# Intake Agent — Design Spec

_Date: 2026-06-19_
_Status: Approved (design); implementation plan pending_

## Summary

Replace the project-catalog browse flow with a **free-form AI intake conversation**. A
recruiter/talent-lead persona ("Sam") interviews the candidate about their background,
strengths, and gaps — mirroring the feeling of joining a real company — then **matches**
them to the best-fit prebuilt scenario and hands them off to the team (PM Mai + Senior Alex).

This supersedes the in-progress "Project Catalog → Role → Team Formation" direction: the
user no longer browses and picks a project/role. The intake agent assesses and places them.

## Core decision: hybrid (prebuilt core + runtime matching)

The product's value rests on grading integrity: real repo, real CI, a defensible
ground-truth rubric, forced-review logic. Therefore scenarios are **prebuilt, tested,
version-controlled assets** — never generated at runtime.

Runtime personalization happens in two places that do **not** touch the gradable core:

1. **Matching** — the intake profile selects the best-fit scenario.
2. **Framing** — the matcher's rationale and the PM's intro are personalized to the
   candidate's gaps and goals.

So: runtime *selection + framing*, prebuilt *challenge + grading*.

Today only Scenario-01 is live, so the matcher always returns Scenario-01 — but the
matching + framing logic is real and ready to rank N scenarios with zero upstream rework.

## Experience arc

```
Sign in → land in onboarding chat with Sam (Talent Lead)
  Sam: free-form 1:1 — background, strengths, what you struggle with, goals
  (behind the scenes: structured profile extracted each turn)
  Sam (when read is good, OR turn-cap hit): "I think I know where you'll fit — want to see it?"
  Candidate confirms → assignment screen: scenario + why it fits + your role
  → "Meet your team" → /run, where Mai (PM) picks up with the ticket
```

Sam never reappears after handoff — recruiter → team, like real onboarding. The run
(Mai + Alex) is otherwise unchanged.

Persona name "Sam, Talent Lead" is a placeholder and may be renamed.

## Components

### IntakeService (new)

Mirrors the existing `AgentChatService` pattern: one synchronous LLM call per turn,
replays prior turns. Behaviour:

- **Per turn:** candidate message → Sam reply; both persisted. New persona prompt.
- **Profile extraction:** each turn the LLM also emits a structured `profile` patch
  (experience level, languages, strengths[], gaps[], goals, confidence). Merged into the
  stored profile. Free-form on the surface, structured underneath.
- **Ready signal:** Sam's reply carries a `readyToPlace` flag once profile `confidence`
  is high enough. UI then offers a "Show me where I fit" confirm.
- **Turn-cap backstop:** a fixed cap (default 12 turns) force-flips `readyToPlace` so the
  conversation cannot drag indefinitely.
- **Assignment:** on candidate confirm → matcher runs → creates the scenario run with the
  chosen scenario + role → transition into `/run`.

### ScenarioMatcher (new)

Thin abstraction: `match(profile) → { scenarioId, role, rationale }`.

- **Today:** one live scenario → always returns Scenario-01 + a role derived from the
  profile, plus an LLM-written `rationale` (e.g. "you're strong on API design but light on
  testing — this backend ticket stretches the testing muscle").
- **Later:** same interface ranks N scenarios by fit. No upstream rework.

Reads the existing `scenarios` table (filtered to `available = true`).

## Data model

New table `candidate_profiles` (one per intake session, tied to a user):

```
candidate_profiles
  id                 uuid pk
  userId             uuid → users.id (not null)
  scenarioRunId      uuid → scenario_runs.id (null until placed)
  experienceLevel    text        — LLM-assessed (e.g. junior | mid | senior)
  languages          jsonb       — string[]  e.g. ["typescript","python"]
  strengths          jsonb       — string[]
  gaps               jsonb       — string[]
  goals              text
  confidence         integer     — 0..100, drives readyToPlace
  transcript         jsonb       — full intake message list
  matchedScenarioId  uuid → scenarios.id (null until placed)
  matchedRole        text
  matchRationale     text
  createdAt          timestamptz default now()
```

The profile is **real signal**, reused twice downstream:

1. Feeds Mai's PM intro framing (she knows the candidate's gaps/goals).
2. Feeds the future **Tryout Record** ("came in strong on X, grew on Y").

First-class and persisted — not throwaway.

## API surface

```
POST   /intake                 → start or get the active intake session (creates candidate_profile)
POST   /intake/:id/messages    → send a turn; returns Sam reply + readyToPlace + profile snapshot
POST   /intake/:id/place       → run matcher, create scenario run, return runId
GET    /intake/:id             → resume an in-progress intake
```

- New `IntakeModule` (mirrors `AgentsModule` / `AgentChatService` wiring), JWT-guarded,
  ownership-checked, DTO-validated.
- New Sam persona prompt in the llm/prompts layer.

## Handoff into the run

- After confirm, the matcher result is persisted on the profile; `startRun` is called
  server-side with `{ scenarioId: matched, role: matched }`, reusing existing
  run-creation (repo create, pm-intro enqueue) untouched.
- The matched profile is passed into the PM intro context so **Mai's first message
  reflects the candidate's gaps** ("Sam mentioned testing is something you want to push on
  — this ticket's perfect for that").
- `/run` is otherwise unchanged. Sam does not appear there.

## What gets removed / changed

**Remove from the user-facing flow:**
- `ProjectCatalog`, `RolePicker`, `TeamFormation`, `CatalogFlow` components
- The `GET /scenarios` catalog-browse usage and the `getScenarios()` client call

**Keep:**
- `scenarios` table + seed (the matcher reads it; only the user-facing grid is dropped)
- `ResumeCard` / `RunCard` (active-run resume)
- `startRun` (now invoked post-intake, not from a picker)
- The already-shipped catalog DB work (migration `0001`, `team_roles`, `chosen_role`).
  `chosenRole` stays; role now comes from the matcher rather than a picker.

**Add:**
- `IntakeChat` component — the dashboard's new default for users with no active run.

## Testing

- **Unit:** `IntakeService` (turn handling, profile merge, `readyToPlace` flip, turn-cap),
  `ScenarioMatcher` (returns Scenario-01 + rationale).
- **E2E:** intake round-trip — start → messages → place → run created with the matched
  scenario/role. Mock `LLM_ROUTER` as in existing e2e suites.
- Maintain 80%+ coverage on new code.

## Scope guard

One focused build: intake module + profile table + matcher + dashboard swap. The Tryout
Record reuse of the profile is **noted, not built here** — it is a separate later spec.

## Out of scope

- Tryout Record / shareable artifact (separate spec)
- Multi-scenario authoring (matcher is ready but only Scenario-01 exists)
- Runtime scenario generation (explicitly rejected — grading integrity risk)
- Institution / cohort features
