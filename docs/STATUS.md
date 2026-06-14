# Tryout — Project Status

_Last updated: 2026-06-14_

## Overview

AI-powered technical interview platform. Candidates receive a real GitHub repo, implement a challenge, and interact with AI agents. System grades technical quality + professional communication.

---

## Milestone Status

| Milestone | Name | Status |
|-----------|------|--------|
| M0 | Foundation | ✅ Complete |
| M1 | GitHub Spine | ✅ Complete |
| M2 | Agent Chat | 🔲 Pending |
| M3 | Grading Engine | 🔲 Pending |
| M4 | Production Hardening | 🔲 Pending |

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

## M2 — Agent Chat 🔲

**Goal:** PM Mai and Senior Alex respond to candidate messages; PR review agent comments on GitHub.

### Planned
- [ ] `AgentChatModule` — `POST /scenario-runs/:id/messages` (candidate → agent), `GET /scenario-runs/:id/messages`
- [ ] PM Mai persona — responds to clarifying questions using scenario `agent_prompts.pm_mai.system`
- [ ] Senior Alex persona — chat mode + PR review mode
- [ ] Scenario run status transitions: `onboarding → in_progress → in_review`
- [ ] GitHub PR review posting via Octokit (reviews, comments)
- [ ] Web chat UI — Slack-style message thread per run
- [ ] LLM router wired to a real provider (Anthropic claude-haiku-4-5 for speed)

### Dependencies
- M1 complete ✅
- Real GitHub PAT + template repo on GitHub (human prerequisite)
- LLM API key (`ANTHROPIC_API_KEY`)

---

## M3 — Grading Engine 🔲

**Goal:** After Senior Alex approves, run the hidden acceptance suite and compute a scorecard.

### Planned
- [ ] `GradingModule` — triggered when `ScenarioRun.status` transitions to `grading`
- [ ] Hidden acceptance test runner — clones candidate branch, runs `test/archive.acceptance.spec.ts`
- [ ] Technical scoring against rubric criteria
- [ ] Professional scoring from conversation analysis
- [ ] `POST /scenario-runs/:id/scorecard` — returns full scorecard
- [ ] Web results page — scorecard display with per-criterion breakdown

### Dependencies
- M2 complete
- Hidden acceptance suite (`test/archive.acceptance.spec.ts`) — not included in candidate template

---

## M4 — Production Hardening 🔲

**Goal:** Multi-tenant, observability, CI/CD, rate limiting.

### Planned
- [ ] Organization model — multi-tenant with org-scoped scenarios and candidates
- [ ] Cohort management — group candidates, track aggregate performance
- [ ] Rate limiting on all public endpoints
- [ ] Error recovery for polling failures (dead-letter queue)
- [ ] Structured logging (pino)
- [ ] Cloud Run deploy pipeline (Dockerfiles already exist)
- [ ] Scenario authoring UI — create/edit tracks and scenarios

---

## Current Architecture

```
┌─────────────┐    ┌──────────────────────────────────────────────┐
│  Next.js 14 │    │               NestJS 10 API                  │
│  (port 3000)│───▶│  AuthModule   ScenarioRunsModule             │
│  App Router │    │  ↓            ↓                              │
│             │    │  /auth/*      /scenario-runs                  │
│  Login      │    │               ↓                              │
│  Signup     │    │          GitHubModule  QueueModule            │
└─────────────┘    │          (Octokit)     (BullMQ)              │
                   │               ↓             ↓                │
                   │          GitHub API    poll-pr processor      │
                   │                        poll-ci processor      │
                   └─────┬──────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │  PostgreSQL 16      │  Redis 7
              │  (Drizzle ORM)      │  (BullMQ jobs)
              └─────────────────────┘
```

## Key Metrics

| Metric | Value |
|--------|-------|
| Total commits | 24 |
| Unit tests | 15 |
| E2E tests | 11 |
| Template tests | 4 |
| DB tables | 9 |
| API endpoints | 5 (health, signup, login, me, scenario-runs ×2) |
| Packages | 5 (api, web, db, shared, llm) |
