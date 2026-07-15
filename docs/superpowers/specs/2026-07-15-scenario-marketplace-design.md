# Scenario Marketplace — Design

**Date:** 2026-07-15
**Status:** Approved pending user review
**Supersedes:** agent-trainer direction (2026-06-29). Interview-platform code remains in place but dormant.

## 1. Vision

Tryout pivots to a marketplace selling DevOps/SRE scenarios to developers who want to
become DevOps/SRE engineers. The value proposition is Day-2 operations: not "how to
deploy an app" but how to keep it live and reliable — incidents, monitoring, recovery.

Funnel:

- **Free:** the scenario story (what happened, why it matters) published on social media.
- **Paid:** the full details — IaC, source code, config files, runbook — as a one-time
  per-scenario purchase.
- **Deferred (post-MVP):** one-click hosted launch of the scenario on our infra
  (priced at hosting cost), and an AI mentor that gives graduated hints without
  spoiling the solution.

Launch catalog: 2–3 scenarios mined from real incidents in this project's own GCP
deployment (Postgres disk-full, LLM auth failures, monitoring buildout). GCP-only at
launch.

## 2. MVP Scope

Content-only marketplace built into the existing monorepo:

- Public catalog and scenario detail pages (free story + what's inside).
- Stripe Checkout, one-time purchase per scenario.
- Delivery: buyer added as read-only collaborator on a private GitHub content repo.
- Library page listing purchases with repo links and invite retry.
- Listing authoring via CLI/seed script (single author, no admin UI).

## 3. Architecture

Extends existing apps — no new deploy targets.

### API modules (`apps/api/src/`)

- `catalog/` — public, no auth:
  - `GET /catalog` — published listings.
  - `GET /catalog/:slug` — listing detail.
- `purchases/` — JWT-authed except webhook:
  - `POST /purchases/checkout` — create Stripe Checkout Session for a listing.
  - `GET /purchases/mine` — buyer's library.
  - `POST /purchases/:id/retry-invite` — re-attempt GitHub invite.
  - `POST /purchases/webhook` — Stripe webhook, signature-verified, no JWT.

Reuses: `AuthModule` (JWT guard pattern), `DbModule` (Drizzle), `github.service.ts`
(extended with an add-collaborator method), existing Cloud Run deploy and monitoring.

### Database (`packages/db/src/schema.ts`)

```
scenarioListings — id, slug (unique), title, tagline, story (markdown, free part),
                   contents (markdown, "what's inside"), priceCents, currency,
                   contentRepo (private repo name), status (draft|published|archived),
                   createdAt, updatedAt

purchases        — id, userId → users, listingId → scenarioListings,
                   stripeSessionId, amountCents,
                   status (pending|paid|invite_sent|invite_failed|refunded),
                   invitedAt, createdAt
                   unique(userId, listingId)
```

`users` gains a nullable `githubUsername` column, captured during first purchase and
editable afterwards.

### Content storage

One private GitHub repo per scenario under `GITHUB_OWNER` (e.g.
`scenario-pg-disk-full`). Buyers get `pull` (read-only) permission. GitHub free-plan
private repos allow unlimited collaborators.

### Environment variables

- `STRIPE_SECRET_KEY` — required when the purchases module is active.
- `STRIPE_WEBHOOK_SECRET` — required for webhook signature verification.

## 4. Purchase Flow

1. Buyer logs in (existing auth). On a scenario detail page, clicks Buy.
2. If `users.githubUsername` is empty, a modal collects it and saves to the profile.
3. `POST /purchases/checkout { listingId }`:
   - Rejects if the buyer already owns the listing.
   - Creates a `pending` purchase row.
   - Creates a Stripe Checkout Session with `purchaseId` in metadata and
     success/cancel URLs pointing back to the web app. Price is read from the DB
     server-side; the client never sends an amount.
   - Returns the session URL; the browser redirects to Stripe-hosted checkout.
4. Stripe fires `checkout.session.completed` to `POST /purchases/webhook`:
   - Verify the Stripe signature before any processing (raw body preserved for this
     route; NestJS `rawBody: true`).
   - Transition `pending → paid`.
   - Call GitHub API to add the buyer as a read-only collaborator on `contentRepo`.
   - Transition `paid → invite_sent`, set `invitedAt`.
   - Return 200 after signature check regardless of business outcome (Stripe retries
     on non-2xx).
5. Success page tells the buyer to accept the GitHub invite (expires in 7 days) and
   that the repo link lives in their Library.

### Failure handling

| Failure | Handling |
|---------|----------|
| Webhook replay/duplicate | Status guard: only `pending → paid` acts; repeats no-op. |
| Paid but GitHub invite fails | Status → `invite_failed`. Library shows a Retry button (`POST /purchases/:id/retry-invite`). Log-based alert on `invite_failed` plugs into existing monitoring. |
| Invite expired unaccepted | Same retry endpoint re-invites. |
| Checkout abandoned | Purchase stays `pending`; harmless. A new checkout attempt updates the existing `pending` row with the new `stripeSessionId` (the `unique(userId, listingId)` constraint means there is never a second row). |
| Refunds | Manual for MVP: refund in Stripe dashboard, mark `refunded`, remove collaborator by hand. |

## 5. Web Pages (`apps/web/src/app/`)

| Route | Purpose | Rendering |
|-------|---------|-----------|
| `/` | Landing repurposed: Day-2 ops pitch + featured scenarios | Static, revalidate ~1h |
| `/scenarios` | Catalog grid — title, tagline, price | Static, revalidate |
| `/scenarios/[slug]` | Free story (rendered markdown) + what's inside + Buy CTA | Static, revalidate |
| `/library` | Purchases: status, repo link, retry invite | Client, authed |
| `/purchase/success`, `/purchase/cancelled` | Stripe return pages | Static |

- Existing `/login`, `/signup`, `/dashboard` untouched. Buy CTA redirects unauthenticated
  users to login and returns them afterwards.
- Public pages statically generated against `GET /catalog` — SEO carries the free-story
  funnel.
- Markdown rendered with a light library; no CMS.
- Landing and detail pages are the marketing surface; structure first, then an
  intentional design pass.

## 6. Testing

Follows existing patterns — externals mocked, no live tokens:

- **Unit:** `purchases.service` (checkout creation, webhook transitions including
  duplicate delivery, invite retry), `catalog.service`. Stripe and GitHub mocked.
- **E2E:** public catalog read; checkout requires auth; webhook accepts valid and
  rejects invalid signatures; full `pending → paid → invite_sent` path with mocked
  Stripe event and mocked GitHub; double-buy blocked.
- Webhook signature tests use the Stripe SDK's test-header generator.

## 7. Rollout

1. Ship schema + API + pages first — an empty catalog is harmless.
2. Author scenario #1 (`pg-disk-full`, the real incident) in a private repo; publish
   the listing via CLI.
3. Verify end-to-end in Stripe test mode on Cloud Run, then switch to live keys.
4. Post the free story on social media — funnel starts.

## 8. Out of Scope (MVP)

- Hosted-launch of scenarios on our infra.
- AI mentor.
- Subscriptions, coupons, refund automation.
- Admin UI (CLI authoring only).
- AWS scenarios.
- Any changes to the dormant interview-platform features.
