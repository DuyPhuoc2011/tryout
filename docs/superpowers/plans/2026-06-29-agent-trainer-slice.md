# Agent-Building Trainer — Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first slice of the agent-trainer pivot — two Python agent-building scenarios (Rung 0 "call the model", Rung 1 "give it a tool") that a learner runs through the existing Tryout loop, plus the two engine changes that make per-scenario templates and fix-and-resubmit work.

**Architecture:** Reuse the Tryout engine (intake, run orchestration, PM/senior personas, LLM grader, scorecard). Two engine changes: **E1** thread a per-scenario template repo through repo provisioning; **E2** make the PR→CI→review poll loop repeatable so pushed fixes get re-reviewed. New content: two Python template repos (skeleton + pytest acceptance tests that mock the LLM) and two scenario definitions seeded into a new `ai-agents` track.

**Tech Stack:** NestJS 10 + Drizzle (engine, TypeScript), BullMQ (queues), Octokit (GitHub), Python 3.11 + pytest + `anthropic` SDK (template repos), GitHub Actions (candidate CI).

**Spec:** `docs/superpowers/specs/2026-06-29-agent-trainer-pivot-design.md`

---

## Scope & Decomposition Note

This plan has two semi-independent halves that could be split if you prefer smaller PRs:
- **Engine (Phase A + B):** E1 + E2. Pure TypeScript, no content. Independently testable and mergeable; scenario-01 keeps working.
- **Content (Phase C + D):** Python templates + scenario seeds. Depends on E1 (per-scenario template) and E2 (retry loop) to run end-to-end, but the files can be authored in parallel.

Phase E verifies the whole slice. If splitting into two PRs: PR1 = Phase A+B (engine, regression-safe), PR2 = Phase C+D+E (content + e2e).

---

## Phase A — Engine change E1: per-scenario template repo

Today `github.service.createRepoFromTemplate(userId)` always clones the single `GITHUB_TEMPLATE_REPO`. Make it accept the scenario's `repo.template_ref`, defaulting to the env template so scenario-01 is unaffected.

### Task A1: Add `repo` to the ScenarioDefinition type

**Files:**
- Modify: `packages/shared/src/scenario.ts`

- [ ] **Step 1: Add the `repo` field to the interface**

In `packages/shared/src/scenario.ts`, add this interface above `ScenarioDefinition`:

```typescript
export interface ScenarioRepo {
  template_ref: string;
  default_branch?: string;
  ci?: string;
}
```

Then add the field inside `ScenarioDefinition` (after the `catalog?` line):

```typescript
  /** Which GitHub template repo this scenario provisions from. Falls back to env default. */
  repo?: ScenarioRepo;
```

- [ ] **Step 2: Build the shared package to confirm types compile**

Run: `pnpm --filter @tryout/shared build`
Expected: builds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/scenario.ts
git commit -m "feat(shared): add repo.template_ref to ScenarioDefinition"
```

### Task A2: `createRepoFromTemplate` accepts a template override

**Files:**
- Modify: `apps/api/src/github/github.service.ts:38-53`
- Test: `apps/api/src/github/github.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/github/github.service.spec.ts` (inside the existing describe for the service; mirror how the file already constructs `GitHubService` and stubs `octokit`):

```typescript
it('uses the provided template repo when one is passed', async () => {
  const createUsingTemplate = jest
    .fn()
    .mockResolvedValue({ data: { html_url: 'u', full_name: 'o/agent-foundations-py-x' } });
  // @ts-expect-error reach into the private octokit for the test
  service['octokit'] = { rest: { repos: { createUsingTemplate } } };

  await service.createRepoFromTemplate('user1234abcd', 'agent-foundations-py');

  expect(createUsingTemplate).toHaveBeenCalledWith(
    expect.objectContaining({ template_repo: 'agent-foundations-py' }),
  );
});

it('falls back to the env template repo when none is passed', async () => {
  const createUsingTemplate = jest
    .fn()
    .mockResolvedValue({ data: { html_url: 'u', full_name: 'o/lumi-tasks-x' } });
  // @ts-expect-error reach into the private octokit for the test
  service['octokit'] = { rest: { repos: { createUsingTemplate } } };

  await service.createRepoFromTemplate('user1234abcd');

  expect(createUsingTemplate).toHaveBeenCalledWith(
    expect.objectContaining({ template_repo: 'lumi-tasks-api' }),
  );
});
```

(If the existing spec constructs the service as `new GitHubService('tok', 'o', 'lumi-tasks-api')`, keep that. Adjust the expected fallback string to whatever the spec passes as the third constructor arg.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tryout/api test -- github.service`
Expected: FAIL — `createRepoFromTemplate` currently ignores the second argument.

- [ ] **Step 3: Implement the override**

Replace `createRepoFromTemplate` in `apps/api/src/github/github.service.ts`:

```typescript
  async createRepoFromTemplate(
    userId: string,
    templateRepo: string = this.templateRepo,
  ): Promise<CreatedRepo> {
    const repoName = `${templateRepo}-${userId.slice(0, 8)}-${Date.now()}`;
    const response = await this.octokit.rest.repos.createUsingTemplate({
      template_owner: this.owner,
      template_repo: templateRepo,
      owner: this.owner,
      name: repoName,
      private: true,
      include_all_branches: false,
    });
    return {
      htmlUrl: response.data.html_url,
      fullName: response.data.full_name,
      repoName,
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tryout/api test -- github.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/github/github.service.ts apps/api/src/github/github.service.spec.ts
git commit -m "feat(github): per-scenario template repo override with env fallback"
```

### Task A3: Pass the scenario's template_ref from startRun

**Files:**
- Modify: `apps/api/src/scenario-runs/scenario-runs.service.ts:70-80`
- Test: `apps/api/src/scenario-runs/scenario-runs.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/scenario-runs/scenario-runs.service.spec.ts` (mirror the existing `startRun` happy-path test setup — it mocks the Db, `GitHubService`, and `QueueService`). The key assertion:

```typescript
it('provisions from the scenario template_ref when present', async () => {
  // Arrange: scenario.definition includes repo.template_ref and a valid team/role.
  // (Reuse the existing happy-path mocks; set definition.repo = { template_ref: 'agent-foundations-py' }.)
  await service.startRun('user-1', { scenarioId: 'scn-1', role: 'backend_engineer' });

  expect(github.createRepoFromTemplate).toHaveBeenCalledWith('user-1', 'agent-foundations-py');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tryout/api test -- scenario-runs.service`
Expected: FAIL — `createRepoFromTemplate` is currently called with only `userId`.

- [ ] **Step 3: Implement passing the template_ref**

In `apps/api/src/scenario-runs/scenario-runs.service.ts`, the `def` is already read at line ~52 (`const def = scenario.definition as ScenarioDefinition;`). Change the provisioning call (currently `await this.github.createRepoFromTemplate(userId)`):

```typescript
      created = await this.github.createRepoFromTemplate(userId, def.repo?.template_ref);
```

`def.repo?.template_ref` is `string | undefined`; `undefined` triggers the env-default in A2. No other changes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tryout/api test -- scenario-runs.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scenario-runs/scenario-runs.service.ts apps/api/src/scenario-runs/scenario-runs.service.spec.ts
git commit -m "feat(runs): provision repo from scenario template_ref"
```

---

## Phase B — Engine change E2: repeatable review loop (retry-to-learn)

Today `poll-pr` inserts one submission on the first PR and stops; `poll-ci` polls only the first `headSha`. A fix pushed after a review is never re-detected. Make `poll-pr` a bounded long-poll that creates a new submission for each new head commit, so each fix flows through CI → review again.

### Task B1: Add a `headSha` column to submissions

**Files:**
- Modify: `packages/db/src/schema.ts:119-128`
- Create: `packages/db/migrations/0003_*.sql` (generated)

- [ ] **Step 1: Add the column to the schema**

In `packages/db/src/schema.ts`, inside the `submissions` table, add after the `prUrl` line:

```typescript
  headSha: text('head_sha'),
```

(Nullable — existing rows have no head sha, and scenario-01 submissions created before this still work.)

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @tryout/db generate`
Expected: a new `migrations/0003_*.sql` containing `ALTER TABLE "submissions" ADD COLUMN "head_sha" text;` plus an updated snapshot under `migrations/meta/`.

- [ ] **Step 3: Apply the migration**

Run: `DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/db migrate`
Expected: migration `0003` applied, no errors.

- [ ] **Step 4: Build the db package**

Run: `pnpm --filter @tryout/db build`
Expected: builds clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations
git commit -m "feat(db): add submissions.head_sha for per-commit dedupe"
```

### Task B2: Rewrite poll-pr as a bounded, dedup-by-headSha long-poll

**Files:**
- Modify: `apps/api/src/queue/processors/poll-pr.processor.ts`
- Test: `apps/api/src/queue/processors/poll-pr.processor.spec.ts`

- [ ] **Step 1: Write the failing tests**

Replace the body of the describe in `apps/api/src/queue/processors/poll-pr.processor.spec.ts` with tests for the new behavior (keep the existing mock setup style — the processor is constructed with mocked `db`, `github`, `queue`). Cover three cases:

```typescript
it('creates a submission and re-arms when a new head sha appears', async () => {
  github.listOpenPullRequests.mockResolvedValue([
    { number: 7, headSha: 'sha-new', htmlUrl: 'https://github.com/o/r/pull/7', title: 't' },
  ]);
  // No existing submission for sha-new:
  selectWhereReturns([]); // helper that makes the dedupe SELECT return []
  insertReturns([{ id: 'sub-1' }]);

  await processor.process({ data: { scenarioRunId: 'run-1', repoOwner: 'o', repoName: 'r', attemptCount: 0 } } as any);

  expect(queue.enqueuePollCi).toHaveBeenCalledWith(
    expect.objectContaining({ submissionId: 'sub-1', headSha: 'sha-new', prNumber: 7 }),
    expect.any(Number),
  );
  expect(queue.enqueuePollPr).toHaveBeenCalledWith(
    expect.objectContaining({ scenarioRunId: 'run-1', attemptCount: 1 }),
    expect.any(Number),
  );
});

it('does NOT create a duplicate submission for a head sha already seen, but still re-arms', async () => {
  github.listOpenPullRequests.mockResolvedValue([
    { number: 7, headSha: 'sha-seen', htmlUrl: 'https://github.com/o/r/pull/7', title: 't' },
  ]);
  selectWhereReturns([{ id: 'sub-existing' }]); // dedupe SELECT finds it

  await processor.process({ data: { scenarioRunId: 'run-1', repoOwner: 'o', repoName: 'r', attemptCount: 0 } } as any);

  expect(queue.enqueuePollCi).not.toHaveBeenCalled();
  expect(queue.enqueuePollPr).toHaveBeenCalledWith(
    expect.objectContaining({ attemptCount: 1 }),
    expect.any(Number),
  );
});

it('re-arms with no submission when there is no open PR yet', async () => {
  github.listOpenPullRequests.mockResolvedValue([]);

  await processor.process({ data: { scenarioRunId: 'run-1', repoOwner: 'o', repoName: 'r', attemptCount: 0 } } as any);

  expect(queue.enqueuePollCi).not.toHaveBeenCalled();
  expect(queue.enqueuePollPr).toHaveBeenCalledWith(
    expect.objectContaining({ attemptCount: 1 }),
    expect.any(Number),
  );
});

it('stops re-arming at max attempts', async () => {
  await processor.process({ data: { scenarioRunId: 'run-1', repoOwner: 'o', repoName: 'r', attemptCount: 999 } } as any);
  expect(github.listOpenPullRequests).not.toHaveBeenCalled();
  expect(queue.enqueuePollPr).not.toHaveBeenCalled();
});
```

(The `selectWhereReturns` / `insertReturns` helpers stand in for the existing file's Drizzle-mock pattern — wire them to the same chained-mock the spec already uses for `db.select()...where()...limit()` and `db.insert()...values()...returning()`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tryout/api test -- poll-pr.processor`
Expected: FAIL — current processor only creates a submission once and never re-arms.

- [ ] **Step 3: Rewrite the processor**

Replace `apps/api/src/queue/processors/poll-pr.processor.ts` with:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import { DRIZZLE } from '../../db/db.module';
import { GitHubService } from '../../github/github.service';
import { QueueService } from '../queue.service';
import { QUEUE_NAMES, PollPrJobData } from '../queue.constants';
import { env } from '../../config/env';

// Bounded long-poll. Watches the candidate's PR for each new head commit so that
// fixes pushed after a review flow back through CI → review (retry-to-learn).
// ponytail: bounded by pollMaxAttempts; no webhook. Add a GitHub webhook if poll
// latency or API budget ever bites.
@Processor(QUEUE_NAMES.POLL_PR)
export class PollPrProcessor extends WorkerHost {
  private readonly logger = new Logger(PollPrProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly github: GitHubService,
    private readonly queue: QueueService,
  ) {
    super();
  }

  async process(job: Job<PollPrJobData>): Promise<void> {
    const { scenarioRunId, repoOwner, repoName, attemptCount } = job.data;

    if (attemptCount >= env.pollMaxAttempts) {
      this.logger.warn(`poll-pr max attempts reached for run ${scenarioRunId}`);
      return;
    }

    const prs = await this.github.listOpenPullRequests(repoOwner, repoName);
    const pr = prs[0];

    if (pr) {
      const existing = await this.db
        .select({ id: schema.submissions.id })
        .from(schema.submissions)
        .where(
          and(
            eq(schema.submissions.scenarioRunId, scenarioRunId),
            eq(schema.submissions.headSha, pr.headSha),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        this.logger.log(`New commit ${pr.headSha} on PR #${pr.number} for run ${scenarioRunId}`);
        const [submission] = await this.db
          .insert(schema.submissions)
          .values({
            scenarioRunId,
            prUrl: pr.htmlUrl,
            headSha: pr.headSha,
            ciStatus: 'pending',
          })
          .returning();

        await this.queue.enqueuePollCi(
          {
            submissionId: submission.id,
            repoOwner,
            repoName,
            prNumber: pr.number,
            headSha: pr.headSha,
            attemptCount: 0,
          },
          env.pollCiIntervalMs,
        );
      }
    }

    // Keep watching for the next commit until the attempt ceiling.
    await this.queue.enqueuePollPr(
      { scenarioRunId, repoOwner, repoName, attemptCount: attemptCount + 1 },
      env.pollPrIntervalMs,
    );
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tryout/api test -- poll-pr.processor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/queue/processors/poll-pr.processor.ts apps/api/src/queue/processors/poll-pr.processor.spec.ts
git commit -m "feat(queue): repeatable PR poll — new submission per head commit (retry-to-learn)"
```

### Task B3: Confirm poll-ci still terminates the per-commit branch

`poll-ci` already self-terminates (stops re-enqueuing once checks complete) and enqueues `review`. No change needed — each new submission from B2 starts its own `poll-ci` chain with `attemptCount: 0`. This task is a verification only.

- [ ] **Step 1: Re-run the poll-ci tests to confirm no regression**

Run: `pnpm --filter @tryout/api test -- poll-ci.processor`
Expected: PASS (unchanged).

---

## Phase C — Python template repos (content)

Two real GitHub template repos under `GITHUB_OWNER`, authored locally under `templates/` first. Each: installs cleanly, ships pytest acceptance tests that **mock the LLM**, and is green on a clean checkout *with the reference solution applied* but **red on the unimplemented skeleton** the student receives. The student's job is to turn it green.

> Design choice: two separate self-contained repos (not a shared base). Rung 1 ships the model-call already implemented so the learner focuses only on tool wiring. `ponytail`: duplication of ~30 lines beats a shared-package indirection for two repos.

### Task C1: Rung-0 template — "Wire up the model" (skeleton, red)

**Files (all under `templates/agent-foundations-py/`):**
- Create: `pyproject.toml`
- Create: `agent/__init__.py`
- Create: `agent/llm_client.py` (the injectable client protocol + a real Anthropic-backed impl)
- Create: `agent/model_call.py` (the student's stub — raises `NotImplementedError`)
- Create: `tests/conftest.py` (fake LLM client fixture)
- Create: `tests/test_model_call.py` (acceptance tests)
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

- [ ] **Step 1: Project + dependencies**

`templates/agent-foundations-py/pyproject.toml`:

```toml
[project]
name = "agent-foundations"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["anthropic>=0.39.0"]

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`templates/agent-foundations-py/agent/__init__.py`:

```python
```

- [ ] **Step 2: The injectable client seam**

`templates/agent-foundations-py/agent/llm_client.py`:

```python
"""The LLM seam. Tests inject a fake; production uses Anthropic.

Keep all real network access behind this Protocol so the rest of the agent is
deterministically testable.
"""
from __future__ import annotations

from typing import Any, Protocol


class LlmClient(Protocol):
    def create_message(self, *, model: str, max_tokens: int, messages: list[dict[str, Any]]) -> Any:
        """Return an object exposing `.content` (a list of content blocks)."""
        ...


class AnthropicClient:
    """Thin real client. Not exercised in tests."""

    def __init__(self, api_key: str) -> None:
        import anthropic

        self._client = anthropic.Anthropic(api_key=api_key)

    def create_message(self, *, model: str, max_tokens: int, messages: list[dict[str, Any]]) -> Any:
        return self._client.messages.create(model=model, max_tokens=max_tokens, messages=messages)
```

- [ ] **Step 3: The student's stub**

`templates/agent-foundations-py/agent/model_call.py`:

```python
"""TICKET AGENT-0: implement summarize().

summarize(client, text) must:
  - call client.create_message with model "claude-haiku-4-5", max_tokens 256,
    and a single user message asking for a one-sentence summary of `text`;
  - return the text of the first content block, stripped;
  - raise SummarizationError (not a raw exception) if the client call fails;
  - raise SummarizationError if the response has no content blocks.

Do NOT change the test files. Make the tests pass.
"""
from __future__ import annotations

from .llm_client import LlmClient

MODEL = "claude-haiku-4-5"
MAX_TOKENS = 256


class SummarizationError(Exception):
    pass


def summarize(client: LlmClient, text: str) -> str:
    raise NotImplementedError("Implement summarize() — see the ticket in this file's docstring.")
```

- [ ] **Step 4: The fake-LLM fixture**

`templates/agent-foundations-py/tests/conftest.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import pytest


@dataclass
class _Block:
    text: str


@dataclass
class _Response:
    content: list[_Block]


class FakeLlmClient:
    """Records the last call and returns a scripted response (or raises)."""

    def __init__(self, *, responder: Callable[..., Any]) -> None:
        self._responder = responder
        self.last_call: dict[str, Any] | None = None

    def create_message(self, **kwargs: Any) -> Any:
        self.last_call = kwargs
        return self._responder(**kwargs)


@pytest.fixture
def make_client():
    def _make(responder: Callable[..., Any]) -> FakeLlmClient:
        return FakeLlmClient(responder=responder)

    return _make


@pytest.fixture
def ok_response():
    def _responder(**_: Any) -> _Response:
        return _Response(content=[_Block(text="  A concise summary.  ")])

    return _responder
```

- [ ] **Step 5: The acceptance tests (the C part)**

`templates/agent-foundations-py/tests/test_model_call.py`:

```python
from __future__ import annotations

import pytest

from agent.model_call import MODEL, SummarizationError, summarize


def test_calls_model_with_expected_request_shape(make_client, ok_response):
    client = make_client(ok_response)
    summarize(client, "some long text")
    assert client.last_call is not None
    assert client.last_call["model"] == MODEL
    assert client.last_call["max_tokens"] == 256
    messages = client.last_call["messages"]
    assert len(messages) == 1
    assert messages[0]["role"] == "user"
    assert "some long text" in messages[0]["content"]


def test_returns_stripped_summary_text(make_client, ok_response):
    client = make_client(ok_response)
    assert summarize(client, "x") == "A concise summary."


def test_wraps_client_errors(make_client):
    def boom(**_):
        raise RuntimeError("network down")

    client = make_client(boom)
    with pytest.raises(SummarizationError):
        summarize(client, "x")


def test_errors_on_empty_content(make_client):
    class Empty:
        content: list = []

    client = make_client(lambda **_: Empty())
    with pytest.raises(SummarizationError):
        summarize(client, "x")
```

- [ ] **Step 6: CI workflow**

`templates/agent-foundations-py/.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -e ".[dev]"
      - run: pytest -q
```

- [ ] **Step 7: README (the learner's framing)**

`templates/agent-foundations-py/README.md`:

```markdown
# Agent Foundations — Ticket AGENT-0

Your team is building an AI summarizer. Your first ticket: implement `summarize()`
in `agent/model_call.py`. The acceptance tests in `tests/` already describe the
behavior — make them pass, open a PR, and the senior engineer will review it.

## Run the tests
```
pip install -e ".[dev]"
pytest -q
```

The tests mock the LLM — you never call the real API to pass them. That's deliberate:
real agents are tested against a fake model so the tests are fast and deterministic.
```

- [ ] **Step 8: Verify the skeleton is RED (student's starting state)**

Run:
```bash
cd templates/agent-foundations-py && python -m venv .venv && . .venv/Scripts/activate && pip install -e ".[dev]" && pytest -q; deactivate
```
Expected: tests FAIL (summarize raises NotImplementedError). This is correct — the learner receives a red repo.

- [ ] **Step 9: Commit**

```bash
git add templates/agent-foundations-py
git commit -m "feat(templates): rung-0 agent-foundations-py skeleton + acceptance tests"
```

### Task C2: Rung-0 reference solution + gate check

**Files:**
- Create: `templates/agent-foundations-py/REFERENCE_SOLUTION.md` (the known-good `summarize` body, kept OUT of the student repo via the template — see Task C4 note)

- [ ] **Step 1: Write the reference solution doc**

`templates/agent-foundations-py/REFERENCE_SOLUTION.md`:

````markdown
# Reference solution (gate only — do not ship in the student template)

`agent/model_call.py` `summarize` body:

```python
def summarize(client: LlmClient, text: str) -> str:
    try:
        response = client.create_message(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": f"Summarize in one sentence:\n\n{text}"}],
        )
    except Exception as exc:  # noqa: BLE001 - wrap any client failure
        raise SummarizationError(str(exc)) from exc
    if not getattr(response, "content", None):
        raise SummarizationError("model returned no content")
    return response.content[0].text.strip()
```
````

- [ ] **Step 2: Reference-gate — apply the reference, tests must PASS**

Temporarily paste the reference body into `agent/model_call.py`, then run:
```bash
cd templates/agent-foundations-py && . .venv/Scripts/activate && pytest -q; deactivate
```
Expected: all tests PASS. Then revert `model_call.py` back to the stub (the student starts red).

- [ ] **Step 3: Negative-gate — break the reference, tests must FAIL**

Paste the reference but change `messages[0]["content"]` to omit `text` (e.g. `"Summarize."`). Run pytest.
Expected: `test_calls_model_with_expected_request_shape` FAILS (proves the suite discriminates). Revert to the stub.

- [ ] **Step 4: Commit**

```bash
git add templates/agent-foundations-py/REFERENCE_SOLUTION.md
git commit -m "test(templates): rung-0 reference + gate verification"
```

### Task C3: Rung-1 template — "Give it a tool"

**Files (all under `templates/agent-tools-py/`):** same layout as C1, but:
- `agent/model_call.py` ships the **implemented** summarize (the model call is given).
- `agent/tools.py` is the student's stub: define a `get_weather` tool schema + a dispatcher.
- `tests/test_tools.py` feeds a fixed `tool_use` block and asserts schema + dispatch.

- [ ] **Step 1: Copy the C1 scaffolding**

Copy `pyproject.toml` (rename `name = "agent-tools"`), `agent/__init__.py`, `agent/llm_client.py`, `.github/workflows/ci.yml`, and `tests/conftest.py` into `templates/agent-tools-py/`. In `agent/model_call.py` ship the reference `summarize` from C2 (model call is provided here).

- [ ] **Step 2: The student's tool stub**

`templates/agent-tools-py/agent/tools.py`:

```python
"""TICKET AGENT-1: wire up a tool.

Implement:
  - WEATHER_TOOL: a tool schema dict with keys "name" == "get_weather",
    "description" (non-empty), and "input_schema" requiring a string "city".
  - run_tool(name, arguments): dispatch "get_weather" to get_weather(city);
    raise UnknownToolError for any other name.
  - get_weather(city): return f"Weather in {city}: sunny, 24C".

Do NOT change the test file. Make the tests pass.
"""
from __future__ import annotations

from typing import Any


class UnknownToolError(Exception):
    pass


WEATHER_TOOL: dict[str, Any] = {}


def get_weather(city: str) -> str:
    raise NotImplementedError("Implement get_weather() — see the ticket docstring.")


def run_tool(name: str, arguments: dict[str, Any]) -> str:
    raise NotImplementedError("Implement run_tool() — see the ticket docstring.")
```

- [ ] **Step 3: The acceptance tests**

`templates/agent-tools-py/tests/test_tools.py`:

```python
from __future__ import annotations

import pytest

from agent.tools import WEATHER_TOOL, UnknownToolError, run_tool


def test_tool_schema_shape():
    assert WEATHER_TOOL["name"] == "get_weather"
    assert WEATHER_TOOL["description"]
    schema = WEATHER_TOOL["input_schema"]
    assert schema["type"] == "object"
    assert "city" in schema["properties"]
    assert schema["properties"]["city"]["type"] == "string"
    assert "city" in schema["required"]


def test_run_tool_dispatches_get_weather():
    # Simulates the arguments the model would emit in a tool_use block.
    tool_use = {"name": "get_weather", "input": {"city": "Hanoi"}}
    result = run_tool(tool_use["name"], tool_use["input"])
    assert "Hanoi" in result


def test_run_tool_rejects_unknown_tool():
    with pytest.raises(UnknownToolError):
        run_tool("delete_database", {})
```

- [ ] **Step 4: README + reference**

`templates/agent-tools-py/README.md`: same shape as C1 but for Ticket AGENT-1 (wire a tool). `templates/agent-tools-py/REFERENCE_SOLUTION.md`: the obvious implementations (WEATHER_TOOL dict, `get_weather` returning the string, `run_tool` dispatching by name and raising `UnknownToolError`).

- [ ] **Step 5: Gate checks (red skeleton, green reference, red broken reference)**

Run the same three-way verification as C2 for `agent-tools-py`. Expected: skeleton RED, reference GREEN, broken reference (e.g. `run_tool` ignores `name`) makes `test_run_tool_rejects_unknown_tool` FAIL. Revert to stub.

- [ ] **Step 6: Commit**

```bash
git add templates/agent-tools-py
git commit -m "feat(templates): rung-1 agent-tools-py skeleton + acceptance tests + gate"
```

### Task C4: Publish both as GitHub template repos (ops)

`createUsingTemplate` clones a **GitHub** template repo, not the monorepo `templates/` dir. Each repo must exist under `GITHUB_OWNER` with the template flag set, containing the **student-facing** files only (stub `model_call.py`/`tools.py`, NOT `REFERENCE_SOLUTION.md`).

- [ ] **Step 1: Create the repos on GitHub**

For each of `agent-foundations-py` and `agent-tools-py`, from a clean copy that **excludes** `REFERENCE_SOLUTION.md`:

```bash
gh repo create <GITHUB_OWNER>/agent-foundations-py --private --disable-wiki
# push the templates/agent-foundations-py contents (minus REFERENCE_SOLUTION.md) to main
gh repo edit <GITHUB_OWNER>/agent-foundations-py --template
```
Repeat for `agent-tools-py`.

- [ ] **Step 2: Verify the template flag + CI**

Run: `gh api repos/<GITHUB_OWNER>/agent-foundations-py --jq .is_template`
Expected: `true`. Open a throwaway PR on a test clone to confirm the Actions CI runs pytest and is red on the skeleton.

- [ ] **Step 3: No commit** (GitHub-side; nothing to commit locally). Record the repo names — they become the `template_ref` values in Phase D.

---

## Phase D — Scenario definitions + seed

Author the two scenario definitions (parts A/D/E/F) and seed them into a new `ai-agents` track, `available: true`, reusing existing team roles (`product_manager`, `senior_engineer`, `backend_engineer`).

### Task D1: Author the agent-scenarios seed

**Files:**
- Create: `packages/db/src/seeds/seed-agent-scenarios.ts`

- [ ] **Step 1: Write the seed**

Model it on `seed-scenario-01.ts`. Each definition must include the fields the engine reads: `title`, `company_context`, `ticket`, `agent_prompts.pm_mai`, `agent_prompts.senior_alex`, `ground_truth`, `rubric` (technical+professional), `team`, `catalog`, and `repo.template_ref`.

`packages/db/src/seeds/seed-agent-scenarios.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { createDb } from '../client';
import { tracks, scenarios } from '../schema';

const db = createDb(
  process.env.DATABASE_URL ?? 'postgres://tryout:tryout@localhost:5432/tryout',
);

const RUNG_0 = {
  title: 'Wire up the model',
  version: 1,
  catalog: {
    summary:
      'Your first AI-agent ticket: make a summarizer call the model correctly and handle its failures. Mocked-LLM tests, a real PR, a senior review.',
    difficulty: 'intro' as const,
    tags: ['AI agents', 'Python', 'Anthropic', 'LLM'],
  },
  team: ['product_manager', 'senior_engineer', 'backend_engineer'],
  company_context: {
    name: 'Brief',
    product: 'Brief turns long documents into one-line summaries using an AI agent.',
    team: "You're a new engineer on the agent team. The codebase is a small Python service.",
    user_role: 'AI Engineer (new hire, first ticket)',
  },
  repo: { template_ref: 'agent-foundations-py', default_branch: 'main', ci: 'github-actions' },
  ticket: {
    id: 'AGENT-0',
    title: 'Make the summarizer call the model',
    body:
      'Implement summarize() in agent/model_call.py so it calls our model and returns a one-line summary. It needs to be solid — think about what happens when the model call fails or comes back empty. The acceptance tests describe the behavior; make them pass and open a PR.',
  },
  agent_prompts: {
    pm_mai: {
      system:
        'You are Mai, PM at Brief. Friendly, busy, practical. You assigned AGENT-0 to a new AI engineer. If they ask a clarifying question, answer directly. Do not volunteer implementation detail. Canonical answers when asked: error handling — "Yes, if the model call throws or returns nothing, raise our SummarizationError, don\'t leak raw exceptions." Output — "One sentence, trimmed of whitespace." Keep replies short and Slack-like.',
    },
    senior_alex: {
      system:
        'You are Alex, a senior engineer at Brief. Clear, professional, slightly terse async English. CHAT: nudge, point at the right file, don\'t hand over the solution. PR REVIEW: specific comments tied to the code. Request changes at least once on the first submission. Catch: raw exceptions not wrapped, missing empty-content handling, wrong request shape, no tests. Approve once correct and clean.',
    },
  },
  ground_truth: {
    solution_notes:
      'summarize() calls client.create_message with model claude-haiku-4-5, max_tokens 256, a single user message containing the text; returns response.content[0].text.strip(); wraps any client exception in SummarizationError; raises SummarizationError when content is empty.',
    red_flags: [
      'raw exception leaks instead of SummarizationError',
      'no empty-content handling',
      'wrong model or message shape',
      'no PR description',
    ],
  },
  rubric: {
    technical: {
      weight: 0.5,
      criteria: [
        { id: 'acceptance_tests_pass', weight: 0.5, description: 'CI green — the mocked-LLM acceptance suite passes.' },
        { id: 'error_handling', weight: 0.3, description: 'Client failures and empty content both raise SummarizationError.' },
        { id: 'request_shape', weight: 0.2, description: 'Correct model, max_tokens, and single user message containing the text.' },
      ],
    },
    professional: {
      weight: 0.5,
      criteria: [
        { id: 'surfaced_ambiguity', weight: 0.4, description: 'Asked the PM about error/empty behavior before implementing.' },
        { id: 'pr_description', weight: 0.3, description: 'PR explains what changed and why; states assumptions.' },
        { id: 'response_to_review', weight: 0.3, description: 'Incorporated senior feedback constructively across resubmits.' },
      ],
    },
  },
};

const RUNG_1 = {
  title: 'Give it a tool',
  version: 1,
  catalog: {
    summary:
      'Teach the agent to use a tool: define a tool schema, wire function-calling, dispatch the call. Mocked-LLM tests, a real PR, a senior review.',
    difficulty: 'intro' as const,
    tags: ['AI agents', 'Python', 'tool use', 'function calling'],
  },
  team: ['product_manager', 'senior_engineer', 'backend_engineer'],
  company_context: {
    name: 'Brief',
    product: 'Brief is adding tool use so its agent can fetch live data.',
    team: "You're on the agent team. The model call already works; now it needs a tool.",
    user_role: 'AI Engineer (second ticket)',
  },
  repo: { template_ref: 'agent-tools-py', default_branch: 'main', ci: 'github-actions' },
  ticket: {
    id: 'AGENT-1',
    title: 'Add a get_weather tool',
    body:
      'Give the agent a get_weather tool: define its schema, and wire a dispatcher that runs the right tool when the model asks for it (and refuses unknown tools). The acceptance tests describe the contract; make them pass and open a PR.',
  },
  agent_prompts: {
    pm_mai: {
      system:
        'You are Mai, PM at Brief. You assigned AGENT-1. Canonical answers when asked: unknown tools — "If the model names a tool we don\'t have, raise UnknownToolError, never guess." Schema — "The tool takes one required string, city." Keep replies short and Slack-like; no implementation detail.',
    },
    senior_alex: {
      system:
        'You are Alex, senior engineer at Brief. CHAT: nudge, don\'t solve. PR REVIEW: request changes at least once on the first submission. Catch: tool schema missing required city, dispatcher that ignores the tool name, no UnknownToolError path, no tests. Approve once correct and clean.',
    },
  },
  ground_truth: {
    solution_notes:
      'WEATHER_TOOL is a schema with name get_weather, a description, and input_schema requiring a string city. run_tool dispatches get_weather by name and raises UnknownToolError otherwise. get_weather returns a string mentioning the city.',
    red_flags: [
      'dispatcher ignores the tool name',
      'no UnknownToolError path',
      'schema missing required city',
      'no tests',
    ],
  },
  rubric: {
    technical: {
      weight: 0.5,
      criteria: [
        { id: 'acceptance_tests_pass', weight: 0.5, description: 'CI green — the mocked-LLM acceptance suite passes.' },
        { id: 'dispatch_correctness', weight: 0.3, description: 'Correct tool dispatched by name; unknown tools rejected.' },
        { id: 'schema_shape', weight: 0.2, description: 'Tool schema requires a string city.' },
      ],
    },
    professional: {
      weight: 0.5,
      criteria: [
        { id: 'surfaced_ambiguity', weight: 0.4, description: 'Asked the PM about unknown-tool behavior before implementing.' },
        { id: 'pr_description', weight: 0.3, description: 'PR explains what changed and why.' },
        { id: 'response_to_review', weight: 0.3, description: 'Incorporated senior feedback across resubmits.' },
      ],
    },
  },
};

async function upsertScenario(trackId: string, def: typeof RUNG_0) {
  const values = {
    trackId,
    title: def.title,
    version: def.version,
    definition: def,
    status: 'active',
    projectType: 'backend_monolith' as const,
    available: true,
  };
  const existing = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(eq(scenarios.title, def.title))
    .limit(1);
  if (existing.length > 0) {
    await db.update(scenarios).set(values).where(eq(scenarios.id, existing[0].id));
    console.log(`  Updated scenario "${def.title}"`);
  } else {
    await db.insert(scenarios).values(values);
    console.log(`  Inserted scenario "${def.title}"`);
  }
}

async function seed() {
  console.log('Seeding Track: ai-agents...');
  const existing = await db.select().from(tracks).where(eq(tracks.name, 'ai-agents')).limit(1);
  const trackId =
    existing.length > 0
      ? existing[0].id
      : (await db.insert(tracks).values({ name: 'ai-agents' }).returning())[0].id;

  await upsertScenario(trackId, RUNG_0);
  await upsertScenario(trackId, RUNG_1);

  console.log('Agent scenarios seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

> Note: team roles are seeded by `seed-scenario-01.ts` (`seedTeamRoles`). Run that seed at least once first so `product_manager`/`senior_engineer`/`backend_engineer` exist; this seed does not re-create them.

- [ ] **Step 2: Add a seed script**

In `packages/db/package.json` `scripts`, add:

```json
    "seed:agents": "tsx src/seeds/seed-agent-scenarios.ts",
```

- [ ] **Step 3: Run the seed**

Run:
```bash
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/db seed:agents
```
Expected: "Inserted scenario \"Wire up the model\"" and "...\"Give it a tool\"".

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/seeds/seed-agent-scenarios.ts packages/db/package.json
git commit -m "feat(db): seed ai-agents track with rung-0 and rung-1 scenarios"
```

---

## Phase E — End-to-end verification

### Task E1: Engine regression (E1/E2 didn't break scenario-01)

- [ ] **Step 1: Full API unit suite**

Run: `pnpm --filter @tryout/api test`
Expected: all green (including the new A2/A3/B2 tests).

- [ ] **Step 2: E2E suite**

Run:
```bash
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout JWT_SECRET=dev pnpm --filter @tryout/api test:e2e
```
Expected: all green. Confirms scenario-01 provisioning (env fallback) and the one-shot run path still behave.

### Task E2: Reference/negative gates recorded

- [ ] **Step 1: Confirm both template gate-checks pass**

Re-run the C2 and C3 gate verifications (skeleton RED, reference GREEN, broken reference RED) for both repos. Expected: as described. This is the trust gate before the scenarios go live.

### Task E3: Manual end-to-end retry-to-learn run

- [ ] **Step 1: Start the stack**

Run: `bash scripts/start.sh` (per project memory). Ensure `GITHUB_OWNER`/`GITHUB_TOKEN`/`ANTHROPIC_API_KEY` are set.

- [ ] **Step 2: Start a run on Rung 0 and verify the loop**

Start a run against the "Wire up the model" scenario as `backend_engineer`. Verify: a repo is provisioned from `agent-foundations-py`; the PM intro posts the AGENT-0 ticket. Open a PR with a **wrong** implementation → confirm CI runs, a senior review posts `request_changes`. Push a **fix** to the same PR → confirm (E2) a *new* submission is created and a *second* review posts. This proves retry-to-learn end-to-end.

- [ ] **Step 3: Record the outcome**

Note in `docs/STATUS.md` that the agent-trainer slice (rungs 0–1) is live, with the manual e2e result.

```bash
git add docs/STATUS.md
git commit -m "docs: record agent-trainer slice e2e verification"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** Scope (rungs 0+1, Python) → C/D. E1 per-scenario template → Phase A. E2 retry loop → Phase B. Grading-as-LLM-judge → unchanged (no task needed; documented). Reference/negative gates → C2/C3/E2. Engine regression → E1. Teaching flip → B2 (the mechanism) + manual proof E3.
- **Placeholder scan:** test-helper names in B2 (`selectWhereReturns`/`insertReturns`) are explicitly flagged as stand-ins for the file's existing Drizzle-mock pattern, not literal undefined functions. Reference solutions are given in full.
- **Type consistency:** `createRepoFromTemplate(userId, templateRepo?)` used consistently A2↔A3; `submissions.headSha` added B1 and used B2; `def.repo?.template_ref` matches the A1 type and the D1 seed shape.
