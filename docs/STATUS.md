# Tryout — Project Status

_Last updated: 2026-06-15_

## Overview

AI-powered technical interview platform. Candidates receive a real GitHub repo, implement a challenge, and interact with AI agents. System grades technical quality + professional communication.

> **Milestone numbering follows the spec** (`team-sim-spec-v1.md` §11), the source of truth. An earlier revision of this file mislabeled M2–M4; corrected below.

---

## Milestone Status

| Milestone | Name | Status |
|-----------|------|--------|
| M0 | Skeleton (auth, infra) | ✅ Complete |
| M1 | GitHub Spine | ✅ Complete |
| M2 | The Visible Loop | ✅ Complete |
| M3 | Conversations | ✅ Complete |
| M4 | Grading | 🔲 Pending |
| M5 | Polish | 🔲 Pending |

---

## M0 — Foundation ✅

**Goal:** Monorepo, auth, DB schema, infra, web scaffold.

### Done

- [x] pnpm monorepo with workspaces: `@tryout/api`, `@tryout/web`, `@tryout/db`, `@tryout/shared`, `@tryout/llm`
- [x] NestJS 10 API scaffold with `/health` endpoint backed by real Postgres
- [x] Full Drizzle ORM schema (users, tracks, scenarios, scenarioRuns, repos, submissions, agentMessages, reviews, scorecards) + migration
- [x] JWT auth: `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`
  - bcrypt password hashing, class-validator DTOs, `JwtAuthGuard`, `@CurrentUser()` decorator
- [x] Next.js 14 App Router web scaffold with intentional auth UI
  - Two-panel `AuthShell`, login/signup pages, typed `api` client
- [x] Docker Compose infra: PostgreSQL 16 (port 5432), Redis 7 (port 6379)
- [x] Dockerfiles for API and web (Cloud Run-ready)
- [x] 7 auth e2e tests passing
- [x] `@tryout/llm` provider-agnostic router stub
- [x] `@tryout/shared` — `AuthResponse`, `PublicUser`, enums

### Test Coverage (M0)
- Unit: 3 (PasswordService)
- E2E: 7 (auth round-trip)

---

## M1 — GitHub Spine ✅

**Goal:** Template repo, per-user GitHub repo creation, PR detection, CI polling.

### Done

- [x] `templates/lumi-tasks-api/` — full NestJS template the candidate receives
  - Tasks CRUD API (in-memory), class-validator DTOs, 4 e2e tests, GitHub Actions CI
- [x] Env config extended: `redisUrl`, `githubToken`, `githubOwner`, `githubTemplateRepo`, `pollPrIntervalMs`, `pollCiIntervalMs`, `pollMaxAttempts`
- [x] `.env.example` updated with GitHub vars
- [x] DB seed script (`@tryout/db seed`) — inserts `backend` track + Scenario-01 (LUMI-142 archive task) idempotently
- [x] `GitHubService` (Octokit wrapper) — `createRepoFromTemplate`, `listOpenPullRequests`, `getPullRequestDiff`, `getCheckRuns`
- [x] `QueueModule` (BullMQ) — `poll-pr` and `poll-ci` queues, Redis connection, `QueueService` enqueue helpers
- [x] `PollPrProcessor` — detects open PRs → creates `Submission` record → enqueues `poll-ci`; self-reschedules when no PR yet
- [x] `PollCiProcessor` — polls GitHub check runs → updates `Submission.ciStatus`/`ciResults`; self-reschedules while in progress
- [x] `ScenarioRunsModule` — `POST /scenario-runs` (finds scenario → creates run → creates GitHub repo → enqueues poll-pr), `GET /scenario-runs/:id`
- [x] AppModule wired: `DbModule`, `AuthModule`, `ScenarioRunsModule`

### Test Coverage (M1, cumulative)
- Unit: 15 (PasswordService 3, GitHubService 4, PollPrProcessor 3, PollCiProcessor 5)
- E2E: 11 (auth 7, scenario-runs 4)
- Template: 4 (tasks e2e)

### Manual Prerequisites (human action required before end-to-end test)
- [ ] Create GitHub org/user and PAT with `repo` scope
- [ ] Push `templates/lumi-tasks-api/` to GitHub and mark as template repo
- [ ] Copy `.env.example` → `.env`, fill in `GITHUB_TOKEN` and `GITHUB_OWNER`
- [ ] Run `DATABASE_URL=... pnpm --filter @tryout/db seed`

---

## M2 — The Visible Loop ✅

**Goal:** Make the seeded scenario playable end to end — PM intro + ticket, real PR + CI, Senior reviews the real diff and posts a GitHub review. No chat, no grading yet. The make-or-break demo.

### Done
- [x] `AnthropicLlmRouter` — real provider behind the `LlmRouter` interface, routed by task complexity (chat → Haiku, review → Sonnet)
- [x] `LlmModule` — provides `LLM_ROUTER` from env (`ANTHROPIC_API_KEY`, `LLM_CHAT_MODEL`, `LLM_REVIEW_MODEL`)
- [x] `PmService` — single LLM call generating the PM welcome + ticket assignment, persisted as an `AgentMessage` (role `pm`, direction `agent`)
- [x] `SeniorReviewService` — fetches the real diff, reviews against ground-truth + red flags, **forces request_changes on the first submission**, posts the review to GitHub, persists a `Review`
- [x] `GitHubService.createPullRequestReview` — posts a review with a verdict event
- [x] `pm-intro` + `review` BullMQ queues; `pm-intro` enqueued at run start, `review` enqueued by `poll-ci` when CI completes
- [x] `AgentsModule` — wires services + processors; imported into AppModule
- [x] Widened `GET /scenario-runs/:id` — returns the ticket, PM intro, and latest review
- [x] Web `/run` page — one screen showing ticket, PM message, repo link, CI/submission status, Senior review; polls for updates
- [x] `ScenarioDefinition` shared types in `@tryout/shared`

### Test Coverage (M2, cumulative)
- Unit: 23 (`@tryout/llm` AnthropicLlmRouter 3; API: PasswordService 3, GitHubService 5, PollPrProcessor 3, PollCiProcessor 5, PmService 1, SeniorReviewService 3)
- E2E: 12 (auth 7, scenario-runs 4, visible-loop 1)
- Template: 4 (tasks e2e)

### Manual Prerequisites (in addition to M1's)
- [ ] Anthropic API key in `.env` as `ANTHROPIC_API_KEY`

---

## M3 — Conversations ✅

**Goal:** Two-way chat with the PM (clarify the ambiguous ticket) and the Senior (ask for help without getting the answer), persisted as `AgentMessage`s.

### Done
- [x] `AgentChatService` — one synchronous LLM call per turn for both personas; persists the user turn and the agent reply, replays prior turns for that agent
- [x] `POST /scenario-runs/:id/messages` + `GET /scenario-runs/:id/messages` — JWT-guarded, ownership-checked, `SendMessageDto` validation
- [x] PM uses the persona prompt with canonical clarifications; Senior uses CHAT mode and never reveals the solution
- [x] First message transitions the run `onboarding → in_progress`
- [x] Web `/run` page — PM + Senior chat panels, re-fetching the transcript after each send

### Test Coverage (M3, cumulative)
- Unit: 27 (`@tryout/llm` 3; API: PasswordService 3, GitHubService 5, PollPrProcessor 3, PollCiProcessor 5, PmService 1, SeniorReviewService 3, AgentChatService 4)
- E2E: 17 (auth 7, scenario-runs 4, visible-loop 1, conversations 5)
- Template: 4 (tasks e2e)

### Manual Prerequisites
- [ ] `ANTHROPIC_API_KEY` in `.env` (shared with M2)

---

## M4 — Grading 🔲

**Goal:** Run the Grader once at the end and render a scorecard (technical + professional).

### Planned
- [ ] `GradingModule` — async job over the full transcript + diff + CI + review thread + ground truth
- [ ] Hidden acceptance test runner — runs `test/archive.acceptance.spec.ts` on the final branch
- [ ] Technical + professional scoring against the per-scenario rubric
- [ ] `Scorecard` persisted; results endpoint + web results page

### Dependencies
- M3 complete
- Hidden acceptance suite (`test/archive.acceptance.spec.ts`) — never shipped in the candidate template

---

## M5 — Polish 🔲

**Goal:** Tighten UX, add retry/next, soft deadline, the optional scope-change event.

---

## Current Architecture

```
┌─────────────┐    ┌──────────────────────────────────────────────────┐
│  Next.js 14 │    │                  NestJS 10 API                    │
│  (port 3000)│───▶│  AuthModule   ScenarioRunsModule   AgentsModule   │
│  App Router │    │  ↓            ↓                     ↓              │
│  Login      │    │  /auth/*      /scenario-runs        PmService      │
│  Signup     │    │               ↓                     SeniorReview    │
│  /run       │    │     GitHubModule  QueueModule  LlmModule           │
└─────────────┘    │     (Octokit)     (BullMQ)     (Anthropic)         │
                   │          ↓            ↓              ↓             │
                   │     GitHub API   poll-pr / poll-ci   Claude        │
                   │                  pm-intro / review                 │
                   └─────┬──────────────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │  PostgreSQL 16      │  Redis 7
              │  (Drizzle ORM)      │  (BullMQ jobs)
              └─────────────────────┘
```

## Key Metrics

| Metric | Value |
|--------|-------|
| Unit tests | 27 (llm 3 + api 24) |
| E2E tests | 17 |
| Template tests | 4 |
| DB tables | 9 |
| API endpoints | 7 (health, signup, login, me, scenario-runs ×2, messages ×2) |
| Packages | 5 (api, web, db, shared, llm) |
| BullMQ queues | 4 (poll-pr, poll-ci, pm-intro, review) |
