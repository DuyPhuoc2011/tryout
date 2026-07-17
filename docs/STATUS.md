# Tryout — Project Status

_Last updated: 2026-07-16_

## Current Direction — Scenario Marketplace (2026-07-15)

Tryout is a **marketplace for DevOps/SRE practice scenarios** (Day-2 ops: reliability,
incidents). Free incident story → one-time Stripe purchase → read-only collaborator invite
to a private GitHub content repo with the full details (IaC, source, configs, runbook).
Launch catalog mined from this project's own real GCP incidents (`docs/incidents/`).

- Spec: `docs/superpowers/specs/2026-07-15-scenario-marketplace-design.md`
- Plan: `docs/superpowers/plans/2026-07-15-scenario-marketplace.md`

The interview-platform era (M0–M5, agent-trainer) was removed from the codebase on
2026-07-16; it lives only in git history.

## Shipped (MVP, 2026-07-16)

- **Catalog:** `GET /catalog` + `GET /catalog/:slug` — published listings, free story public
- **Checkout:** `POST /purchases/checkout` — Stripe Checkout session; stale pending sessions expired to prevent double charge
- **Fulfilment:** Stripe webhook state machine — idempotent replay, settled `payment_status` required, never downgrades `invite_sent`; invite via `GitHubService.addRepoCollaborator` (read-only)
- **Library:** `GET /purchases/mine` + `POST /purchases/:id/retry-invite` (incl. paid-stuck recovery)
- **Web:** marketplace landing, catalog + detail pages with buy flow, purchase return pages, library with invite retry
- **Authoring:** `pnpm --filter @tryout/db upsert-listing` CLI (upsert by slug)
- **DB:** `users`, `scenario_listings`, `purchases` (migration `0005` dropped all interview tables)

## Known Gaps (deferred)

- Login ignores `?next=` — buyer lands on `/library` after mid-purchase login, not back at checkout
- Refunds manual
- No rate limiting / throttling
- Visual design pass pending
- Async payment methods unsupported (card-only webhook)
- Concurrent-retry indicator cosmetic only

## Deployment

Live on GCP project `tryout-sre-lab-260703`: Cloud Run + self-hosted Postgres VM +
Memorystore. IaC in `infra/terraform/` (working tree, uncommitted). Pre-deploy blockers
(Stripe secrets, `WEB_BASE_URL`) wired into terraform.

## Test Coverage

- API unit + e2e suites green after the 2026-07-16 purge (auth + marketplace)
- E2E mocks `GitHubService` + `StripeService`; needs real Postgres

## Deferred (future)

- Hosted-launch of scenarios on own infra
- AI mentor (hints-only)
- Subscriptions
