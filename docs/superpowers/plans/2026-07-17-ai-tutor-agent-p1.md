# AI Tutor Agent (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **STATUS: ✅ COMPLETE (2026-07-19).** All 14 tasks shipped on `feat/ai-tutor-p1`. Verified green: tutor-agent pytest 7/7, api unit 34/34, api e2e 20/20 (incl. tutor ownership/round-trip/resume). See acceptance section at the bottom.

**Goal:** Ship a working guided tutor: a Python LangGraph agent behind the NestJS API, per-scenario chat with persisted transcript + drill phase, owners-only.

**Architecture:** web → NestJS (auth, ownership, cost guard, persistence) → Python service (FastAPI + LangGraph, stateless) → LLM. NestJS never lets the browser touch Python; it calls Python with an internal token and persists the result.

**Tech Stack:** NestJS 10 + Drizzle (existing), Next.js 14 (existing), new Python 3.12 service (FastAPI, LangGraph, LangChain), Postgres.

Spec: `docs/superpowers/specs/2026-07-17-ai-tutor-design.md`.

**Conventions the executor must know:**
- Monorepo root `H:\TRYOUT`. pnpm workspaces. Postgres at `postgres://tryout:tryout@localhost:5432/tryout` (Docker, `docker compose up -d`).
- Drizzle injection: `@Inject(DRIZZLE) private readonly db: Db` (`DRIZZLE` from `apps/api/src/db/db.module.ts`). Schema is `import { schema, type Db } from '@tryout/db'`.
- Auth: `@UseGuards(JwtAuthGuard)` + `@CurrentUser() user: AuthUser` (`user.sub` is the user id). Both from `apps/api/src/auth/`.
- Env access: `apps/api/src/config/env.ts`. `env.foo` for defaulted vars, `env.foo()` for required.
- API unit tests: `pnpm --filter @tryout/api test`. E2E (real Postgres): `DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout JWT_SECRET=dev pnpm --filter @tryout/api test:e2e`.
- Web typecheck: `cd apps/web && npx tsc --noEmit`.
- Drill phases (shared vocabulary): `orient, detect, triage, mitigate, resolve, postmortem, done`. New threads start at `orient`.

---

## File Structure

**DB (`packages/db/src/`)**
- `schema.ts` — add `tutorMessages`, `tutorThreads` tables, `tutorBrief` column on `scenarioListings`.
- `seeds/upsert-listing.ts` — accept optional `tutorBrief`.

**Python service (`services/tutor-agent/`)** — new, outside the pnpm workspace
- `pyproject.toml` — deps + pytest config.
- `tutor_agent/__init__.py`
- `tutor_agent/settings.py` — env (internal token, LLM provider/model).
- `tutor_agent/phases.py` — phase constants + helpers.
- `tutor_agent/graph.py` — `build_graph(model)` LangGraph.
- `tutor_agent/models.py` — pydantic request/response schemas.
- `tutor_agent/llm.py` — `get_chat_model()` provider factory.
- `tutor_agent/app.py` — FastAPI app + `/agent/turn` + token auth.
- `tests/test_graph.py`, `tests/test_app.py`.

**NestJS (`apps/api/src/`)**
- `tutor/tutor.module.ts`, `tutor/tutor.controller.ts`, `tutor/tutor.service.ts`
- `tutor/tutor-agent.client.ts` — HTTP client to Python.
- `tutor/dto/send-tutor-message.dto.ts`
- `config/env.ts` — add `tutorAgentUrl`, `tutorAgentToken`, `tutorDailyMessageLimit`.
- `app.module.ts` — import `TutorModule`.
- `test/tutor.e2e-spec.ts`

**Web (`apps/web/src/`)**
- `lib/api.ts` — `getTutorThread`, `sendTutorMessage`.
- `app/scenarios/[slug]/tutor/page.tsx`, `.../tutor/tutor.module.css`
- `app/home/page.tsx`, `app/library/page.tsx` — "Open tutor" links.

---

## Task 1: DB schema — tutor tables + tutorBrief column

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: migration under `packages/db/migrations/` (generated)

- [ ] **Step 1: Add the column and tables to `schema.ts`**

Add `tutorBrief` to the existing `scenarioListings` table definition (a new line before `createdAt`):

```ts
  contentRepo: text('content_repo').notNull(),
  // Private guided-walkthrough knowledge for the tutor. NEVER exposed via /catalog.
  tutorBrief: text('tutor_brief'),
  status: listingStatusEnum('status').notNull().default('draft'),
```

Append these two tables at the end of the file, before the `export type` lines:

```ts
export const tutorMessages = pgTable('tutor_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  listingId: uuid('listing_id')
    .notNull()
    .references(() => scenarioListings.id),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tutorThreads = pgTable(
  'tutor_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => scenarioListings.id),
    phase: text('phase').notNull().default('orient'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userListingUnique: unique('tutor_threads_user_listing_unique').on(t.userId, t.listingId),
  }),
);
```

- [ ] **Step 2: Generate the migration**

Run: `cd packages/db && pnpm generate`
Expected: prints `5 tables` (users, scenario_listings, purchases, tutor_messages, tutor_threads) and writes a new `migrations/0006_*.sql`.

- [ ] **Step 3: Inspect the generated SQL**

Open the new `packages/db/migrations/0006_*.sql`. Confirm it `CREATE TABLE "tutor_messages"`, `CREATE TABLE "tutor_threads"` (with the unique constraint), and `ALTER TABLE "scenario_listings" ADD COLUMN "tutor_brief" text`. No `DROP` statements. If a `DROP` appears, stop and fix the schema.

- [ ] **Step 4: Apply the migration**

Run: `cd H:/TRYOUT && DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/db migrate`
Expected: `migrations applied successfully!`

- [ ] **Step 5: Verify the tables exist**

Run: `docker exec tryout-postgres-1 psql -U tryout -c "\dt"`
Expected: rows for `tutor_messages` and `tutor_threads` present alongside `users`, `scenario_listings`, `purchases`.

- [ ] **Step 6: Commit**

```bash
cd H:/TRYOUT
git add packages/db/src/schema.ts packages/db/migrations
git commit -m "feat(db): tutor_messages, tutor_threads, tutorBrief column"
```

---

## Task 2: upsert-listing accepts tutorBrief

**Files:**
- Modify: `packages/db/src/seeds/upsert-listing.ts`

- [ ] **Step 1: Add `tutorBrief` to the file interface and values**

In `ListingFile`, add after `contentRepo`:

```ts
  contentRepo: string;
  tutorBrief?: string;
  status?: 'draft' | 'published' | 'archived';
```

In the `values` object (after `contentRepo: raw.contentRepo,`), add:

```ts
    contentRepo: raw.contentRepo,
    tutorBrief: raw.tutorBrief ?? null,
    status: raw.status ?? 'draft',
```

- [ ] **Step 2: Add a tutorBrief to one seed listing and upsert it**

Run (writes a brief onto the existing `postgres-disk-full` listing):

```bash
cd H:/TRYOUT
cat > /tmp/brief-listing.json <<'JSON'
{
  "slug": "postgres-disk-full",
  "title": "Postgres disk full",
  "tagline": "A self-hosted Postgres VM runs out of disk. Writes fail, then the DB won't start. No alert fired.",
  "story": "## The incident\n\nSignup stopped loading. A user reported it first - no page from monitoring.",
  "contents": "- Terraform for the VM + disk\n- postgresql.conf and the systemd unit\n- A recovery runbook\n- The real postmortem",
  "priceCents": 2900,
  "currency": "usd",
  "contentRepo": "scenario-postgres-disk-full",
  "status": "published",
  "tutorBrief": "FAULT: self-hosted Postgres on a 30GB VM disk with no autoresize. WAL + logs + data fill the disk; Postgres cannot extend WAL, writes fail, then it refuses writes. INJECT: SSH in, fallocate a large filler file to fill /. DETECT (blind): signups fail; df -h at 100%; Postgres logs 'No space left on device' / 'could not extend file'. TRIAGE: confirm disk not CPU/mem; check df -h, du. MITIGATE: free space (delete filler, rotate logs) to restore writes. RESOLVE: grow the disk (gcloud compute disks resize) then resize2fs; verify WAL writes. ROOT CAUSE: fixed disk, no autoresize, no disk-utilization alert. POSTMORTEM: MTTD was terrible (user-reported); the missing alert is disk-utilization > 85%. TUTOR STYLE: guide one phase at a time, ask what they see, never dump the whole answer; when the buyer clearly finishes a phase, emit the control line to advance."
}
JSON
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/db exec tsx src/seeds/upsert-listing.ts /tmp/brief-listing.json
```

Expected: `Upserted listing: postgres-disk-full (status: published)`.

- [ ] **Step 3: Verify the brief is stored but NOT public**

```bash
docker exec tryout-postgres-1 psql -U tryout -tAc "select length(tutor_brief) from scenario_listings where slug='postgres-disk-full'"
curl -s http://localhost:3001/catalog/postgres-disk-full | grep -c tutor_brief || echo "OK: brief not in catalog response"
```

Expected: the length query prints a number > 0; the grep prints `OK: brief not in catalog response`.

- [ ] **Step 4: Commit**

```bash
cd H:/TRYOUT
git add packages/db/src/seeds/upsert-listing.ts
git commit -m "feat(db): upsert-listing accepts tutorBrief"
```

---

## Task 3: Python service scaffold + settings

**Files:**
- Create: `services/tutor-agent/pyproject.toml`
- Create: `services/tutor-agent/tutor_agent/__init__.py`
- Create: `services/tutor-agent/tutor_agent/settings.py`
- Create: `services/tutor-agent/tutor_agent/phases.py`
- Create: `services/tutor-agent/tests/test_phases.py`

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "tutor-agent"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn>=0.30",
  "pydantic>=2.7",
  "pydantic-settings>=2.3",
  "langgraph>=0.2",
  "langchain-core>=0.3",
  "langchain-groq>=0.2",
  "langchain-anthropic>=0.2",
  "langchain-openai>=0.2",
]

[project.optional-dependencies]
dev = ["pytest>=8", "httpx>=0.27"]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

- [ ] **Step 2: Create the package and phases module**

`services/tutor-agent/tutor_agent/__init__.py`: empty file.

`services/tutor-agent/tutor_agent/phases.py`:

```python
PHASES = ["orient", "detect", "triage", "mitigate", "resolve", "postmortem", "done"]
FIRST_PHASE = "orient"


def is_valid_phase(phase: str) -> bool:
    return phase in PHASES
```

- [ ] **Step 3: Write `settings.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    internal_token: str = "dev-internal-token"
    llm_provider: str = "openai"  # openai (Groq-compatible) | anthropic | groq
    llm_chat_model: str = "llama-3.3-70b-versatile"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.groq.com/openai/v1"
    anthropic_api_key: str = ""
    groq_api_key: str = ""


settings = Settings()
```

- [ ] **Step 4: Write the failing test**

`services/tutor-agent/tests/test_phases.py`:

```python
from tutor_agent.phases import PHASES, FIRST_PHASE, is_valid_phase


def test_first_phase_is_orient():
    assert FIRST_PHASE == "orient"


def test_valid_and_invalid_phases():
    assert is_valid_phase("detect")
    assert not is_valid_phase("nope")
    assert PHASES[0] == "orient"
    assert PHASES[-1] == "done"
```

- [ ] **Step 5: Create the venv, install, run the test**

Run:
```bash
cd H:/TRYOUT/services/tutor-agent
py -m venv .venv
.venv/Scripts/pip install -e ".[dev]"
.venv/Scripts/pytest -q
```
Expected: 2 passed.

- [ ] **Step 6: Add a `.gitignore` and commit**

Create `services/tutor-agent/.gitignore`:
```
.venv/
__pycache__/
*.pyc
.env
```

```bash
cd H:/TRYOUT
git add services/tutor-agent/pyproject.toml services/tutor-agent/tutor_agent services/tutor-agent/tests services/tutor-agent/.gitignore
git commit -m "feat(tutor-agent): scaffold Python service + phases"
```

---

## Task 4: LangGraph graph (model-injected, testable)

**Files:**
- Create: `services/tutor-agent/tutor_agent/models.py`
- Create: `services/tutor-agent/tutor_agent/graph.py`
- Create: `services/tutor-agent/tests/test_graph.py`

- [ ] **Step 1: Write request/response schemas `models.py`**

```python
from pydantic import BaseModel


class Scenario(BaseModel):
    title: str
    tutor_brief: str


class Turn(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class TurnRequest(BaseModel):
    scenario: Scenario
    phase: str | None = None
    history: list[Turn] = []
    message: str


class TurnResponse(BaseModel):
    reply: str
    phase: str
```

- [ ] **Step 2: Write the failing graph test**

`services/tutor-agent/tests/test_graph.py`:

```python
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from tutor_agent.graph import build_graph
from tutor_agent.models import Scenario, Turn


def run(model, phase, message, history=None):
    graph = build_graph(model)
    state = {
        "scenario": Scenario(title="Disk full", tutor_brief="fault: disk fills"),
        "phase": phase,
        "history": history or [],
        "message": message,
        "reply": "",
        "next_phase": phase,
    }
    return graph.invoke(state)


def test_reply_and_phase_stay_when_no_control_line():
    model = FakeListChatModel(responses=["What symptoms do you see so far?"])
    out = run(model, "orient", "I just started.")
    assert out["reply"] == "What symptoms do you see so far?"
    assert out["next_phase"] == "orient"


def test_control_line_advances_phase_and_is_stripped():
    model = FakeListChatModel(
        responses=["Good, you've oriented. Move on.\nNEXT_PHASE: detect"]
    )
    out = run(model, "orient", "I've read the architecture.")
    assert out["next_phase"] == "detect"
    assert "NEXT_PHASE" not in out["reply"]
    assert out["reply"].strip().endswith("Move on.")


def test_invalid_control_phase_is_ignored():
    model = FakeListChatModel(responses=["ok\nNEXT_PHASE: bogus"])
    out = run(model, "detect", "x")
    assert out["next_phase"] == "detect"
    assert "NEXT_PHASE" not in out["reply"]
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd H:/TRYOUT/services/tutor-agent && .venv/Scripts/pytest tests/test_graph.py -q`
Expected: FAIL (`build_graph` not defined / import error).

- [ ] **Step 4: Implement `graph.py`**

```python
import re
from typing import Any, TypedDict

from langgraph.graph import StateGraph, START, END

from tutor_agent.models import Scenario, Turn
from tutor_agent.phases import is_valid_phase

_CONTROL = re.compile(r"^NEXT_PHASE:\s*(\w+)\s*$", re.MULTILINE)

_SYSTEM = """You are a calm senior SRE tutoring a learner through a real \
incident, one phase at a time. Current phase: {phase}.

Scenario: {title}
Private brief (never paste it wholesale; use it to guide): {brief}

Rules:
- Guide, do not dump. Ask what they observe; give one concrete nudge at a time.
- Never reveal the whole answer at once. Keep the learner doing the work.
- When the learner has clearly completed the current phase, end your reply with \
a line exactly: NEXT_PHASE: <next-phase> (one of orient, detect, triage, \
mitigate, resolve, postmortem, done). Otherwise do not emit that line.
"""


class TutorState(TypedDict):
    scenario: Scenario
    phase: str
    history: list[Turn]
    message: str
    reply: str
    next_phase: str


def _respond(model):
    def node(state: TutorState) -> dict[str, Any]:
        sys = _SYSTEM.format(
            phase=state["phase"],
            title=state["scenario"].title,
            brief=state["scenario"].tutor_brief,
        )
        messages: list[tuple[str, str]] = [("system", sys)]
        for turn in state["history"]:
            role = "assistant" if turn.role == "assistant" else "user"
            messages.append((role, turn.content))
        messages.append(("user", state["message"]))
        result = model.invoke(messages)
        text = result.content if hasattr(result, "content") else str(result)
        return {"reply": text}

    return node


def _advance(state: TutorState) -> dict[str, Any]:
    reply = state["reply"]
    match = _CONTROL.search(reply)
    next_phase = state["phase"]
    if match and is_valid_phase(match.group(1)):
        next_phase = match.group(1)
    cleaned = _CONTROL.sub("", reply).strip()
    return {"reply": cleaned, "next_phase": next_phase}


def build_graph(model):
    g = StateGraph(TutorState)
    g.add_node("respond", _respond(model))
    g.add_node("advance", _advance)
    g.add_edge(START, "respond")
    g.add_edge("respond", "advance")
    g.add_edge("advance", END)
    return g.compile()
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd H:/TRYOUT/services/tutor-agent && .venv/Scripts/pytest tests/test_graph.py -q`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
cd H:/TRYOUT
git add services/tutor-agent/tutor_agent/models.py services/tutor-agent/tutor_agent/graph.py services/tutor-agent/tests/test_graph.py
git commit -m "feat(tutor-agent): LangGraph tutor graph with phase advancement"
```

---

## Task 5: LLM provider factory + FastAPI endpoint

**Files:**
- Create: `services/tutor-agent/tutor_agent/llm.py`
- Create: `services/tutor-agent/tutor_agent/app.py`
- Create: `services/tutor-agent/tests/test_app.py`

- [ ] **Step 1: Write the provider factory `llm.py`**

```python
from tutor_agent.settings import settings


def get_chat_model():
    provider = settings.llm_provider.lower()
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=settings.llm_chat_model, api_key=settings.anthropic_api_key
        )
    if provider == "groq":
        from langchain_groq import ChatGroq

        return ChatGroq(model=settings.llm_chat_model, api_key=settings.groq_api_key)
    # default: openai-compatible (Groq's /openai/v1, Ollama, etc.)
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=settings.llm_chat_model,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
    )
```

- [ ] **Step 2: Write `app.py` with token auth + a model override hook for tests**

```python
from fastapi import Depends, FastAPI, Header, HTTPException

from tutor_agent.graph import build_graph
from tutor_agent.llm import get_chat_model
from tutor_agent.models import TurnRequest, TurnResponse
from tutor_agent.phases import FIRST_PHASE
from tutor_agent.settings import settings

app = FastAPI(title="Tutor Agent")

# Overridable in tests via app.dependency_overrides.
def model_provider():
    return get_chat_model()


def require_token(x_internal_token: str = Header(default="")):
    if x_internal_token != settings.internal_token:
        raise HTTPException(status_code=401, detail="bad internal token")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/agent/turn", response_model=TurnResponse)
def turn(
    req: TurnRequest,
    _: None = Depends(require_token),
    model=Depends(model_provider),
) -> TurnResponse:
    phase = req.phase or FIRST_PHASE
    graph = build_graph(model)
    out = graph.invoke(
        {
            "scenario": req.scenario,
            "phase": phase,
            "history": req.history,
            "message": req.message,
            "reply": "",
            "next_phase": phase,
        }
    )
    return TurnResponse(reply=out["reply"], phase=out["next_phase"])
```

- [ ] **Step 3: Write the failing endpoint test**

`services/tutor-agent/tests/test_app.py`:

```python
from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from tutor_agent.app import app, model_provider
from tutor_agent.settings import settings

client = TestClient(app)

BODY = {
    "scenario": {"title": "Disk full", "tutor_brief": "fault: disk fills"},
    "phase": "orient",
    "history": [],
    "message": "where do I start?",
}


def test_turn_rejects_bad_token():
    r = client.post("/agent/turn", json=BODY, headers={"X-Internal-Token": "wrong"})
    assert r.status_code == 401


def test_turn_happy_path_with_fake_model():
    app.dependency_overrides[model_provider] = lambda: FakeListChatModel(
        responses=["Start by reading the architecture.\nNEXT_PHASE: detect"]
    )
    try:
        r = client.post(
            "/agent/turn",
            json=BODY,
            headers={"X-Internal-Token": settings.internal_token},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["phase"] == "detect"
        assert "NEXT_PHASE" not in data["reply"]
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 4: Run the endpoint test**

Run: `cd H:/TRYOUT/services/tutor-agent && .venv/Scripts/pytest tests/test_app.py -q`
Expected: 2 passed.

- [ ] **Step 5: Run the full suite**

Run: `cd H:/TRYOUT/services/tutor-agent && .venv/Scripts/pytest -q`
Expected: all tests pass (phases 2, graph 3, app 2).

- [ ] **Step 6: Commit**

```bash
cd H:/TRYOUT
git add services/tutor-agent/tutor_agent/llm.py services/tutor-agent/tutor_agent/app.py services/tutor-agent/tests/test_app.py
git commit -m "feat(tutor-agent): FastAPI /agent/turn with internal-token auth"
```

---

## Task 6: NestJS env vars

**Files:**
- Modify: `apps/api/src/config/env.ts`

- [ ] **Step 1: Add the three env accessors**

In `apps/api/src/config/env.ts`, add before the closing `};` of the `env` object:

```ts
  // Tutor agent (Python LangGraph service).
  tutorAgentUrl: process.env.TUTOR_AGENT_URL ?? 'http://localhost:8000',
  tutorAgentToken: () => required('TUTOR_AGENT_TOKEN'),
  tutorDailyMessageLimit: Number(process.env.TUTOR_DAILY_MESSAGE_LIMIT ?? 50),
```

- [ ] **Step 2: Add fakes to the e2e setup so boot never blocks**

In `apps/api/test/jest-e2e.setup.ts`, add:

```ts
process.env.TUTOR_AGENT_TOKEN = 'test-internal-token';
```

- [ ] **Step 3: Typecheck**

Run: `cd H:/TRYOUT/apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
cd H:/TRYOUT
git add apps/api/src/config/env.ts apps/api/test/jest-e2e.setup.ts
git commit -m "feat(api): tutor agent env vars"
```

---

## Task 7: Tutor agent HTTP client

**Files:**
- Create: `apps/api/src/tutor/tutor-agent.client.ts`

- [ ] **Step 1: Implement the client (reads env at call time, so boot never needs the token)**

```ts
import { Injectable, BadGatewayException } from '@nestjs/common';
import { env } from '../config/env';

export interface AgentTurnRequest {
  scenario: { title: string; tutor_brief: string };
  phase: string | null;
  history: { role: string; content: string }[];
  message: string;
}

export interface AgentTurnResponse {
  reply: string;
  phase: string;
}

@Injectable()
export class TutorAgentClient {
  async turn(payload: AgentTurnRequest): Promise<AgentTurnResponse> {
    let res: Response;
    try {
      res = await fetch(`${env.tutorAgentUrl}/agent/turn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': env.tutorAgentToken(),
        },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new BadGatewayException('Tutor agent unreachable');
    }
    if (!res.ok) {
      throw new BadGatewayException(`Tutor agent error (${res.status})`);
    }
    return (await res.json()) as AgentTurnResponse;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd H:/TRYOUT/apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd H:/TRYOUT
git add apps/api/src/tutor/tutor-agent.client.ts
git commit -m "feat(api): tutor agent HTTP client"
```

---

## Task 8: TutorService — ownership, cost guard, persistence, phase

**Files:**
- Create: `apps/api/src/tutor/tutor.service.ts`

- [ ] **Step 1: Implement the service**

```ts
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { schema, type Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';
import { env } from '../config/env';
import { TutorAgentClient } from './tutor-agent.client';

const OWNED_STATUSES = ['invite_sent', 'paid', 'invite_failed'] as const;

export interface TutorMessageView {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}

@Injectable()
export class TutorService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly agent: TutorAgentClient,
  ) {}

  private async assertOwnership(userId: string, listingId: string): Promise<void> {
    const [owned] = await this.db
      .select({ id: schema.purchases.id })
      .from(schema.purchases)
      .where(
        and(
          eq(schema.purchases.userId, userId),
          eq(schema.purchases.listingId, listingId),
          inArray(schema.purchases.status, [...OWNED_STATUSES]),
        ),
      )
      .limit(1);
    if (!owned) throw new ForbiddenException('You do not own this scenario');
  }

  async getThread(
    userId: string,
    listingId: string,
  ): Promise<{ phase: string; messages: TutorMessageView[] }> {
    await this.assertOwnership(userId, listingId);
    const [thread] = await this.db
      .select({ phase: schema.tutorThreads.phase })
      .from(schema.tutorThreads)
      .where(
        and(
          eq(schema.tutorThreads.userId, userId),
          eq(schema.tutorThreads.listingId, listingId),
        ),
      )
      .limit(1);
    const messages = await this.db
      .select({
        id: schema.tutorMessages.id,
        role: schema.tutorMessages.role,
        content: schema.tutorMessages.content,
        createdAt: schema.tutorMessages.createdAt,
      })
      .from(schema.tutorMessages)
      .where(
        and(
          eq(schema.tutorMessages.userId, userId),
          eq(schema.tutorMessages.listingId, listingId),
        ),
      )
      .orderBy(asc(schema.tutorMessages.createdAt));
    return { phase: thread?.phase ?? 'orient', messages };
  }

  async postMessage(
    userId: string,
    listingId: string,
    content: string,
  ): Promise<{ reply: string; phase: string }> {
    await this.assertOwnership(userId, listingId);
    await this.enforceCostGuard(userId);

    const [listing] = await this.db
      .select({
        title: schema.scenarioListings.title,
        tutorBrief: schema.scenarioListings.tutorBrief,
      })
      .from(schema.scenarioListings)
      .where(eq(schema.scenarioListings.id, listingId))
      .limit(1);
    if (!listing) throw new ForbiddenException('You do not own this scenario');
    if (!listing.tutorBrief) {
      throw new UnprocessableEntityException('Tutor not available for this scenario');
    }

    const { phase, messages } = await this.getThread(userId, listingId);
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    const result = await this.agent.turn({
      scenario: { title: listing.title, tutor_brief: listing.tutorBrief },
      phase,
      history,
      message: content,
    });

    await this.db.insert(schema.tutorMessages).values([
      { userId, listingId, role: 'user', content },
      { userId, listingId, role: 'assistant', content: result.reply },
    ]);
    await this.upsertPhase(userId, listingId, result.phase);

    return { reply: result.reply, phase: result.phase };
  }

  private async enforceCostGuard(userId: string): Promise<void> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({ id: schema.tutorMessages.id })
      .from(schema.tutorMessages)
      .where(
        and(
          eq(schema.tutorMessages.userId, userId),
          eq(schema.tutorMessages.role, 'user'),
          gt(schema.tutorMessages.createdAt, since),
        ),
      );
    if (rows.length >= env.tutorDailyMessageLimit) {
      throw new HttpException(
        'Daily tutor message limit reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async upsertPhase(
    userId: string,
    listingId: string,
    phase: string,
  ): Promise<void> {
    await this.db
      .insert(schema.tutorThreads)
      .values({ userId, listingId, phase, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.tutorThreads.userId, schema.tutorThreads.listingId],
        set: { phase, updatedAt: new Date() },
      });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd H:/TRYOUT/apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: clean. (If `inArray` types complain about the readonly tuple, the `[...OWNED_STATUSES]` spread already handles it.)

- [ ] **Step 3: Commit**

```bash
cd H:/TRYOUT
git add apps/api/src/tutor/tutor.service.ts
git commit -m "feat(api): TutorService with ownership, cost guard, phase persistence"
```

---

## Task 9: DTO, controller, module wiring

**Files:**
- Create: `apps/api/src/tutor/dto/send-tutor-message.dto.ts`
- Create: `apps/api/src/tutor/tutor.controller.ts`
- Create: `apps/api/src/tutor/tutor.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: DTO**

`apps/api/src/tutor/dto/send-tutor-message.dto.ts`:

```ts
import { IsString, MinLength, MaxLength } from 'class-validator';

export class SendTutorMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}
```

- [ ] **Step 2: Controller**

`apps/api/src/tutor/tutor.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { TutorService } from './tutor.service';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SendTutorMessageDto } from './dto/send-tutor-message.dto';

@Controller('tutor')
export class TutorController {
  constructor(private readonly service: TutorService) {}

  @UseGuards(JwtAuthGuard)
  @Get(':listingId/messages')
  getThread(@CurrentUser() user: AuthUser, @Param('listingId') listingId: string) {
    return this.service.getThread(user.sub, listingId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':listingId/messages')
  post(
    @CurrentUser() user: AuthUser,
    @Param('listingId') listingId: string,
    @Body() dto: SendTutorMessageDto,
  ) {
    return this.service.postMessage(user.sub, listingId, dto.content);
  }
}
```

- [ ] **Step 3: Module**

`apps/api/src/tutor/tutor.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TutorController } from './tutor.controller';
import { TutorService } from './tutor.service';
import { TutorAgentClient } from './tutor-agent.client';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [TutorController],
  providers: [TutorService, TutorAgentClient],
})
export class TutorModule {}
```

- [ ] **Step 4: Wire into `app.module.ts`**

Add the import and list it in `imports`:

```ts
import { TutorModule } from './tutor/tutor.module';
```
```ts
  imports: [DbModule, AuthModule, CatalogModule, PurchasesModule, TutorModule],
```

- [ ] **Step 5: Typecheck + unit suite (should still pass, nothing broke)**

Run: `cd H:/TRYOUT && pnpm --filter @tryout/api test`
Expected: existing suites green.

- [ ] **Step 6: Commit**

```bash
cd H:/TRYOUT
git add apps/api/src/tutor apps/api/src/app.module.ts
git commit -m "feat(api): TutorModule controller + wiring"
```

---

## Task 10: E2E — ownership, missing brief, happy path, resume

**Files:**
- Create: `apps/api/test/tutor.e2e-spec.ts`

- [ ] **Step 1: Write the e2e spec (mocks the agent client + Stripe, uses real Postgres)**

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import postgres from 'postgres';
import { AppModule } from '../src/app.module';
import { StripeService } from '../src/purchases/stripe.service';
import { TutorAgentClient } from '../src/tutor/tutor-agent.client';

const mockStripe = {
  createCheckoutSession: jest.fn(),
  expireCheckoutSession: jest.fn(),
  constructEvent: jest.fn(),
};

const mockAgent = {
  turn: jest.fn().mockResolvedValue({
    reply: 'Start by checking df -h.',
    phase: 'detect',
  }),
};

describe('Tutor (e2e)', () => {
  let app: INestApplication;
  let sql: ReturnType<typeof postgres>;
  let token: string;
  let listingId: string;
  let userId: string;
  const slug = `e2e-tutor-${Date.now()}`;
  const email = `tutor-${Date.now()}@example.com`;

  beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL!);
    const [listing] = await sql`
      INSERT INTO scenario_listings
        (slug, title, tagline, story, contents, price_cents, currency, content_repo, tutor_brief, status)
      VALUES
        (${slug}, 'E2E Tutor', 't', 's', 'c', 2900, 'usd', 'repo-x',
         'FAULT: disk fills. Guide one phase at a time.', 'published')
      RETURNING id`;
    listingId = listing.id as string;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StripeService)
      .useValue(mockStripe)
      .overrideProvider(TutorAgentClient)
      .useValue(mockAgent)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'sup3r-secret-pw' })
      .expect(201);
    token = res.body.token;
    const [u] = await sql`SELECT id FROM users WHERE email = ${email}`;
    userId = u.id as string;
  });

  afterAll(async () => {
    await sql`DELETE FROM tutor_messages WHERE listing_id = ${listingId}`;
    await sql`DELETE FROM tutor_threads WHERE listing_id = ${listingId}`;
    await sql`DELETE FROM purchases WHERE listing_id = ${listingId}`;
    await sql`DELETE FROM scenario_listings WHERE id = ${listingId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    await sql.end();
    await app.close();
  });

  it('403 when the user does not own the scenario', async () => {
    await request(app.getHttpServer())
      .post(`/tutor/${listingId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'help' })
      .expect(403);
  });

  it('owner round-trip: post then resume returns both turns + phase', async () => {
    await sql`
      INSERT INTO purchases (user_id, listing_id, amount_cents, status)
      VALUES (${userId}, ${listingId}, 2900, 'invite_sent')`;

    const post = await request(app.getHttpServer())
      .post(`/tutor/${listingId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'where do I start?' })
      .expect(201);
    expect(post.body.reply).toBe('Start by checking df -h.');
    expect(post.body.phase).toBe('detect');

    const get = await request(app.getHttpServer())
      .get(`/tutor/${listingId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(get.body.phase).toBe('detect');
    expect(get.body.messages).toHaveLength(2);
    expect(get.body.messages[0].role).toBe('user');
    expect(get.body.messages[1].role).toBe('assistant');
  });

  it('401 without a token', async () => {
    await request(app.getHttpServer())
      .get(`/tutor/${listingId}/messages`)
      .expect(401);
  });
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `cd H:/TRYOUT && DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout JWT_SECRET=dev pnpm --filter @tryout/api test:e2e`
Expected: all suites pass, including the 3 new tutor tests.

- [ ] **Step 3: Commit**

```bash
cd H:/TRYOUT
git add apps/api/test/tutor.e2e-spec.ts
git commit -m "test(api): tutor e2e - ownership, round-trip, resume"
```

---

## Task 11: Web API client methods

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Add types and methods**

Add near the other interfaces:

```ts
export interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface TutorThread {
  phase: string;
  messages: TutorMessage[];
}
```

Add inside the `api` object (before the closing `};`):

```ts
  getTutorThread: async (listingId: string): Promise<TutorThread> => {
    const res = await fetch(`${API_URL}/tutor/${listingId}/messages`, {
      headers: { ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Failed to load tutor (${res.status})`);
    return res.json() as Promise<TutorThread>;
  },

  sendTutorMessage: async (
    listingId: string,
    content: string,
  ): Promise<{ reply: string; phase: string }> => {
    const res = await fetch(`${API_URL}/tutor/${listingId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res, `Failed to send (${res.status})`));
    }
    return res.json() as Promise<{ reply: string; phase: string }>;
  },
```

- [ ] **Step 2: Typecheck**

Run: `cd H:/TRYOUT/apps/web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd H:/TRYOUT
git add apps/web/src/lib/api.ts
git commit -m "feat(web): tutor api client methods"
```

---

## Task 12: Web tutor chat page

**Files:**
- Create: `apps/web/src/app/scenarios/[slug]/tutor/tutor.module.css`
- Create: `apps/web/src/app/scenarios/[slug]/tutor/page.tsx`

- [ ] **Step 1: Resolve listing id — the page has the slug, the tutor API is keyed by listing id**

The chat needs the listing id. Fetch it from the public catalog by slug. Add a resolver call in the page (below). No API change needed — `GET /catalog/:slug` returns `{ id, ... }`.

- [ ] **Step 2: Write `tutor.module.css`** (reuses the home brand-band language)

```css
.band { background: var(--brand-gradient); color: white; }
.bandInner {
  max-width: 860px; margin: 0 auto;
  padding: 0 clamp(1.25rem, 4vw, 2.5rem) clamp(1.5rem, 4vw, 2rem);
}
.nav {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-3); height: 68px;
}
.logo { font-family: var(--font-display), sans-serif; font-weight: 600; color: white; }
.logo b { color: var(--color-signal); }
.back { color: oklch(82% 0.03 264); font-weight: 600; font-size: var(--text-sm); }
.back:hover { color: white; text-decoration: none; }
.title {
  font-family: var(--font-display), sans-serif; font-weight: 600;
  font-size: clamp(1.4rem, 1.1rem + 1.4vw, 2rem); margin: 0.5rem 0 0.35rem; color: white;
}
.phase {
  font-family: var(--font-mono), monospace; font-size: var(--text-sm);
  color: var(--color-signal); text-transform: uppercase; letter-spacing: 0.06em;
}
.body { max-width: 860px; margin: 0 auto; padding: clamp(1.5rem, 4vw, 2.5rem) clamp(1.25rem, 4vw, 2.5rem) 3rem; }
.thread { display: flex; flex-direction: column; gap: var(--space-3); margin-bottom: var(--space-4); }
.turn { max-width: 80%; padding: var(--space-2) var(--space-3); border-radius: var(--radius); line-height: 1.55; white-space: pre-wrap; }
.user { align-self: flex-end; background: var(--color-accent); color: white; }
.assistant { align-self: flex-start; background: var(--color-surface); border: 1px solid var(--color-line); color: var(--color-ink); }
.greeting { color: var(--color-muted); line-height: 1.6; padding: var(--space-3); border: 1px dashed var(--color-line); border-radius: var(--radius); margin-bottom: var(--space-4); }
.form { display: flex; gap: var(--space-2); align-items: flex-end; position: sticky; bottom: 1rem; }
.input {
  flex: 1; min-height: 2.75rem; max-height: 12rem; resize: vertical;
  padding: 0.7rem 0.85rem; font: inherit; color: var(--color-ink);
  background: var(--color-surface); border: 1px solid var(--color-line); border-radius: var(--radius-sm);
}
.input:focus-visible { outline: none; border-color: var(--color-accent); box-shadow: var(--ring); }
.send { width: auto; padding: 0.7rem 1.2rem; }
.error { color: var(--color-danger); margin: var(--space-2) 0; }
```

- [ ] **Step 3: Write `page.tsx`**

```tsx
'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type TutorMessage } from '@/lib/api';
import styles from './tutor.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function TutorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const [listingId, setListingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState('orient');
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = window.localStorage.getItem('tryout_token');
    if (!token) {
      router.replace(`/login?next=/scenarios/${slug}/tutor`);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API_URL}/catalog/${slug}`);
        if (!res.ok) throw new Error('Scenario not found');
        const listing = (await res.json()) as { id: string; title: string };
        setListingId(listing.id);
        setTitle(listing.title);
        const thread = await api.getTutorThread(listing.id);
        setPhase(thread.phase);
        setMessages(thread.messages);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
  }, [slug, router]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!listingId || !input.trim() || sending) return;
    const content = input.trim();
    setInput('');
    setError(null);
    setSending(true);
    const optimistic: TutorMessage = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    try {
      const res = await api.sendTutorMessage(listingId, content);
      setPhase(res.phase);
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: res.reply,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(content);
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <main>
      <div className={styles.band}>
        <div className={styles.bandInner}>
          <nav className={styles.nav}>
            <Link href="/home" className={styles.logo}>
              Try<b>out</b>
            </Link>
            <Link href="/home" className={styles.back}>
              Back to scenarios
            </Link>
          </nav>
          <h1 className={styles.title}>{title || 'Tutor'}</h1>
          <span className={styles.phase}>Phase: {phase}</span>
        </div>
      </div>

      <div className={styles.body}>
        {messages.length === 0 && !error && (
          <p className={styles.greeting}>
            I&apos;ll walk you through this incident one phase at a time. Tell me where you
            are, or describe what you&apos;re seeing, and we&apos;ll start from there.
          </p>
        )}
        <div className={styles.thread}>
          {messages.map((m) => (
            <div
              key={m.id}
              className={`${styles.turn} ${m.role === 'user' ? styles.user : styles.assistant}`}
            >
              {m.content}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.form}>
          <textarea
            className={styles.input}
            value={input}
            placeholder="Describe what you see…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className={styles.send} onClick={() => void send()} disabled={sending}>
            {sending ? 'Thinking…' : 'Send'}
          </button>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd H:/TRYOUT/apps/web && npx tsc --noEmit`
Expected: clean. (If `use(params)` errors on the installed React types, change the signature to `{ params }: { params: { slug: string } }` and read `params.slug` directly — Next 14 supports both.)

- [ ] **Step 5: Commit**

```bash
cd H:/TRYOUT
git add apps/web/src/app/scenarios
git commit -m "feat(web): tutor chat page"
```

---

## Task 13: "Open tutor" links on home + library

**Files:**
- Modify: `apps/web/src/app/home/page.tsx`
- Modify: `apps/web/src/app/library/page.tsx`

- [ ] **Step 1: Home — owned cards link to the tutor**

In `apps/web/src/app/home/page.tsx`, the owned branch currently links to `/library`. Change the card `href` for owned scenarios to the tutor page. Find:

```ts
              const own = owned.get(l.slug);
              const href = own ? '/library' : `/scenarios/${l.slug}`;
```

Replace with:

```ts
              const own = owned.get(l.slug);
              const href = own ? `/scenarios/${l.slug}/tutor` : `/scenarios/${l.slug}`;
```

And update the owned action label. Find:

```tsx
                          <span className={styles.action}>
                            {own === 'ready' ? 'Open in library →' : 'View status →'}
                          </span>
```

Replace with:

```tsx
                          <span className={styles.action}>
                            {own === 'ready' ? 'Open tutor →' : 'View status →'}
                          </span>
```

- [ ] **Step 2: Library — add a tutor link per owned item**

In `apps/web/src/app/library/page.tsx`, inside the `<li>` map, after the `repoUrl` link block, add a tutor link (uses `p.listingSlug`):

```tsx
            {p.status === 'invite_sent' && (
              <Link href={`/scenarios/${p.listingSlug}/tutor`}>Open tutor</Link>
            )}
```

Ensure `Link` is imported (it already is in library page).

- [ ] **Step 3: Typecheck**

Run: `cd H:/TRYOUT/apps/web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual smoke (optional, needs the Python service running)**

```bash
# Terminal A: start the agent
cd H:/TRYOUT/services/tutor-agent && .venv/Scripts/uvicorn tutor_agent.app:app --port 8000
# Ensure apps/api has TUTOR_AGENT_TOKEN matching the service's INTERNAL_TOKEN.
```
Then log in, open an owned scenario's tutor, send a message, confirm a reply and the phase label.

- [ ] **Step 5: Commit**

```bash
cd H:/TRYOUT
git add apps/web/src/app/home/page.tsx apps/web/src/app/library/page.tsx
git commit -m "feat(web): open-tutor links on home and library"
```

---

## Task 14: Docs — note the polyglot service

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a short section to `CLAUDE.md`**

Under the Monorepo Layout tree, add `services/tutor-agent/ — Python FastAPI + LangGraph tutor agent (P1)`. Add a one-line run note near "Running the Stack":

```
# Tutor agent (Python): cd services/tutor-agent && .venv/Scripts/uvicorn tutor_agent.app:app --port 8000
# NestJS must have TUTOR_AGENT_URL + TUTOR_AGENT_TOKEN (matching the service) set.
```

- [ ] **Step 2: Commit**

```bash
cd H:/TRYOUT
git add CLAUDE.md
git commit -m "docs: note tutor-agent python service"
```

---

## Done — P1 acceptance ✅ (verified 2026-07-19)

- Python agent: `pytest` green — **7 passed** (phases 2, graph 3, endpoint 2).
- NestJS: unit **34 passed**; e2e **20 passed** including tutor ownership/round-trip/resume (`test/tutor.e2e-spec.ts`).
- Web: typecheck clean; owned scenarios link to a working tutor chat.
- A buyer of a scenario with a `tutorBrief` can chat with the tutor, see the phase advance, and resume after reload.

All 14 tasks committed on `feat/ai-tutor-p1` (last: `ceb0711` docs). Task checkboxes above left unflipped; this section is the authoritative status.

**Next (not this plan):** P2 tools (`grade_postmortem`, `lookup_runbook`), P3 RAG over runbook (pgvector), streaming, and Cloud Run deployment of the Python service.
