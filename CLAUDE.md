# Tryout — Claude Agent Guide

## What This Project Is

Tryout is an AI-powered technical interview platform. Candidates receive a real GitHub repo, implement a coding challenge, and interact with AI agents (PM, senior engineer) over simulated Slack/GitHub. The system grades both technical quality and professional communication.

## Monorepo Layout

```
H:\TRYOUT\
├── apps/
│   ├── api/          — NestJS 10 backend (port 3001)
│   └── web/          — Next.js 14 frontend (port 3000, App Router)
├── packages/
│   ├── db/           — Drizzle ORM schema, migrations, seed scripts
│   ├── shared/       — shared TypeScript types (AuthResponse, enums)
│   └── llm/          — provider-agnostic LLM router stub
├── templates/
│   └── lumi-tasks-api/  — the NestJS template repo candidates receive
└── docs/
    ├── superpowers/plans/  — implementation plans per milestone
    └── team-sim-spec-v1.md — full product spec
```

Package names: `@tryout/api`, `@tryout/web`, `@tryout/db`, `@tryout/shared`, `@tryout/llm`.

## Infrastructure

- **Package manager:** pnpm workspaces (always use `pnpm`, never `npm`/`yarn` in the monorepo root)
- **PostgreSQL 16:** Docker, port 5432, user/pass/db all `tryout`
- **Redis 7:** Docker, port 6379
- **Start infra:** `docker compose up -d`
- **pnpm store corruption:** if `has-flag` is missing, run `pnpm install --force`
- **Parallel builds corrupt the store:** always build with `--workspace-concurrency=1` when building everything: `pnpm -r --workspace-concurrency=1 build`

## Running the Stack

```bash
# 1. Start infra
docker compose up -d

# 2. Run migrations (first time or after schema changes)
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/db migrate

# 3. Seed the database (idempotent)
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/db seed

# 4. Start API (dev)
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout \
  REDIS_URL=redis://localhost:6379 \
  JWT_SECRET=dev \
  GITHUB_TOKEN=<your-pat> \
  GITHUB_OWNER=<your-org> \
  pnpm --filter @tryout/api start:dev

# 5. Start web (dev)
NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm --filter @tryout/web dev
```

## Key Source Files

### API (`apps/api/src/`)

| File | Purpose |
|------|---------|
| `app.module.ts` | Root NestJS module — imports DbModule, AuthModule, ScenarioRunsModule, AgentsModule |
| `config/env.ts` | All env var access — call `env.someVar` or `env.someVar()` for required vars |
| `db/db.module.ts` | Global Drizzle provider; inject with `@Inject(DRIZZLE) private db: Db` |
| `auth/auth.module.ts` | JWT auth — exports JwtModule + JwtAuthGuard for other modules to use |
| `auth/jwt-auth.guard.ts` | Guard + `AuthUser` interface (`{ sub: string, email: string }`) |
| `auth/current-user.decorator.ts` | `@CurrentUser()` param decorator — returns `AuthUser` |
| `llm/llm.module.ts` | Provides `LLM_ROUTER` token (a configured `AnthropicLlmRouter` from `@tryout/llm`); inject with `@Inject(LLM_ROUTER)` |
| `github/github.service.ts` | Octokit wrapper: `createRepoFromTemplate`, `listOpenPullRequests`, `getPullRequestDiff`, `getCheckRuns`, `createPullRequestReview` |
| `agents/pm.service.ts` | `generateIntro(runId)` — single LLM call → PM welcome + ticket, persisted as an AgentMessage |
| `agents/senior-review.service.ts` | `reviewSubmission(data)` — reviews the real diff, forces request_changes on first submission, posts to GitHub, persists a Review |
| `agents/processors/*.processor.ts` | BullMQ workers: `pm-intro` runs PmService, `review` runs SeniorReviewService |
| `queue/queue.constants.ts` | Queue names (`poll-pr`, `poll-ci`, `pm-intro`, `review`) and job data types |
| `queue/queue.service.ts` | `enqueuePollPr/PollCi/PmIntro/Review()` helpers |
| `queue/processors/poll-pr.processor.ts` | Detects PR on candidate repo → creates Submission → enqueues poll-ci |
| `queue/processors/poll-ci.processor.ts` | Polls CI check runs → updates `Submission.ciStatus` → enqueues review |
| `scenario-runs/scenario-runs.controller.ts` | `POST /scenario-runs`, `GET /scenario-runs/:id` |
| `scenario-runs/scenario-runs.service.ts` | Orchestrates DB + GitHub + queue; getRun returns ticket + PM intro + latest review |

### Database (`packages/db/src/`)

| File | Purpose |
|------|---------|
| `schema.ts` | All Drizzle tables: users, tracks, scenarios, scenarioRuns, repos, submissions, agentMessages, reviews, scorecards |
| `client.ts` | `createDb(connectionString)` factory + `Db` type |
| `index.ts` | Re-exports: `export * from './client'`, `export * as schema from './schema'` |
| `seeds/seed-scenario-01.ts` | Inserts `backend` track + Scenario-01 (LUMI-142 archive task) |
| `migrations/` | Drizzle migration SQL files |

### Web (`apps/web/src/`)

| File | Purpose |
|------|---------|
| `app/layout.tsx` | Root layout |
| `app/page.tsx` | Landing/redirect page |
| `app/login/page.tsx` | Login form using `AuthShell` |
| `app/signup/page.tsx` | Signup form using `AuthShell` |
| `components/AuthShell.tsx` | Two-panel auth layout (dark brand left, form right) |
| `lib/api.ts` | Typed fetch client: `api.signup()`, `api.login()` |

### Template (`templates/lumi-tasks-api/`)

The NestJS app candidates receive as their challenge workspace. Has a Tasks CRUD API (in-memory), class-validator DTOs, and 4 e2e tests. CI runs on GitHub Actions. Candidates must implement POST /tasks/:id/archive (and related).

## Database Schema Key Tables

```
users           — id, email, passwordHash, organizationId, createdAt
tracks          — id, name (e.g. "backend")
scenarios       — id, trackId, title, version, definition (JSONB), status
scenarioRuns    — id, userId, scenarioId, status (enum), startedAt, deadlineAt
repos           — id, scenarioRunId, url, defaultBranch, prNumber
submissions     — id, scenarioRunId, prUrl, ciStatus, ciResults (JSONB), createdAt
agentMessages   — id, scenarioRunId, agentRole (pm|senior), direction, content
reviews         — id, submissionId, agentRole, comments (JSONB), verdict
scorecards      — id, scenarioRunId, technicalScore, professionalScore, ...
```

## Environment Variables

Required (throw if missing): `DATABASE_URL`, `JWT_SECRET`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `ANTHROPIC_API_KEY` (the last needed when agents run)

Marketplace (required at boot — PurchasesModule reads them at startup):
- `STRIPE_SECRET_KEY` — Stripe API key (test mode until launch)
- `STRIPE_WEBHOOK_SECRET` — webhook endpoint signing secret
- `WEB_BASE_URL` — default `http://localhost:3000`; Stripe success/cancel redirect base

Optional with defaults:
- `PORT` — 3001
- `JWT_EXPIRES_IN` — 7d
- `REDIS_URL` — redis://localhost:6379
- `GITHUB_TEMPLATE_REPO` — lumi-tasks-api
- `POLL_PR_INTERVAL_MS` — 30000
- `POLL_CI_INTERVAL_MS` — 60000
- `POLL_MAX_ATTEMPTS` — 120
- `LLM_CHAT_MODEL` — claude-haiku-4-5
- `LLM_REVIEW_MODEL` — claude-sonnet-4-6

## Testing

```bash
# API unit tests (20 tests)
pnpm --filter @tryout/api test

# LLM router unit tests (3 tests)
pnpm --filter @tryout/llm test

# E2E tests (12 tests) — needs real Postgres + JWT_SECRET
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout JWT_SECRET=dev \
  pnpm --filter @tryout/api test:e2e

# Template tests (4 tests)
cd templates/lumi-tasks-api && npm test

# Single test file
pnpm --filter @tryout/api test -- github.service
```

E2E tests mock `GitHubService`, `QueueService`, and `LLM_ROUTER` — no real GitHub/Anthropic tokens needed. The `test/jest-e2e.setup.ts` file sets fake `GITHUB_TOKEN`, `GITHUB_OWNER`, and `ANTHROPIC_API_KEY` before module compilation.

## Patterns & Conventions

- **Guard usage across modules:** `ScenarioRunsModule` imports `AuthModule` (which exports `JwtModule` + `JwtAuthGuard`) — this is the pattern for any future module that needs JWT protection.
- **BullMQ self-scheduling:** processors re-enqueue themselves with a delay when the condition isn't met; they stop when done or when `attemptCount >= pollMaxAttempts`.
- **Required env vars:** use `env.someVar()` (function) for vars that must be present at runtime. Plain `env.someVar` for vars with defaults.
- **Drizzle injection:** `@Inject(DRIZZLE) private readonly db: Db` — `DRIZZLE` Symbol is exported from `db/db.module.ts`.
- **Commit style:** conventional commits — `feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`

## Milestones (spec order — `docs/team-sim-spec-v1.md` §11)

M0 Skeleton ✅ · M1 GitHub Spine ✅ · M2 The Visible Loop ✅ · M3 Conversations ✅ · M4 Grading ✅ · M5 Polish 🔲. See `docs/STATUS.md` for detail.

## What NOT to Build (scope guards)

- No human↔agent chat yet — clarifying/help conversations are **M3**
- No scenario run status transitions beyond "onboarding" (M3)
- No grading / scorecard computation — that's **M4** (the hidden acceptance suite must never ship in the candidate template)
- No retry/next, soft deadline, or scope-change event (M5)
- No error recovery / retry logic for failed polls
- No OAuth / organization management (post-MVP)
