# Tryout — Claude Agent Guide

## What This Project Is

Tryout is a **marketplace for DevOps/SRE practice scenarios** (Day-2 ops: reliability,
incidents — not deploy tutorials). Each listing tells a free incident story; buyers pay
once via Stripe and get the full details (IaC, source, configs, runbook) delivered as a
read-only collaborator invite to a private GitHub content repo. Launch catalog is mined
from this project's own real GCP incidents (`docs/incidents/`).

Spec: `docs/superpowers/specs/2026-07-15-scenario-marketplace-design.md`.

## Monorepo Layout

```
H:\TRYOUT\
├── apps/
│   ├── api/          — NestJS 10 backend (port 3001)
│   └── web/          — Next.js 14 frontend (port 3000, App Router)
├── packages/
│   ├── db/           — Drizzle ORM schema, migrations, listing CLI
│   ├── shared/       — shared TypeScript types (AuthResponse)
│   └── llm/          — provider-agnostic LLM router (WIP, not wired into the API)
├── services/
│   └── tutor-agent/  — Python FastAPI + LangGraph tutor agent (P1)
├── infra/terraform/  — GCP deployment (Cloud Run, Postgres VM, Memorystore)
└── docs/
    ├── incidents/    — real GCP incident writeups (scenario source material)
    └── superpowers/  — design specs + implementation plans
```

Package names: `@tryout/api`, `@tryout/web`, `@tryout/db`, `@tryout/shared`, `@tryout/llm`.

## Infrastructure

- **Package manager:** pnpm workspaces (always use `pnpm`, never `npm`/`yarn` in the monorepo root)
- **PostgreSQL 16:** Docker, port 5432, user/pass/db all `tryout`
- **Start infra:** `docker compose up -d`
- **pnpm store corruption:** if `has-flag` is missing, run `pnpm install --force`
- **Parallel builds corrupt the store:** always build with `--workspace-concurrency=1` when building everything: `pnpm -r --workspace-concurrency=1 build`

## Running the Stack

```bash
# 1. Start infra
docker compose up -d

# 2. Run migrations (first time or after schema changes)
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/db migrate

# 3. Author a listing (repeatable upsert by slug)
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout \
  pnpm --filter @tryout/db upsert-listing -- <listing.json>

# 4. Start API (dev)
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout \
  JWT_SECRET=dev \
  GITHUB_TOKEN=<your-pat> \
  GITHUB_OWNER=<your-org> \
  STRIPE_SECRET_KEY=sk_test_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  pnpm --filter @tryout/api start:dev

# 5. Start web (dev)
NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm --filter @tryout/web dev

# 6. Tutor agent (Python): cd services/tutor-agent && .venv/Scripts/uvicorn tutor_agent.app:app --port 8000
#    NestJS must have TUTOR_AGENT_URL + TUTOR_AGENT_TOKEN (matching the service) set.
```

## Key Source Files

### API (`apps/api/src/`)

| File | Purpose |
|------|---------|
| `app.module.ts` | Root NestJS module — DbModule, AuthModule, CatalogModule, PurchasesModule |
| `config/env.ts` | All env var access — call `env.someVar` or `env.someVar()` for required vars |
| `db/db.module.ts` | Global Drizzle provider; inject with `@Inject(DRIZZLE) private db: Db` |
| `auth/auth.module.ts` | JWT auth — exports JwtModule + JwtAuthGuard for other modules to use |
| `auth/jwt-auth.guard.ts` | Guard + `AuthUser` interface (`{ sub: string, email: string }`) |
| `auth/current-user.decorator.ts` | `@CurrentUser()` param decorator — returns `AuthUser` |
| `catalog/catalog.service.ts` | Public listing catalog: published listings + detail by slug |
| `purchases/purchases.service.ts` | Checkout session creation, webhook fulfilment state machine, library, invite retry |
| `purchases/stripe.service.ts` | Thin Stripe SDK wrapper (checkout sessions, webhook event verification) |
| `github/github.service.ts` | Octokit wrapper: `addRepoCollaborator` (read-only buyer invite) |
| `llm/llm.module.ts` | LLM router provider (WIP — not imported by AppModule) |

### Database (`packages/db/src/`)

| File | Purpose |
|------|---------|
| `schema.ts` | Drizzle tables: `users`, `scenario_listings`, `purchases` |
| `client.ts` | `createDb(connectionString)` factory + `Db` type |
| `seeds/upsert-listing.ts` | CLI to author/update marketplace listings (upsert by slug) |
| `migrations/` | Drizzle migration SQL files |

### Web (`apps/web/src/`)

| File | Purpose |
|------|---------|
| `app/page.tsx` | Marketplace landing |
| `app/scenarios/` | Catalog + scenario detail pages (buy flow) |
| `app/purchase/` | Stripe success/cancel return pages |
| `app/library/` | Buyer's purchases + invite retry |
| `app/login/page.tsx`, `app/signup/page.tsx` | Auth forms using `AuthShell` |
| `components/AuthShell.tsx` | Two-panel auth layout |
| `lib/api.ts` | Typed fetch client: auth, checkout, myPurchases, retryInvite |

## Database Schema

```
users              — id, email, passwordHash, organizationId, githubUsername, createdAt
scenario_listings  — id, slug, title, tagline, story (free), contents, priceCents,
                     currency, contentRepo, status (draft|published|archived)
purchases          — id, userId, listingId, stripeSessionId, amountCents,
                     status (pending|paid|invite_sent|invite_failed|refunded), invitedAt
                     UNIQUE (userId, listingId)
```

## Environment Variables

Required (throw if missing): `DATABASE_URL`, `JWT_SECRET`, `GITHUB_TOKEN`, `GITHUB_OWNER`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (PurchasesModule reads Stripe vars at boot).

Optional with defaults:
- `PORT` — 3001
- `JWT_EXPIRES_IN` — 7d
- `WEB_BASE_URL` — `http://localhost:3000`; Stripe success/cancel redirect base
- `LLM_*` / `ANTHROPIC_API_KEY` — only for the WIP LLM router, unused by the running API

## Testing

```bash
# API unit tests
pnpm --filter @tryout/api test

# E2E tests (auth + marketplace) — needs real Postgres + JWT_SECRET
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout JWT_SECRET=dev \
  pnpm --filter @tryout/api test:e2e

# Single test file
pnpm --filter @tryout/api test -- purchases
```

E2E tests mock `GitHubService` and `StripeService` — no real GitHub/Stripe keys needed.
`test/jest-e2e.setup.ts` sets fake values before module compilation.

## Patterns & Conventions

- **Guard usage across modules:** modules needing JWT protection import `AuthModule` (exports `JwtModule` + `JwtAuthGuard`).
- **Required env vars:** use `env.someVar()` (function) for vars that must be present at runtime. Plain `env.someVar` for vars with defaults.
- **Drizzle injection:** `@Inject(DRIZZLE) private readonly db: Db` — `DRIZZLE` Symbol is exported from `db/db.module.ts`.
- **Webhook fulfilment:** `purchases.status` is a one-way state machine; webhook replays are idempotent and never downgrade `invite_sent`.
- **Commit style:** conventional commits — `feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`

## What NOT to Build (scope guards)

- No hosted-launch of scenarios on own infra (deferred)
- No AI mentor / hints (deferred)
- No subscriptions — one-time purchase per scenario only
- No automated refunds (manual for now)
- No OAuth / organization management (post-MVP)
