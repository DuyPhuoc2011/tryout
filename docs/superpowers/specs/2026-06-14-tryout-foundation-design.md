# Tryout — Foundation & Skeleton (M0) Design

> Scope: this design covers **M0 (Foundation & Skeleton)** from the build spec, plus the
> cross-cutting structure (monorepo, full data model, LLM router architecture) that every
> later milestone depends on. M1–M5 get their own spec → plan → implementation cycles.
>
> Source documents: `team-sim-spec-v1.md` (product/build spec), `scenario-01-archive-tasks.md`
> (the single v1 scenario).

---

## 1. Context

**Tryout** is a "do the job, not watch it" simulator. A junior backend engineer joins a
software team where every other role is an AI agent, gets assigned real work on a real GitHub
repo, ships a real pull request through real CI, and is graded on both the code **and** the
professional behavior around it (asking good questions, PR description quality, responding to
review).

The product's load-bearing principle: **realism comes from the real technical substrate (real
repo, real git, real PR, real CI), not from agents sounding human.** Build accordingly.

This design is the foundation only. It deliberately excludes agents, GitHub plumbing,
scenarios, and grading — those are M1–M4.

## 2. Locked decisions

| Area | Choice | Notes |
|---|---|---|
| LLM | Multi-provider, router picks per call by **agent role + task complexity** | Cheap tier for chat turns, strong tier for PR review / grading; provider failover; policy is config |
| ORM | **Drizzle** | Postgres; JSONB for scenario definition + repo metadata |
| Code env | **User's own local env + real GitHub** | No embedded IDE in v1 |
| Deadline | **Soft** | Tracked and surfaced, never hard-fails the run |
| Hosting | GCP Cloud Run | Matches author's stack |
| Queue | BullMQ (Redis) | Wired in infra at M0, used from M1+ for CI polling / grading |

## 3. Repo layout (pnpm monorepo)

A monorepo so shared types (scenario definition, API contracts) live in one place and both
apps consume them.

```
tryout/
├── apps/
│   ├── api/          # NestJS — backend, agents, GitHub integration, grading
│   └── web/          # Next.js (TS) — the experience UI
├── packages/
│   ├── db/           # Drizzle schema + migrations + client
│   ├── shared/       # shared types: scenario definition, API DTOs, enums
│   └── llm/          # provider-agnostic LLM router (architecture now, built at M2)
├── scenarios/        # authored scenarios (YAML) — scenario-01 lives here
├── templates/        # lumi-tasks-api template repo source
├── docker-compose.yml # local Postgres + Redis
└── pnpm-workspace.yaml
```

**Rationale:** `packages/shared` and `packages/db` are the spine — the Grader, the agents, and
the UI must agree on shapes. `scenarios/` and `templates/` are plain source files so authoring
is just editing git-tracked files, matching the spec's "prompts and ground truth in version
control, not the DB."

## 4. Data layer (Drizzle)

The **entire** Section 7 data model is defined up front, even though M0 only exercises
User/auth. The entities are stable and well-specified; defining them now avoids painful
migrations mid-build.

Entities (key fields per spec Section 7):

- **User** — id, email, auth fields, `organization_id` (nullable, reserved for cohorts), created_at.
- **Track** — id, name (only "backend" in v1).
- **Scenario** — id, track_id, title, version, `definition` (JSONB), status.
- **ScenarioRun** — id, user_id, scenario_id, status (`onboarding | in_progress | in_review | grading | complete`), started_at, deadline_at (nullable), repo metadata, created_at.
- **Repo** — link between a ScenarioRun and the real GitHub repo (url, default branch, PR number). May be folded into ScenarioRun.
- **AgentMessage** — id, scenario_run_id, agent_role (`pm | senior`), direction (`user | agent`), content, created_at.
- **Submission** — id, scenario_run_id, pr_url, ci_status, ci_results, created_at.
- **Review** — id, submission_id, agent_role (`senior`), comments, verdict (`approve | request_changes`), created_at.
- **Scorecard** — id, scenario_run_id, technical_score, technical_feedback, professional_score, professional_feedback, overall_feedback, created_at.

**Reserved but NOT built:** Organization, Cohort.

**JSONB:** `scenario.definition` and `scenario_run` repo metadata. Hidden test suite, rubric,
ground truth, and persona prompts stay server-side in `scenarios/` — never in a
client-readable column, never committed to the user's repo.

## 5. LLM router (architecture now, built at M2)

A single `packages/llm` interface so no vendor SDK leaks into the rest of the codebase.

```
generate(request: {
  role: 'pm' | 'senior' | 'grader',
  taskComplexity: 'chat' | 'review' | 'grade',
  messages,
  context,
  responseSchema?   // structured output for the grader
}) → result
```

- A **routing policy table** maps `(role, taskComplexity) → providerModel`, with a fallback
  chain per tier.
- A one-line PM reply hits the cheap tier; a PR review over a real diff or a structured
  grading call hits the strong tier. On primary-provider error, fail over to the next in chain.
- Policy is **config**, so cost/quality is retuned without touching call sites.
- Provider adapters (Anthropic / Gemini / OpenAI) each implement one small `ProviderAdapter`
  contract.

Built at M2 (when agents first need it); only the interface and folder exist before then.

## 6. M0 deliverable

- NestJS API boots; `/health` green; connects to Postgres via Drizzle.
- Next.js app with **intentional UI** (read the `frontend-design` skill before writing any UI,
  per the spec's hard rule 3): sign-up + log-in screens that do not look like a default template.
- Minimal auth — email/password to start, single OAuth provider swappable later.
- Local dev via `docker-compose` (Postgres + Redis, the latter ready for BullMQ from M1+).
- Deployable to Cloud Run.

**Out of M0 (deliberately):** agents, GitHub plumbing, scenarios, grading (M1–M4).

## 7. Error handling

- API: explicit error handling at boundaries; user-friendly messages in API responses, detailed
  context logged server-side. No silent failures.
- Auth: clear, non-leaking error messages (no "user exists" enumeration on signup).
- DB: migrations are the only schema-change path; no ad-hoc mutation.

## 8. Testing & verification

- **Unit:** auth service (hashing, token issuance), validation.
- **Integration:** signup/login API routes against a test Postgres.
- **E2E:** a user can sign up, log in, and hit an authenticated route — the M0 round trip.
- Verification gate before M1: E2E round trip passes; `/health` green against a real DB; app
  deploys to Cloud Run.

## 9. Out of scope (this spec)

M1 GitHub spine, M2 visible loop + agents, M3 conversations, M4 grading, M5 polish — each gets
its own spec. Also out for all of v1 per the product spec: other roles, scenario generation,
admin/cohort dashboards, certification, payments, multiplayer, mobile, embedded IDE.
