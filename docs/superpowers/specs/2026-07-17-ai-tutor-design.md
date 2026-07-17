# AI Tutor Agent — Design

_Date: 2026-07-17_
_Status: approved (brainstorm), pending implementation plan_

## Summary

A guided walkthrough tutor for buyers of a scenario. Web-hosted per-scenario
chat, owners-only, persisted and resumable. The tutor steps the buyer through
the drill loop (orient → detect → triage → mitigate → resolve → postmortem),
branching its behavior per phase, and grows into a tool-using agent.

The tutor is a **LangGraph agent running as a separate Python service**. The
NestJS API stays the gatekeeper and system of record; the Python service is a
stateless reasoning service behind it. The buyer works the incident in their own
repo and GCP; the tutor does **not** read their real infra — the buyer pastes
what they see, the tutor guides.

## Decisions (from brainstorm)

- **Job:** guided walkthrough tutor that grows into a real tool-using agent.
- **Stack:** LangGraph in a **separate Python service** (FastAPI). Chosen for the
  agent capability *and* as portfolio/skill signal (AI-product target role).
- **Boundary:** web → NestJS → Python. NestJS enforces auth, ownership, cost
  guard, and persistence; calls Python with an internal token. Python is never
  public.
- **Access:** owners-only, per scenario.
- **Persistence:** persisted + resumable transcript, **plus explicit phase
  state** (revises the earlier transcript-only decision — option 1 wants
  per-phase branching).
- **LLM:** provider-agnostic via LangChain (`langchain-groq` for dev,
  `langchain-anthropic` for prod), driven by env — matches the existing
  `LLM_PROVIDER` convention.
- **Tools:** honest only. `grade_postmortem`, `lookup_runbook`. **No** tool that
  claims to read the buyer's real GCP/metrics; at most simulated-from-brief and
  labeled as such. (Tools land in P2.)

## Architecture

```
web ──HTTP(JWT)──> NestJS API ──HTTP(internal token)──> Python agent service ──> LLM
                   TutorModule                          FastAPI + LangGraph
                   auth, ownership,                     graph: phase router +
                   cost guard,                          phase nodes, tools,
                   transcript + phase                   LLM calls
                   persistence
                        │
                   Postgres (tutor_messages, tutor_threads, tutorBrief)
```

The Python service holds **no state and no DB access**. Each request carries
everything it needs; NestJS persists the result.

## Decomposition (this spec covers P1; P2/P3 are follow-ons)

- **P1 (this plan):** Python service + LangGraph with phase branching; NestJS
  proxy + persistence + phase; brief-in-prompt (no RAG); no external tools yet.
  End-to-end working: buyer chats, tutor guides per phase, thread + phase resume.
- **P2:** real tools — `grade_postmortem` (LLM-judged), `lookup_runbook`.
- **P3:** RAG over the runbook / fault docs using pgvector on the existing
  Postgres, if brief-in-prompt proves thin.

## Python agent service (`services/tutor-agent/`)

New top-level directory, outside the pnpm workspace (monorepo becomes polyglot).
Its own `pyproject.toml`. FastAPI + LangGraph + LangChain.

### Endpoint
`POST /agent/turn` (internal only):
- Header `X-Internal-Token` must equal `TUTOR_AGENT_TOKEN`, else 401.
- Body: `{ scenario: { title, tutorBrief }, phase: string | null, history:
  [{ role, content }], message: string }`.
- Returns: `{ reply: string, phase: string, traces?: object[] }`.

### Graph (P1)
Real LangGraph state machine, minimal but not degenerate:
- **State:** `messages`, `phase`, `scenario` (title + brief).
- **Router node:** decides whether to stay in the current phase or advance,
  from the conversation so far. Sets `phase`.
- **Phase node(s):** a phase-aware prompt node that generates the reply given the
  phase, the brief, and history. One node parameterised by phase (P1); split into
  distinct nodes if behavior diverges enough later.
- **LLM:** LangChain chat model selected from env
  (`LLM_PROVIDER` → groq / anthropic / openai-compatible), `LLM_CHAT_MODEL`.

### Phases
`orient, detect, triage, mitigate, resolve, postmortem, done` — aligned to the
fault-catalog drill loop. New threads start at `orient`.

## NestJS changes — `TutorModule` (apps/api/src/tutor/)

Imports `AuthModule`, `DbModule`. Calls the Python service over HTTP (no
`LlmModule` needed for the tutor — the LLM call moves to Python).

### `GET /tutor/:listingId/messages`
- JWT-guarded. Ownership check. Non-owner → 403.
- Returns `{ phase, messages: [{ id, role, content, createdAt }] }` for resume.

### `POST /tutor/:listingId/messages`
- JWT-guarded. Body `{ content: string }` (class-validator, non-empty).
- Ownership check → 403 if not owned.
- Cost guard → 429 before any downstream call.
- Load the listing; `tutorBrief` null → 422 "tutor not available for this
  scenario".
- Load transcript + current phase (from `tutor_threads`, default `orient`).
- Call Python `POST /agent/turn` with the internal token, passing brief +
  history + phase + message. On agent error → 502.
- Persist the user turn, the assistant reply, and the returned phase.
- Return `{ reply, phase }`.

### Ownership check
A `purchases` row for `(user_id, listing_id)` with status in
`{ invite_sent, paid, invite_failed }`. `pending`/`refunded` do not grant access.

### Cost guard
`TUTOR_DAILY_MESSAGE_LIMIT` (env, default 50) — rolling-24h count of the user's
`tutor_messages` with `role = 'user'`. At/over → 429 before the agent call.

## Data model

New table `tutor_messages`:

| column     | type        | notes                          |
|------------|-------------|--------------------------------|
| id         | uuid pk     | defaultRandom                  |
| user_id    | uuid        | → users.id                     |
| listing_id | uuid        | → scenario_listings.id         |
| role       | text        | `'user'` \| `'assistant'`      |
| content    | text        |                                |
| created_at | timestamptz | defaultNow                     |

New table `tutor_threads` (one per buyer+scenario, holds phase):

| column     | type        | notes                                    |
|------------|-------------|------------------------------------------|
| id         | uuid pk     | defaultRandom                            |
| user_id    | uuid        | → users.id                               |
| listing_id | uuid        | → scenario_listings.id                   |
| phase      | text        | default `'orient'`                       |
| created_at | timestamptz | defaultNow                               |
| updated_at | timestamptz | defaultNow                               |
| —          | unique      | (user_id, listing_id)                    |

New column on `scenario_listings`:
- `tutor_brief text` — the full guided-walkthrough knowledge (fault, inject
  steps, detection signals, mitigation, root cause). Private. **Never** returned
  by `/catalog` or `/catalog/:slug`. Authored via `upsert-listing` (add to
  `ListingFile`). Nullable.

Migration generated via drizzle-kit; add tables + column to `schema.ts`.

## Web — `/scenarios/[slug]/tutor`

Client page (token from localStorage, like `/home`):
- Token guard → `/login?next=/scenarios/[slug]/tutor` if absent.
- Resolve listing id from slug via `GET /catalog/:slug`, load transcript + phase,
  render chat.
- Layout: brand-band header (logo, scenario title, phase label, back to home) +
  light body with transcript + input. Same dark-band/light-body language as
  `/home`.
- Empty transcript → **static** greeting (no LLM call on load) explaining the
  tutor guides the drill; first agent call happens on the buyer's first message.
- Send → `POST`, append reply, update phase label. Loading + error states.
- Owned cards on `/home` and owned items on `/library` gain an "Open tutor" link.

`lib/api.ts` gains `getTutorThread(listingId)` and `sendTutorMessage(listingId,
content)`.

## Deployment (follow-on; infra/terraform is user WIP)

- New Cloud Run service for `services/tutor-agent`, internal ingress only.
- NestJS env: `TUTOR_AGENT_URL`, `TUTOR_AGENT_TOKEN`, `TUTOR_DAILY_MESSAGE_LIMIT`.
- Python env: `LLM_PROVIDER`, model + provider creds, `TUTOR_AGENT_TOKEN`.
- Terraform + Dockerfile for the Python service added when we wire deployment.

## Testing

- **Python:** unit-test the graph (phase routing advances correctly; reply
  generated for a phase) with a stub/fake LLM; endpoint test for internal-token
  auth (401 without token) and the happy path.
- **NestJS unit:** ownership gate (owner ok, non-owner 403), cost guard (429 at
  limit), missing `tutorBrief` (422), agent-call mapping + persistence + phase
  update (mock the agent HTTP call), transcript ordering.
- **NestJS e2e:** owner round-trip (POST then GET returns turns + phase),
  non-owner 403, resume. Mock the agent HTTP call and `StripeService`; seed a
  purchase row.

## Out of scope (P1)

- Tools (`grade_postmortem`, `lookup_runbook`) — P2.
- RAG / pgvector — P3.
- Streaming responses.
- The tutor reading the buyer's real repo, GCP, or terminal.
- Multi-scenario / cross-thread memory.

## Files touched (P1, anticipated)

- `services/tutor-agent/` — new Python service (FastAPI, LangGraph, pyproject).
- `packages/db/src/schema.ts` — `tutorMessages`, `tutorThreads`, `tutorBrief`.
- `packages/db/migrations/` — generated migration.
- `packages/db/src/seeds/upsert-listing.ts` — accept `tutorBrief`.
- `apps/api/src/tutor/` — module, controller, service, dto, agent HTTP client.
- `apps/api/src/app.module.ts` — import `TutorModule`.
- `apps/api/src/config/env.ts` — `tutorAgentUrl`, `tutorAgentToken`,
  `tutorDailyMessageLimit`.
- `apps/web/src/app/scenarios/[slug]/tutor/` — page + module css.
- `apps/web/src/lib/api.ts` — tutor client methods.
- `apps/web/src/app/home/page.tsx`, `apps/web/src/app/library/page.tsx` — "Open
  tutor" links.
- `CLAUDE.md` — note the new polyglot service.
