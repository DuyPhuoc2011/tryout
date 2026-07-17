# AI Tutor — Design

_Date: 2026-07-17_
_Status: approved (brainstorm), pending implementation plan_

## Summary

A guided walkthrough tutor for buyers of a scenario. Web-app-hosted chat, one
thread per buyer+scenario, persisted and resumable. The tutor steps the buyer
through the 5-phase drill loop (inject → detect → mitigate → root-cause →
postmortem) with explanations. Owners-only, per scenario.

The buyer works the incident in their own cloned repo and GCP project; the tutor
does **not** read their real repo or terminal. The buyer pastes what they see
(logs, dashboard readings) into the chat, and the tutor guides them.

## Decisions (from brainstorm)

- **Job:** guided walkthrough tutor (hand-holding through the whole loop), not a
  hints-only mentor and not a pre-purchase concierge.
- **Where:** Tryout-hosted web chat, using the existing `packages/llm` router.
- **Access:** owners-only, per scenario.
- **Persistence:** persisted + resumable transcript.
- **Phase tracking:** transcript-only. The tutor's system prompt knows the
  5-phase loop and guides conversationally. No formal phase-state field, no
  progress UI.
- **Response delivery:** synchronous request/response. Streaming is deferred.
- **Scenario knowledge:** a new private `tutorBrief` field on
  `scenario_listings`, never exposed via `/catalog`.

## Data model

New table `tutor_messages`:

| column      | type        | notes                                   |
|-------------|-------------|-----------------------------------------|
| id          | uuid pk     | defaultRandom                           |
| user_id     | uuid        | → users.id                              |
| listing_id  | uuid        | → scenario_listings.id                  |
| role        | text        | `'user'` \| `'assistant'`               |
| content     | text        |                                         |
| created_at  | timestamptz | defaultNow                              |

A thread is every row for `(user_id, listing_id)` ordered by `created_at`. No
separate session table — one thread per buyer+scenario (YAGNI).

New column on `scenario_listings`:

- `tutor_brief text` — the full guided-walkthrough knowledge for the tutor
  (the fault, inject steps, detection signals, mitigation, root cause). Private.
  **Never** returned by `GET /catalog` or `GET /catalog/:slug`. Authored via the
  `upsert-listing` CLI (add the field to `ListingFile`). Nullable — a listing
  with no brief simply has no working tutor (endpoint returns a clear error).

Migration generated via drizzle-kit; add the table + column to `schema.ts`.

## API — `TutorModule` (apps/api/src/tutor/)

Wire `LlmModule` back into `AppModule` (it exists from before the purge, just
unimported). `TutorModule` imports `AuthModule`, `DbModule`, `LlmModule`.

### `GET /tutor/:listingId/messages`
- JWT-guarded.
- Ownership check (below). Non-owner → 403.
- Returns the transcript: `{ id, role, content, createdAt }[]` ordered by time.

### `POST /tutor/:listingId/messages`
- JWT-guarded. Body: `{ content: string }` (class-validator, non-empty).
- Ownership check. Non-owner → 403.
- Cost guard (below). Over limit → 429 before any LLM spend.
- Load the listing; if `tutorBrief` is null → 422 "tutor not available for this
  scenario".
- Load prior transcript for `(user, listing)`.
- Build the prompt:
  - **system:** tutor persona + the 5-phase drill loop + `tutorBrief`.
  - **history:** prior turns mapped to chat roles.
  - **user:** the new message.
- Call `LLM_ROUTER` with the chat model.
- Persist the user turn, then the assistant reply.
- Return the assistant message `{ id, role, content, createdAt }`.

### Ownership check
A `purchases` row exists for `(user_id, listing_id)` with status in
`{ invite_sent, paid, invite_failed }` (the buyer paid; mid-fulfilment still
counts). `pending` and `refunded` do not grant access.

### Cost guard
`TUTOR_DAILY_MESSAGE_LIMIT` (env, default 50) — rolling-24h count of the
user's `tutor_messages` with `role = 'user'`. At or over the limit → 429 before
the LLM call. Mirrors the existing `DAILY_RUN_LIMIT` pattern.

## Web — `/scenarios/[slug]/tutor`

Client page (needs the token from localStorage, like `/home` and `/library`):
- Guards on token → `/login?next=/scenarios/[slug]/tutor` if absent.
- Resolves the listing id from the slug (via `GET /catalog/:slug`), loads the
  transcript, renders chat.
- Layout: brand-band header (logo, scenario title, back-to-home) + light body
  with the transcript and a message input. Same dark-band / light-body language
  as `/home`.
- Send → `POST`, append the reply, keep input responsive. Loading + error states.
- Empty transcript → a **static** greeting (no LLM call on load) explaining the
  tutor guides the drill and inviting the buyer to describe where they are. The
  first LLM call happens on the buyer's first message. This avoids spend on page
  load and keeps the cost guard counting real turns only.

Owned scenario cards on `/home` and owned items on `/library` gain an "Open
tutor" link to this page (in addition to the existing library/repo links).

`lib/api.ts` gains: `getTutorMessages(listingId)`, `sendTutorMessage(listingId,
content)`.

## LLM

Provider-agnostic via `packages/llm`. Model is env-configured
(`LLM_CHAT_MODEL`), routed through `LLM_ROUTER`. Dev uses Groq llama (already
wired, free); prod switches to Claude via env with no code change. The tutor
uses the chat model, not the review model.

## Testing

- **API unit:** ownership gate (owner allowed, non-owner 403), cost guard (429
  at limit), missing `tutorBrief` (422), prompt assembly (brief + history +
  user), transcript replay ordering. Mock `LLM_ROUTER`.
- **API e2e:** owner round-trip (POST then GET returns both turns), non-owner
  403, resume (GET after prior POSTs). Mock `LLM_ROUTER` and `StripeService` per
  the existing e2e setup; seed a purchase row for the owner.

## Out of scope

- Streaming responses (SSE).
- Formal phase-state field and progress UI.
- The tutor reading the buyer's real repo, GCP, or terminal.
- Multi-scenario / cross-thread memory.
- Voice, attachments.

## Files touched (anticipated)

- `packages/db/src/schema.ts` — `tutorMessages` table, `tutorBrief` column.
- `packages/db/migrations/` — generated migration.
- `packages/db/src/seeds/upsert-listing.ts` — accept `tutorBrief`.
- `apps/api/src/tutor/` — module, controller, service, dto.
- `apps/api/src/app.module.ts` — import `TutorModule` + `LlmModule`.
- `apps/api/src/config/env.ts` — `tutorDailyMessageLimit`.
- `apps/web/src/app/scenarios/[slug]/tutor/` — page + module css.
- `apps/web/src/lib/api.ts` — tutor client methods.
- `apps/web/src/app/home/page.tsx`, `apps/web/src/app/library/page.tsx` — "Open
  tutor" links on owned items.
