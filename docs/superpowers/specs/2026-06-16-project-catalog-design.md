# Design: Project Catalog → Role → Team Formation

**Date:** 2026-06-16
**Status:** Implemented & verified (2026-06-16)

## Implementation status

All sections below are built, migrated, seeded, and verified end-to-end.

- **DB:** migration `0001_flaky_ink` (enums `project_type`/`team_role_category`, `team_roles` table, `scenarios.project_type`/`available`, `scenario_runs.chosen_role`) applied to the live DB.
- **Seeds:** scenario-01 backfilled (`backend_monolith`, available); 8 team roles; 4 "coming soon" scenarios (one per remaining type). Idempotent.
- **API:** `ScenariosModule` (`GET /scenarios`, `GET /scenarios/:id`); `POST /scenario-runs` takes `{ scenarioId, role }` with availability + selectable-role validation; `GET /scenario-runs/:id` returns `chosenRole` + resolved roster (seat flagged `isYou`).
- **Shared:** `ProjectType`, `TeamRoleCategory`, `ScenarioCatalogItem`, `TeamSeatView`, `ScenarioDetailView`; `ScenarioDefinition.team`/`catalog`.
- **Web:** `/dashboard` `CatalogFlow` (catalog → role → team) + `ResumeCard` for active runs.

Verification: API unit 29/29, e2e 28/28 (incl. `scenarios.e2e-spec.ts`), workspace build clean. Live smoke: catalog lists 1 playable + 4 coming-soon; run-start rejects unavailable scenario (400) and non-selectable role (400).

## Goal

Replace the dashboard's single "Start a tryout" action with a guided flow:

1. Browse a **catalog** of scenario projects spanning diverse project types.
2. **Pick a project.**
3. **Pick your role** (who you are on the team).
4. **Build your team** — the remaining seats are filled with AI teammates (a visual roster).
5. **Start** → provisions the run for the chosen scenario + role → `/run`.

## Scope decisions (from brainstorm)

- **Full backend model**, but the **team is a visual roster** — runtime chat stays PM (Mai) + Senior (Alex). No per-role agent behavior or grading-by-role yet.
- **Browsable catalog + availability flag**: show diverse types; only `backend_monolith` (lumi-tasks-api) is playable now. Others render as "Coming soon" and cannot start a run.
- **Data lives in the DB** (scenarios extended; roles/seats modeled), served via API.
- **Flow lives on `/dashboard`** (the cleared canvas). Active run → compact resume card; otherwise → catalog flow.

### Deferred (explicitly out of scope)

Per-role agent behavior, grading-by-role, real template repos for non-backend types, distinct interactive agents beyond Mai/Alex.

## Data model (`packages/db`)

New enums:
- `project_type`: `backend_monolith | microservices | frontend_web | mobile | desktop`
- `team_role_category`: `leadership | engineering | design | qa`

`scenarios` — add columns:
- `project_type` (`project_type`, not null, default `backend_monolith`)
- `available` (boolean, not null, default `false`)
- Catalog display fields (`summary`, `difficulty`, `tags`) live in `definition.catalog`.

`team_roles` — new seeded table:
- `id`, `key` (unique), `title`, `description`, `category`, `aiName` (nullable), `aiInitial` (nullable), `interactive` (bool), `selectableByCandidate` (bool), `sortOrder`.

`scenario_runs` — add `chosen_role` (text, nullable) — the role key the candidate claimed.

Each scenario's **team template** = `definition.team`: ordered array of role keys.

## Seeds

- Backfill scenario-01 with `projectType=backend_monolith`, `available=true`, `definition.catalog`, and `definition.team = [product_manager, engineering_manager, senior_engineer, backend_engineer, qa_engineer]`.
- Seed `team_roles`: product_manager (Mai, interactive), engineering_manager (Linh), senior_engineer (Alex, interactive), backend_engineer (selectable), frontend_engineer (selectable), mobile_engineer (selectable), qa_engineer (Tom), product_designer (Sara).
- Seed 4 "coming soon" scenarios (`available=false`), one per remaining project type, each with a catalog blurb + team template. Minimal definitions (no agent prompts/rubric needed — not runnable).
- All seeders idempotent.

## Backend (`apps/api`)

New `ScenariosModule` (guarded by `JwtAuthGuard`):
- `GET /scenarios` → `ScenarioCatalogItem[]`: `{ id, title, projectType, summary, difficulty, tags, available, companyName }`.
- `GET /scenarios/:id` → detail: catalog item + `team: TeamSeatView[]` (resolved from `team_roles`) + `selectableRoles: string[]`.

Extend `scenario-runs`:
- `POST /scenario-runs` accepts `CreateRunDto { scenarioId: uuid, role: string }`. Validates: scenario exists & `available`; `role` is a selectable seat in `scenario.definition.team`. Persists `chosenRole`. Uses the chosen scenario (replaces the hardcoded backend-track lookup).
- `GET /scenario-runs/:id` → also returns `chosenRole` + resolved `team` roster (chosen seat flagged `isYou`).

## Shared types (`@tryout/shared`)

- `ProjectType`, `TeamRoleCategory` unions.
- `ScenarioCatalogMeta { summary; difficulty; tags }`.
- `ScenarioCatalogItem`, `TeamSeatView`, `ScenarioDetailView`.
- Extend `ScenarioDefinition` with optional `team?: string[]` and `catalog?: ScenarioCatalogMeta`.

## Frontend (`apps/web`)

`lib/api.ts`: add `getScenarios()`, `getScenario(id)`; change `startRun(scenarioId, role)`.

`/dashboard` flow (small components, keep `page.tsx` lean):
- `CatalogFlow.tsx` — state machine over steps `catalog → role → team`.
- `ProjectCatalog.tsx` — cards grouped by project type; "Coming soon" badge disables unavailable ones.
- `RolePicker.tsx` — selectable seats for the chosen scenario ("Who are you?").
- `TeamFormation.tsx` — assembled roster, your seat highlighted as **You**, AI seats filled; **Start** CTA.
- Active run → compact resume card (restored minimal version of the old card).

## Testing

- API: unit/e2e for `GET /scenarios` (shape, availability) and run-start validation (rejects unavailable scenario / invalid role; accepts valid).
- Web: keep compiling; flow renders.

## Risks

- Migration adds enums + columns + table — must generate via drizzle-kit and run against the live DB (port 5432 currently).
- `POST /scenario-runs` body change is backwards-incompatible with the old no-arg call; web client updated in the same change.
