# Tryout M2 — The Visible Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the one seeded scenario playable end to end with no conversation and no grading yet: when a user starts a run, the PM agent writes a welcome + ticket-assignment message; when the user opens a PR and CI finishes, the Senior agent reviews the real diff, posts a real GitHub review (requesting changes on the first submission), and the web UI shows the whole "joined → reviewed" journey on one page.

**Architecture:** A real Anthropic adapter implements the existing `LlmRouter` interface in `@tryout/llm`, routed by task complexity (chat → Haiku, review → Sonnet). Two NestJS agent services — `PmService` (generates the intro) and `SeniorReviewService` (reviews the diff, posts to GitHub) — are driven by two new BullMQ jobs (`pm-intro`, `review`). `pm-intro` is enqueued at run start; `review` is enqueued by the existing `poll-ci` processor the moment CI completes. The `ScenarioRun` read endpoint is widened to return the ticket, the PM intro, and the latest review so a single web page can render the loop. No human-to-agent chat (that is M3) and no scoring (that is M4).

**Tech Stack:** `@anthropic-ai/sdk` behind the existing `LlmRouter` abstraction, `@octokit/rest` `pulls.createReview` for posting reviews, BullMQ for the two new jobs, Next.js client page polling the run endpoint.

**Source spec:** `docs/team-sim-spec-v1.md` §3 (the loop), §5 Decision 2 (keep agents simple — well-prompted single calls), §9 (PM + Senior behaviour), §11 M2 ("the visible loop … the make-or-break demo").

**Milestone-numbering note:** `docs/STATUS.md` (written during M1) collapsed the spec's milestones incorrectly. The spec is authoritative: **M2 = the visible loop (this plan)**, M3 = conversations, M4 = grading, M5 = polish. Task 12 corrects `STATUS.md` and `CLAUDE.md` to match.

---

## Conventions

- All commands run from repo root (`H:\TRYOUT`) unless a step says otherwise.
- Build the API with `pnpm --filter @tryout/api build`. Build everything with `pnpm -r --workspace-concurrency=1 build` (parallel builds corrupt the pnpm store on this machine; if you see a missing `has-flag`, run `pnpm install --force`).
- Run a single API test file with `pnpm --filter @tryout/api test -- <name-fragment>`.
- The Anthropic adapter and GitHub calls are always mocked in tests. No real `ANTHROPIC_API_KEY` or `GITHUB_TOKEN` is needed to make the suite green.
- Agents are **single well-prompted LLM calls** (spec §5 Decision 2). Do not build a graph or autonomous loop.
- LLM model IDs: chat → `claude-haiku-4-5`, review → `claude-sonnet-4-6`.

---

## Prerequisites (one-time human setup — not automated by this plan)

1. **All M1 prerequisites** (GitHub PAT with `repo` scope, the `lumi-tasks-api` template pushed to GitHub and marked as a template repo, `.env` filled with `GITHUB_TOKEN` / `GITHUB_OWNER`). Real review posting needs these; the automated tests do not.
2. **An Anthropic API key.** Create one at `console.anthropic.com → API Keys`. Put it in `.env` as `ANTHROPIC_API_KEY` (added to `.env.example` in Task 2).

---

## File Structure

Files created or modified in this plan, by responsibility:

```
packages/shared/
├── package.json                         ← (unchanged)
└── src/
    ├── scenario.ts                      ← NEW — shared ScenarioDefinition types (api + web)
    └── index.ts                         ← MODIFY — re-export scenario types

packages/llm/
├── package.json                         ← MODIFY — add @anthropic-ai/sdk
└── src/
    ├── anthropic-router.ts              ← NEW — AnthropicLlmRouter (implements LlmRouter)
    ├── anthropic-router.spec.ts         ← NEW — unit tests (mocked SDK)
    └── index.ts                         ← MODIFY — export AnthropicLlmRouter

apps/api/
├── package.json                         ← MODIFY — add @anthropic-ai/sdk
├── src/
│   ├── config/env.ts                    ← MODIFY — add Anthropic key + model vars
│   ├── app.module.ts                    ← MODIFY — import AgentsModule
│   ├── llm/
│   │   └── llm.module.ts                ← NEW — provides LLM_ROUTER from env
│   ├── github/
│   │   ├── github.service.ts            ← MODIFY — add createPullRequestReview
│   │   └── github.service.spec.ts       ← MODIFY — test the new method
│   ├── agents/
│   │   ├── agents.module.ts             ← NEW — PmService, SeniorReviewService, processors
│   │   ├── pm.service.ts                ← NEW — generate PM intro
│   │   ├── pm.service.spec.ts           ← NEW
│   │   ├── senior-review.service.ts     ← NEW — review diff, post to GitHub
│   │   ├── senior-review.service.spec.ts← NEW
│   │   └── processors/
│   │       ├── pm-intro.processor.ts    ← NEW — runs PmService
│   │       └── review.processor.ts      ← NEW — runs SeniorReviewService
│   ├── queue/
│   │   ├── queue.constants.ts           ← MODIFY — add PM_INTRO + REVIEW names/types
│   │   ├── queue.module.ts              ← MODIFY — register the two new queues
│   │   └── queue.service.ts             ← MODIFY — enqueuePmIntro + enqueueReview
│   ├── queue/processors/poll-ci.processor.ts        ← MODIFY — enqueue review on CI complete
│   ├── queue/processors/poll-ci.processor.spec.ts   ← MODIFY — assert review enqueued
│   └── scenario-runs/scenario-runs.service.ts       ← MODIFY — enqueue pm-intro; widen getRun
└── test/
    ├── jest-e2e.setup.ts                ← MODIFY — set fake ANTHROPIC_API_KEY
    └── visible-loop.e2e-spec.ts         ← NEW — intro persisted + review posted via services

apps/web/src/
├── lib/api.ts                           ← MODIFY — authed startRun + getRun + types
├── app/login/page.tsx                   ← MODIFY — redirect to /run after login
├── app/signup/page.tsx                  ← MODIFY — redirect to /run after signup
├── app/run/page.tsx                     ← NEW — start/resume the run, poll for updates
└── components/RunView.tsx               ← NEW — presentational run dashboard

docs/STATUS.md                           ← MODIFY — correct milestone map, mark M2 done
CLAUDE.md                                ← MODIFY — note agents module + LLM wiring
```

---

## Task 1: Shared `ScenarioDefinition` types

The scenario `definition` JSONB is read by both the API (to prompt agents) and the web (to render the ticket). Define the shape once in `@tryout/shared` so both sides are typed.

**Files:**
- Create: `packages/shared/src/scenario.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create the shared types**

Create `packages/shared/src/scenario.ts`:

```ts
export interface ScenarioCompanyContext {
  name: string;
  product: string;
  team: string;
  user_role: string;
}

export interface ScenarioTicket {
  id: string;
  title: string;
  body: string;
}

export interface ScenarioAgentPrompt {
  system: string;
}

export interface ScenarioGroundTruth {
  solution_notes: string;
  red_flags: string[];
}

/**
 * The subset of the scenario `definition` JSONB that M2 reads.
 * The full authored definition has more fields (clarifications, rubric, etc.);
 * those are typed as `unknown` here until a later milestone needs them.
 */
export interface ScenarioDefinition {
  title: string;
  company_context: ScenarioCompanyContext;
  ticket: ScenarioTicket;
  agent_prompts: {
    pm_mai: ScenarioAgentPrompt;
    senior_alex: ScenarioAgentPrompt;
  };
  ground_truth: ScenarioGroundTruth;
}
```

- [ ] **Step 2: Re-export from the package index**

Read `packages/shared/src/index.ts`, then add this line after the existing exports:

```ts
export * from './scenario';
```

- [ ] **Step 3: Build the package**

Run: `pnpm --filter @tryout/shared build`
Expected: compiles with no TS errors, emits `dist/scenario.d.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/scenario.ts packages/shared/src/index.ts
git commit -m "feat(shared): add ScenarioDefinition types"
```

---

## Task 2: Anthropic LLM router

Implement the real provider behind the existing `LlmRouter` interface. Routes by `taskComplexity`: `chat` → Haiku (cheap/fast, used by the PM), everything else → Sonnet (used by the Senior reviewer; the grader at M4 will reuse it). The Anthropic Messages API takes `system` as a separate field, so the adapter pulls `system`-role messages out of the array and joins them.

**Files:**
- Modify: `packages/llm/package.json`
- Create: `packages/llm/src/anthropic-router.ts`
- Create: `packages/llm/src/anthropic-router.spec.ts`
- Modify: `packages/llm/src/index.ts`

- [ ] **Step 1: Add the SDK dependency**

Edit `packages/llm/package.json` — add a `"dependencies"` block (the package currently has none) so it reads:

```json
{
  "name": "@tryout/llm",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "jest --config jest.config.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.27.3"
  }
}
```

Keep any existing `devDependencies` block that is already in the file (do not delete it). If the file already has a `test` script or jest config, leave it; Step 4 explains the test runner.

Run: `pnpm install`
Expected: `@anthropic-ai/sdk` installed into the `@tryout/llm` workspace.

- [ ] **Step 2: Check whether `@tryout/llm` has a jest config**

Run: `ls packages/llm`
- If a `jest.config.ts` exists, skip to Step 3.
- If it does NOT exist, create `packages/llm/jest.config.ts`:

```ts
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
};

export default config;
```

And ensure `packages/llm/package.json` `devDependencies` includes the test toolchain by running:

```bash
pnpm --filter @tryout/llm add -D jest ts-jest @types/jest typescript
```

- [ ] **Step 3: Write the failing test**

Create `packages/llm/src/anthropic-router.spec.ts`:

```ts
import { AnthropicLlmRouter } from './anthropic-router';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

describe('AnthropicLlmRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'hello from the model' }],
    });
  });

  it('routes chat tasks to the chat model and extracts the system prompt', async () => {
    const router = new AnthropicLlmRouter({
      apiKey: 'fake',
      chatModel: 'claude-haiku-4-5',
      reviewModel: 'claude-sonnet-4-6',
    });

    const result = await router.generate({
      role: 'pm',
      taskComplexity: 'chat',
      messages: [
        { role: 'system', content: 'You are Mai.' },
        { role: 'user', content: 'Introduce yourself.' },
      ],
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const arg = mockCreate.mock.calls[0][0];
    expect(arg.model).toBe('claude-haiku-4-5');
    expect(arg.system).toContain('You are Mai.');
    expect(arg.messages).toEqual([{ role: 'user', content: 'Introduce yourself.' }]);
    expect(result.content).toBe('hello from the model');
  });

  it('routes review tasks to the review model', async () => {
    const router = new AnthropicLlmRouter({
      apiKey: 'fake',
      chatModel: 'claude-haiku-4-5',
      reviewModel: 'claude-sonnet-4-6',
    });

    await router.generate({
      role: 'senior',
      taskComplexity: 'review',
      messages: [{ role: 'user', content: 'review this diff' }],
    });

    expect(mockCreate.mock.calls[0][0].model).toBe('claude-sonnet-4-6');
  });

  it('concatenates multiple text blocks in the response', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'text', text: 'part one ' },
        { type: 'tool_use', id: 'x', name: 'y', input: {} },
        { type: 'text', text: 'part two' },
      ],
    });
    const router = new AnthropicLlmRouter({ apiKey: 'fake' });

    const result = await router.generate({
      role: 'pm',
      taskComplexity: 'chat',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.content).toBe('part one part two');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @tryout/llm test`
Expected: FAIL — cannot find module `./anthropic-router`.

- [ ] **Step 5: Implement the router**

Create `packages/llm/src/anthropic-router.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import type {
  GenerateRequest,
  GenerateResult,
  LlmRouter,
  TaskComplexity,
} from './router';

export interface AnthropicLlmRouterOptions {
  apiKey: string;
  chatModel?: string;
  reviewModel?: string;
}

const DEFAULT_CHAT_MODEL = 'claude-haiku-4-5';
const DEFAULT_REVIEW_MODEL = 'claude-sonnet-4-6';

const MAX_TOKENS: Record<TaskComplexity, number> = {
  chat: 1024,
  review: 2048,
  grade: 2048,
};

export class AnthropicLlmRouter implements LlmRouter {
  private readonly client: Anthropic;
  private readonly chatModel: string;
  private readonly reviewModel: string;

  constructor(options: AnthropicLlmRouterOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.chatModel = options.chatModel ?? DEFAULT_CHAT_MODEL;
    this.reviewModel = options.reviewModel ?? DEFAULT_REVIEW_MODEL;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const model =
      request.taskComplexity === 'chat' ? this.chatModel : this.reviewModel;

    const response = await this.client.messages.create({
      model,
      max_tokens: MAX_TOKENS[request.taskComplexity],
      system,
      messages,
    });

    const content = response.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return { content, raw: response };
  }
}
```

- [ ] **Step 6: Export it**

Edit `packages/llm/src/index.ts` to read:

```ts
export * from './router';
export * from './anthropic-router';
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @tryout/llm test`
Expected: PASS (3 tests).

- [ ] **Step 8: Build**

Run: `pnpm --filter @tryout/llm build`
Expected: no TS errors.

- [ ] **Step 9: Commit**

```bash
git add packages/llm pnpm-lock.yaml
git commit -m "feat(llm): add Anthropic router behind LlmRouter interface"
```

---

## Task 3: API env vars + LlmModule

Expose the Anthropic key and model overrides through `env`, and provide a single `LLM_ROUTER` token (a configured `AnthropicLlmRouter`) for the agent services to inject. This mirrors how `GitHubModule` provides `GitHubService`.

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Modify: `.env.example`
- Modify: `apps/api/package.json`
- Create: `apps/api/src/llm/llm.module.ts`

- [ ] **Step 1: Add env vars**

Edit `apps/api/src/config/env.ts` — add these three properties inside the `env` object, after `pollMaxAttempts`:

```ts
  anthropicApiKey: () => required('ANTHROPIC_API_KEY'),
  llmChatModel: process.env.LLM_CHAT_MODEL ?? 'claude-haiku-4-5',
  llmReviewModel: process.env.LLM_REVIEW_MODEL ?? 'claude-sonnet-4-6',
```

- [ ] **Step 2: Add to .env.example**

Edit `.env.example` — append:

```
# LLM (M2+)
# Create a key at console.anthropic.com → API Keys
ANTHROPIC_API_KEY=sk-ant-replace_me
LLM_CHAT_MODEL=claude-haiku-4-5
LLM_REVIEW_MODEL=claude-sonnet-4-6
```

- [ ] **Step 3: Add the SDK to the API workspace**

Edit `apps/api/package.json` — add to `"dependencies"` (keep alphabetical-ish ordering near the other `@` packages):

```json
"@anthropic-ai/sdk": "^0.27.3",
```

Run: `pnpm install`
Expected: installed in the API workspace.

- [ ] **Step 4: Create LlmModule**

Create `apps/api/src/llm/llm.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AnthropicLlmRouter, type LlmRouter } from '@tryout/llm';
import { env } from '../config/env';

export const LLM_ROUTER = Symbol('LLM_ROUTER');

@Module({
  providers: [
    {
      provide: LLM_ROUTER,
      useFactory: (): LlmRouter =>
        new AnthropicLlmRouter({
          apiKey: env.anthropicApiKey(),
          chatModel: env.llmChatModel,
          reviewModel: env.llmReviewModel,
        }),
    },
  ],
  exports: [LLM_ROUTER],
})
export class LlmModule {}
```

- [ ] **Step 5: Build**

Run: `pnpm --filter @tryout/api build`
Expected: no TS errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config/env.ts apps/api/src/llm .env.example apps/api/package.json pnpm-lock.yaml
git commit -m "feat(llm): wire Anthropic router into API via LlmModule"
```

---

## Task 4: `GitHubService.createPullRequestReview`

Add the one Octokit call that posts a review to a PR. M2 posts a single review with a summary body and a verdict event (`REQUEST_CHANGES` / `APPROVE`). Inline per-line comments are a deliberate fast-follow, not M2.

**Files:**
- Modify: `apps/api/src/github/github.service.ts`
- Modify: `apps/api/src/github/github.service.spec.ts`

- [ ] **Step 1: Add the failing test**

Edit `apps/api/src/github/github.service.spec.ts`. Add `createReview: jest.fn()` inside the `pulls` mock object so it reads:

```ts
    pulls: {
      list: jest.fn(),
      get: jest.fn(),
      createReview: jest.fn(),
    },
```

Then add this `describe` block before the final closing `});` of the file:

```ts
  describe('createPullRequestReview', () => {
    it('posts a review with the given body and event', async () => {
      mockOctokit.rest.pulls.createReview.mockResolvedValue({ data: { id: 99 } });

      await service.createPullRequestReview(
        'test-owner',
        'my-repo',
        7,
        'Looks close. A few things to fix.',
        'REQUEST_CHANGES',
      );

      expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'my-repo',
        pull_number: 7,
        body: 'Looks close. A few things to fix.',
        event: 'REQUEST_CHANGES',
      });
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tryout/api test -- github.service`
Expected: FAIL — `service.createPullRequestReview is not a function`.

- [ ] **Step 3: Implement the method**

Edit `apps/api/src/github/github.service.ts`. Add this type near the other exported interfaces:

```ts
export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
```

Add this method inside the `GitHubService` class, after `getCheckRuns`:

```ts
  async createPullRequestReview(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
    event: ReviewEvent,
  ): Promise<void> {
    await this.octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      body,
      event,
    });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tryout/api test -- github.service`
Expected: PASS (5 tests — the original 4 plus the new one).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/github/github.service.ts apps/api/src/github/github.service.spec.ts
git commit -m "feat(github): add createPullRequestReview"
```

---

## Task 5: `PmService` — generate the PM intro

A single LLM call (spec §5 Decision 2): load the run's scenario, build a system prompt from the PM persona + company context + ticket, ask the model for a warm Slack-style welcome that assigns the ticket, and persist it as an `AgentMessage` (`agent_role='pm'`, `direction='agent'`).

**Files:**
- Create: `apps/api/src/agents/pm.service.ts`
- Create: `apps/api/src/agents/pm.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/pm.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PmService } from './pm.service';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';

const scenarioDefinition = {
  title: 'Add the ability to archive tasks',
  company_context: {
    name: 'Lumi',
    product: 'A productivity app.',
    team: 'Small team.',
    user_role: 'Backend Engineer',
  },
  ticket: { id: 'LUMI-142', title: 'Archive tasks', body: 'Add archive.' },
  agent_prompts: {
    pm_mai: { system: 'You are Mai, the PM.' },
    senior_alex: { system: 'You are Alex.' },
  },
  ground_truth: { solution_notes: '', red_flags: [] },
};

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
};

const mockRouter = { generate: jest.fn() };

describe('PmService', () => {
  let service: PmService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PmService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: LLM_ROUTER, useValue: mockRouter },
      ],
    }).compile();
    service = moduleRef.get(PmService);
  });

  it('generates an intro and persists it as a pm agent message', async () => {
    // First select().limit() → the run; second → the scenario.
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }]);
    mockRouter.generate.mockResolvedValue({ content: 'Hey, welcome to Lumi!' });
    mockDb.returning.mockResolvedValue([
      { id: 'msg-1', content: 'Hey, welcome to Lumi!', agentRole: 'pm', direction: 'agent' },
    ]);

    const result = await service.generateIntro('run-1');

    // The model was asked as the PM, with the persona + ticket in the system prompt.
    const callArg = mockRouter.generate.mock.calls[0][0];
    expect(callArg.role).toBe('pm');
    expect(callArg.taskComplexity).toBe('chat');
    const systemText = callArg.messages.find((m: any) => m.role === 'system').content;
    expect(systemText).toContain('You are Mai, the PM.');
    expect(systemText).toContain('LUMI-142');

    // The message was inserted and returned.
    expect(mockDb.insert).toHaveBeenCalled();
    expect(result.content).toBe('Hey, welcome to Lumi!');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tryout/api test -- pm.service`
Expected: FAIL — cannot find module `./pm.service`.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/agents/pm.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { ScenarioDefinition } from '@tryout/shared';
import type { LlmRouter as Router } from '@tryout/llm';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';

@Injectable()
export class PmService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_ROUTER) private readonly router: Router,
  ) {}

  async generateIntro(scenarioRunId: string) {
    const [run] = await this.db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, scenarioRunId))
      .limit(1);
    if (!run) throw new NotFoundException(`Scenario run ${scenarioRunId} not found.`);

    const [scenario] = await this.db
      .select({ definition: schema.scenarios.definition })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.id, run.scenarioId))
      .limit(1);
    if (!scenario) throw new NotFoundException('Scenario not found.');

    const def = scenario.definition as ScenarioDefinition;
    const c = def.company_context;
    const system = [
      def.agent_prompts.pm_mai.system,
      '',
      `Company: ${c.name}. ${c.product}`,
      `Team: ${c.team}`,
      `The engineer's role: ${c.user_role}`,
      '',
      `Ticket ${def.ticket.id}: ${def.ticket.title}`,
      def.ticket.body,
    ].join('\n');

    const result = await this.router.generate({
      role: 'pm',
      taskComplexity: 'chat',
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content:
            'Write your opening message to the new engineer: welcome them, give brief team/product context, and assign this ticket. Keep it warm but concise, like a Slack message. Do not solve the ticket for them.',
        },
      ],
    });

    const [message] = await this.db
      .insert(schema.agentMessages)
      .values({
        scenarioRunId,
        agentRole: 'pm',
        direction: 'agent',
        content: result.content,
      })
      .returning();

    return message;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tryout/api test -- pm.service`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/pm.service.ts apps/api/src/agents/pm.service.spec.ts
git commit -m "feat(agents): add PmService to generate the PM intro"
```

---

## Task 6: `SeniorReviewService` — review the diff, post to GitHub

When CI has finished, the Senior reviews the **real diff**: fetch it via `GitHubService`, ask the model (as the Senior, in review mode) for a structured verdict against the ground truth + red flags, force `request_changes` on the first submission (spec §9: "requests changes at least once on the first submission"), post the review to GitHub, and persist a `Review` row.

**Files:**
- Create: `apps/api/src/agents/senior-review.service.ts`
- Create: `apps/api/src/agents/senior-review.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/senior-review.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { SeniorReviewService } from './senior-review.service';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { GitHubService } from '../github/github.service';

const scenarioDefinition = {
  title: 'Add the ability to archive tasks',
  company_context: { name: 'Lumi', product: 'p', team: 't', user_role: 'r' },
  ticket: { id: 'LUMI-142', title: 'Archive', body: 'Add archive.' },
  agent_prompts: {
    pm_mai: { system: 'You are Mai.' },
    senior_alex: { system: 'You are Alex, a senior engineer.' },
  },
  ground_truth: {
    solution_notes: 'Soft archive; exclude from default list; add unarchive.',
    red_flags: ['hard delete', 'no unarchive'],
  },
};

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
};

const mockRouter = { generate: jest.fn() };
const mockGitHub = { getPullRequestDiff: jest.fn(), createPullRequestReview: jest.fn() };

const jobData = {
  submissionId: 'sub-1',
  repoOwner: 'test-owner',
  repoName: 'lumi-tasks-abc',
  prNumber: 7,
};

describe('SeniorReviewService', () => {
  let service: SeniorReviewService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SeniorReviewService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: LLM_ROUTER, useValue: mockRouter },
        { provide: GitHubService, useValue: mockGitHub },
      ],
    }).compile();
    service = moduleRef.get(SeniorReviewService);
    mockGitHub.getPullRequestDiff.mockResolvedValue('diff --git a/x b/x');
    mockGitHub.createPullRequestReview.mockResolvedValue(undefined);
  });

  it('forces request_changes on the first submission and posts the review', async () => {
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'sub-1', scenarioRunId: 'run-1', ciStatus: 'failure' }])
      .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }])
      .mockResolvedValueOnce([]); // prior reviews: none → first review
    mockRouter.generate.mockResolvedValue({
      content: JSON.stringify({
        summary: 'Solid start.',
        comments: ['Add an unarchive endpoint.'],
        verdict: 'approve', // model says approve…
      }),
    });
    mockDb.returning.mockResolvedValue([{ id: 'rev-1', verdict: 'request_changes' }]);

    await service.reviewSubmission(jobData);

    // …but first submission is forced to request_changes.
    const reviewArg = mockGitHub.createPullRequestReview.mock.calls[0];
    expect(reviewArg[4]).toBe('REQUEST_CHANGES');
    expect(mockDb.insert).toHaveBeenCalled();
    const insertedValues = mockDb.values.mock.calls.at(-1)[0];
    expect(insertedValues.verdict).toBe('request_changes');
    expect(insertedValues.submissionId).toBe('sub-1');
  });

  it('honors an approve verdict when a prior review already exists', async () => {
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'sub-1', scenarioRunId: 'run-1', ciStatus: 'success' }])
      .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }])
      .mockResolvedValueOnce([{ id: 'rev-old' }]); // a prior review exists
    mockRouter.generate.mockResolvedValue({
      content: JSON.stringify({ summary: 'Good.', comments: [], verdict: 'approve' }),
    });
    mockDb.returning.mockResolvedValue([{ id: 'rev-2', verdict: 'approve' }]);

    await service.reviewSubmission(jobData);

    expect(mockGitHub.createPullRequestReview.mock.calls[0][4]).toBe('APPROVE');
  });

  it('passes the real diff to the model', async () => {
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'sub-1', scenarioRunId: 'run-1', ciStatus: 'failure' }])
      .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }])
      .mockResolvedValueOnce([]);
    mockRouter.generate.mockResolvedValue({
      content: JSON.stringify({ summary: 's', comments: [], verdict: 'request_changes' }),
    });
    mockDb.returning.mockResolvedValue([{ id: 'rev-1' }]);

    await service.reviewSubmission(jobData);

    expect(mockGitHub.getPullRequestDiff).toHaveBeenCalledWith('test-owner', 'lumi-tasks-abc', 7);
    const userMsg = mockRouter.generate.mock.calls[0][0].messages.find(
      (m: any) => m.role === 'user',
    ).content;
    expect(userMsg).toContain('diff --git');
  });
});
```

> Note on the `priorReviews` query: it ends in `.limit(1)` (Step 3 implementation), so the mock's 4th `mockDb.limit` resolution supplies the prior-reviews result. Empty array → first review.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tryout/api test -- senior-review.service`
Expected: FAIL — cannot find module `./senior-review.service`.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/agents/senior-review.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { ScenarioDefinition } from '@tryout/shared';
import type { LlmRouter } from '@tryout/llm';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { GitHubService, type ReviewEvent } from '../github/github.service';

export interface ReviewJobData {
  submissionId: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
}

interface ParsedReview {
  summary: string;
  comments: string[];
  verdict: 'approve' | 'request_changes';
}

const MAX_DIFF_CHARS = 12_000;

@Injectable()
export class SeniorReviewService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_ROUTER) private readonly router: LlmRouter,
    private readonly github: GitHubService,
  ) {}

  async reviewSubmission(data: ReviewJobData): Promise<void> {
    const { submissionId, repoOwner, repoName, prNumber } = data;

    const [submission] = await this.db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.id, submissionId))
      .limit(1);
    if (!submission) throw new NotFoundException(`Submission ${submissionId} not found.`);

    const [run] = await this.db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, submission.scenarioRunId))
      .limit(1);
    if (!run) throw new NotFoundException('Scenario run not found.');

    const [scenario] = await this.db
      .select({ definition: schema.scenarios.definition })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.id, run.scenarioId))
      .limit(1);
    if (!scenario) throw new NotFoundException('Scenario not found.');

    const priorReviews = await this.db
      .select({ id: schema.reviews.id })
      .from(schema.reviews)
      .innerJoin(schema.submissions, eq(schema.reviews.submissionId, schema.submissions.id))
      .where(eq(schema.submissions.scenarioRunId, run.id))
      .limit(1);
    const isFirstReview = priorReviews.length === 0;

    const def = scenario.definition as ScenarioDefinition;
    const rawDiff = await this.github.getPullRequestDiff(repoOwner, repoName, prNumber);
    const diff = rawDiff.slice(0, MAX_DIFF_CHARS);

    const system = [
      def.agent_prompts.senior_alex.system,
      '',
      'You are in PR REVIEW mode.',
      `Ground-truth solution notes (guidance for you — do NOT paste verbatim): ${def.ground_truth.solution_notes}`,
      `Known red flags to watch for: ${def.ground_truth.red_flags.join('; ')}`,
      `CI status on this PR: ${submission.ciStatus ?? 'unknown'}`,
      isFirstReview
        ? 'This is the first submission. Per our team norm, request changes at least once even if it is close — find the most valuable improvement.'
        : '',
      'Respond ONLY with JSON, no prose around it, matching exactly:',
      '{"summary": string, "comments": string[], "verdict": "approve" | "request_changes"}',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.router.generate({
      role: 'senior',
      taskComplexity: 'review',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Here is the PR diff:\n\n${diff}` },
      ],
    });

    const parsed = this.parseReview(result.content);
    const verdict: ParsedReview['verdict'] =
      isFirstReview && parsed.verdict === 'approve' ? 'request_changes' : parsed.verdict;

    const event: ReviewEvent = verdict === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES';
    const body = this.renderBody(parsed);

    await this.github.createPullRequestReview(repoOwner, repoName, prNumber, body, event);

    await this.db.insert(schema.reviews).values({
      submissionId,
      agentRole: 'senior',
      comments: { summary: parsed.summary, comments: parsed.comments },
      verdict,
    });
  }

  private parseReview(content: string): ParsedReview {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return { summary: content.trim(), comments: [], verdict: 'request_changes' };
    }
    try {
      const obj = JSON.parse(content.slice(start, end + 1));
      return {
        summary: typeof obj.summary === 'string' ? obj.summary : '',
        comments: Array.isArray(obj.comments) ? obj.comments.map(String) : [],
        verdict: obj.verdict === 'approve' ? 'approve' : 'request_changes',
      };
    } catch {
      return { summary: content.trim(), comments: [], verdict: 'request_changes' };
    }
  }

  private renderBody(parsed: ParsedReview): string {
    const bullets = parsed.comments.map((c) => `- ${c}`).join('\n');
    return bullets ? `${parsed.summary}\n\n${bullets}` : parsed.summary;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tryout/api test -- senior-review.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/senior-review.service.ts apps/api/src/agents/senior-review.service.spec.ts
git commit -m "feat(agents): add SeniorReviewService to review diffs and post to GitHub"
```

---

## Task 7: Queue plumbing for the two agent jobs

Add `pm-intro` and `review` queues, their job-data types, and `QueueService` enqueue helpers. `ReviewJobData` is imported from the service that owns it (Task 6) to keep one source of truth.

**Files:**
- Modify: `apps/api/src/queue/queue.constants.ts`
- Modify: `apps/api/src/queue/queue.module.ts`
- Modify: `apps/api/src/queue/queue.service.ts`

- [ ] **Step 1: Add queue names and the pm-intro data type**

Edit `apps/api/src/queue/queue.constants.ts`. Update `QUEUE_NAMES` and add the new type so the file reads:

```ts
export const QUEUE_NAMES = {
  POLL_PR: 'poll-pr',
  POLL_CI: 'poll-ci',
  PM_INTRO: 'pm-intro',
  REVIEW: 'review',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface PollPrJobData {
  scenarioRunId: string;
  repoOwner: string;
  repoName: string;
  attemptCount: number;
}

export interface PollCiJobData {
  submissionId: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  headSha: string;
  attemptCount: number;
}

export interface PmIntroJobData {
  scenarioRunId: string;
}
```

(The `review` queue's job shape is `ReviewJobData` from `senior-review.service.ts`; it is imported where needed rather than redefined here.)

- [ ] **Step 2: Register the new queues**

Edit `apps/api/src/queue/queue.module.ts`. Add two `registerQueue` calls in the `imports` array, after the existing two:

```ts
    BullModule.registerQueue({ name: QUEUE_NAMES.PM_INTRO }),
    BullModule.registerQueue({ name: QUEUE_NAMES.REVIEW }),
```

- [ ] **Step 3: Add enqueue helpers**

Edit `apps/api/src/queue/queue.service.ts`. Replace its contents with:

```ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  PollPrJobData,
  PollCiJobData,
  PmIntroJobData,
} from './queue.constants';
import type { ReviewJobData } from '../agents/senior-review.service';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QUEUE_NAMES.POLL_PR) private readonly pollPrQueue: Queue,
    @InjectQueue(QUEUE_NAMES.POLL_CI) private readonly pollCiQueue: Queue,
    @InjectQueue(QUEUE_NAMES.PM_INTRO) private readonly pmIntroQueue: Queue,
    @InjectQueue(QUEUE_NAMES.REVIEW) private readonly reviewQueue: Queue,
  ) {}

  async enqueuePollPr(data: PollPrJobData, delayMs: number): Promise<void> {
    await this.pollPrQueue.add('check', data, {
      delay: delayMs,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async enqueuePollCi(data: PollCiJobData, delayMs: number): Promise<void> {
    await this.pollCiQueue.add('check', data, {
      delay: delayMs,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async enqueuePmIntro(data: PmIntroJobData): Promise<void> {
    await this.pmIntroQueue.add('generate', data, {
      attempts: 2,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async enqueueReview(data: ReviewJobData): Promise<void> {
    await this.reviewQueue.add('review', data, {
      attempts: 2,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}
```

- [ ] **Step 4: Build**

Run: `pnpm --filter @tryout/api build`
Expected: no TS errors. (The existing `queue.service` unit usage and `poll-*` processors still compile; new queues are additive.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/queue/queue.constants.ts apps/api/src/queue/queue.module.ts apps/api/src/queue/queue.service.ts
git commit -m "feat(queue): add pm-intro and review queues with enqueue helpers"
```

---

## Task 8: Agent processors + AgentsModule

Two thin BullMQ processors that just call the services from Tasks 5–6, wired together in `AgentsModule`.

**Files:**
- Create: `apps/api/src/agents/processors/pm-intro.processor.ts`
- Create: `apps/api/src/agents/processors/review.processor.ts`
- Create: `apps/api/src/agents/agents.module.ts`

- [ ] **Step 1: Create the pm-intro processor**

Create `apps/api/src/agents/processors/pm-intro.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, PmIntroJobData } from '../../queue/queue.constants';
import { PmService } from '../pm.service';

@Processor(QUEUE_NAMES.PM_INTRO)
export class PmIntroProcessor extends WorkerHost {
  private readonly logger = new Logger(PmIntroProcessor.name);

  constructor(private readonly pm: PmService) {
    super();
  }

  async process(job: Job<PmIntroJobData>): Promise<void> {
    this.logger.log(`Generating PM intro for run ${job.data.scenarioRunId}`);
    await this.pm.generateIntro(job.data.scenarioRunId);
  }
}
```

- [ ] **Step 2: Create the review processor**

Create `apps/api/src/agents/processors/review.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { SeniorReviewService, type ReviewJobData } from '../senior-review.service';

@Processor(QUEUE_NAMES.REVIEW)
export class ReviewProcessor extends WorkerHost {
  private readonly logger = new Logger(ReviewProcessor.name);

  constructor(private readonly senior: SeniorReviewService) {
    super();
  }

  async process(job: Job<ReviewJobData>): Promise<void> {
    this.logger.log(`Reviewing submission ${job.data.submissionId}`);
    await this.senior.reviewSubmission(job.data);
  }
}
```

- [ ] **Step 3: Create AgentsModule**

Create `apps/api/src/agents/agents.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { GitHubModule } from '../github/github.module';
import { QueueModule } from '../queue/queue.module';
import { PmService } from './pm.service';
import { SeniorReviewService } from './senior-review.service';
import { PmIntroProcessor } from './processors/pm-intro.processor';
import { ReviewProcessor } from './processors/review.processor';

@Module({
  imports: [LlmModule, GitHubModule, QueueModule],
  providers: [PmService, SeniorReviewService, PmIntroProcessor, ReviewProcessor],
  exports: [PmService, SeniorReviewService],
})
export class AgentsModule {}
```

- [ ] **Step 4: Build**

Run: `pnpm --filter @tryout/api build`
Expected: no TS errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/processors apps/api/src/agents/agents.module.ts
git commit -m "feat(agents): add pm-intro and review processors with AgentsModule"
```

---

## Task 9: Trigger the jobs + widen the run endpoint

Enqueue `pm-intro` at run start; enqueue `review` when `poll-ci` marks CI complete; and return the ticket, PM intro, and latest review from `GET /scenario-runs/:id` so the web page can render the whole loop.

**Files:**
- Modify: `apps/api/src/scenario-runs/scenario-runs.service.ts`
- Modify: `apps/api/src/queue/processors/poll-ci.processor.ts`
- Modify: `apps/api/src/queue/processors/poll-ci.processor.spec.ts`

- [ ] **Step 1: Enqueue pm-intro at run start and widen getRun**

Edit `apps/api/src/scenario-runs/scenario-runs.service.ts`. Replace its contents with:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, desc, and } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { ScenarioDefinition } from '@tryout/shared';
import { DRIZZLE } from '../db/db.module';
import { GitHubService } from '../github/github.service';
import { QueueService } from '../queue/queue.service';
import { env } from '../config/env';

@Injectable()
export class ScenarioRunsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly github: GitHubService,
    private readonly queue: QueueService,
  ) {}

  async startRun(userId: string): Promise<{ id: string; repoUrl: string; status: string }> {
    const [scenario] = await this.db
      .select({ id: schema.scenarios.id })
      .from(schema.scenarios)
      .innerJoin(schema.tracks, eq(schema.scenarios.trackId, schema.tracks.id))
      .where(eq(schema.tracks.name, 'backend'))
      .limit(1);

    if (!scenario) {
      throw new NotFoundException('No active scenario found for the backend track.');
    }

    const [run] = await this.db
      .insert(schema.scenarioRuns)
      .values({ userId, scenarioId: scenario.id, status: 'onboarding', startedAt: new Date() })
      .returning();

    const created = await this.github.createRepoFromTemplate(userId);
    const [repoOwner, repoName] = created.fullName.split('/');

    await this.db.insert(schema.repos).values({
      scenarioRunId: run.id,
      url: created.htmlUrl,
      defaultBranch: 'main',
    });

    // The PM writes the welcome/ticket message asynchronously.
    await this.queue.enqueuePmIntro({ scenarioRunId: run.id });

    // Start polling for the user's PR.
    await this.queue.enqueuePollPr(
      { scenarioRunId: run.id, repoOwner, repoName, attemptCount: 0 },
      env.pollPrIntervalMs,
    );

    return { id: run.id, repoUrl: created.htmlUrl, status: run.status };
  }

  async getRun(runId: string, userId: string) {
    const [run] = await this.db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, runId))
      .limit(1);

    if (!run || run.userId !== userId) {
      throw new NotFoundException(`Scenario run ${runId} not found.`);
    }

    const [scenario] = await this.db
      .select({ definition: schema.scenarios.definition })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.id, run.scenarioId))
      .limit(1);
    const def = scenario?.definition as ScenarioDefinition | undefined;

    const [repo] = await this.db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.scenarioRunId, runId))
      .limit(1);

    const submissions = await this.db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.scenarioRunId, runId))
      .orderBy(desc(schema.submissions.createdAt));
    const latestSubmission = submissions[0] ?? null;

    const [pmIntro] = await this.db
      .select()
      .from(schema.agentMessages)
      .where(
        and(
          eq(schema.agentMessages.scenarioRunId, runId),
          eq(schema.agentMessages.agentRole, 'pm'),
          eq(schema.agentMessages.direction, 'agent'),
        ),
      )
      .orderBy(desc(schema.agentMessages.createdAt))
      .limit(1);

    let latestReview = null;
    if (latestSubmission) {
      const [review] = await this.db
        .select()
        .from(schema.reviews)
        .where(eq(schema.reviews.submissionId, latestSubmission.id))
        .orderBy(desc(schema.reviews.createdAt))
        .limit(1);
      latestReview = review ?? null;
    }

    return {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      scenario: def
        ? { title: def.title, companyContext: def.company_context, ticket: def.ticket }
        : null,
      repo: repo ? { url: repo.url, prNumber: repo.prNumber } : null,
      pmIntro: pmIntro ?? null,
      latestSubmission,
      latestReview,
    };
  }
}
```

- [ ] **Step 2: Enqueue review when CI completes**

Edit `apps/api/src/queue/processors/poll-ci.processor.ts`. Inside `process`, find the block that runs after `allComplete` is true and the DB update happens. Add a review enqueue right after the `this.db.update(...).where(...)` call (at the end of the method):

```ts
    await this.queue.enqueueReview({
      submissionId,
      repoOwner,
      repoName,
      prNumber,
    });
```

The tail of the method should now read:

```ts
    await this.db
      .update(schema.submissions)
      .set({
        ciStatus: overallConclusion,
        ciResults: checkRuns as unknown as Record<string, unknown>[],
      })
      .where(eq(schema.submissions.id, submissionId));

    await this.queue.enqueueReview({
      submissionId,
      repoOwner,
      repoName,
      prNumber,
    });
  }
```

- [ ] **Step 3: Update the poll-ci test to assert the review is enqueued**

Edit `apps/api/src/queue/processors/poll-ci.processor.spec.ts`. The `mockQueueService` currently has only `enqueuePollCi`. Replace it with:

```ts
const mockQueueService = {
  enqueuePollCi: jest.fn(),
  enqueueReview: jest.fn(),
};
```

Then, in the test `'updates the Submission when all checks are complete'`, add this assertion after the existing `expect(mockDb.update).toHaveBeenCalled();`:

```ts
    expect(mockQueueService.enqueueReview).toHaveBeenCalledWith({
      submissionId: 'sub-1',
      repoOwner: 'test-owner',
      repoName: 'lumi-tasks-abc',
      prNumber: 7,
    });
```

- [ ] **Step 4: Run the poll-ci tests**

Run: `pnpm --filter @tryout/api test -- poll-ci.processor`
Expected: PASS (5 tests — the new assertion is inside the existing "all checks complete" test).

- [ ] **Step 5: Build**

Run: `pnpm --filter @tryout/api build`
Expected: no TS errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/scenario-runs/scenario-runs.service.ts apps/api/src/queue/processors/poll-ci.processor.ts apps/api/src/queue/processors/poll-ci.processor.spec.ts
git commit -m "feat(scenario-runs): enqueue pm-intro and review; widen getRun for the UI"
```

---

## Task 10: Wire AgentsModule into AppModule

**Files:**
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Import AgentsModule**

Edit `apps/api/src/app.module.ts` to read:

```ts
import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { ScenarioRunsModule } from './scenario-runs/scenario-runs.module';
import { AgentsModule } from './agents/agents.module';

@Module({
  imports: [DbModule, AuthModule, ScenarioRunsModule, AgentsModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 2: Build everything**

Run: `pnpm -r --workspace-concurrency=1 build`
Expected: all workspace packages compile with no TS errors.

- [ ] **Step 3: Run all API unit tests**

Run: `pnpm --filter @tryout/api test`
Expected: PASS. New total = 15 (M1) + AnthropicLlmRouter is in `@tryout/llm` not here, so API count = PasswordService 3 + GitHubService 5 + PollPrProcessor 3 + PollCiProcessor 5 + PmService 1 + SeniorReviewService 3 = **20 tests**.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app.module.ts
git commit -m "feat(api): wire AgentsModule into AppModule"
```

---

## Task 11: E2E — intro persisted + review posted

A database-backed e2e that mocks GitHub, the queue, and the LLM router. Because the queue is mocked, processors do not fire on their own; instead the test resolves `PmService` and `SeniorReviewService` from the app and invokes them directly, then asserts the widened `GET /scenario-runs/:id` reflects the intro and review. This proves the service → DB → endpoint integration without real network calls.

**Files:**
- Modify: `apps/api/test/jest-e2e.setup.ts`
- Create: `apps/api/test/visible-loop.e2e-spec.ts`

- [ ] **Step 1: Add the fake Anthropic key to the e2e setup**

Edit `apps/api/test/jest-e2e.setup.ts` to read:

```ts
process.env.GITHUB_TOKEN = 'fake-token-for-testing';
process.env.GITHUB_OWNER = 'fake-owner-for-testing';
process.env.ANTHROPIC_API_KEY = 'fake-anthropic-key-for-testing';
```

- [ ] **Step 2: Write the e2e test**

Create `apps/api/test/visible-loop.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GitHubService } from '../src/github/github.service';
import { QueueService } from '../src/queue/queue.service';
import { LLM_ROUTER } from '../src/llm/llm.module';
import { PmService } from '../src/agents/pm.service';
import { SeniorReviewService } from '../src/agents/senior-review.service';

const mockGitHubService = {
  createRepoFromTemplate: jest.fn().mockResolvedValue({
    htmlUrl: 'https://github.com/test-owner/lumi-tasks-v2',
    fullName: 'test-owner/lumi-tasks-v2',
    repoName: 'lumi-tasks-v2',
  }),
  listOpenPullRequests: jest.fn().mockResolvedValue([]),
  getPullRequestDiff: jest.fn().mockResolvedValue('diff --git a/src b/src\n+archive'),
  getCheckRuns: jest.fn().mockResolvedValue([]),
  createPullRequestReview: jest.fn().mockResolvedValue(undefined),
};

const mockQueueService = {
  enqueuePollPr: jest.fn().mockResolvedValue(undefined),
  enqueuePollCi: jest.fn().mockResolvedValue(undefined),
  enqueuePmIntro: jest.fn().mockResolvedValue(undefined),
  enqueueReview: jest.fn().mockResolvedValue(undefined),
};

const mockRouter = {
  generate: jest.fn(),
};

describe('Visible loop (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let pm: PmService;
  let senior: SeniorReviewService;
  const email = `m2-${Date.now()}@example.com`;
  const password = 'sup3r-secret-pw';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GitHubService)
      .useValue(mockGitHubService)
      .overrideProvider(QueueService)
      .useValue(mockQueueService)
      .overrideProvider(LLM_ROUTER)
      .useValue(mockRouter)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    pm = app.get(PmService);
    senior = app.get(SeniorReviewService);

    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(201);
    authToken = res.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs the loop: start → PM intro → PR + CI → Senior review', async () => {
    // 1. Start a run.
    const startRes = await request(app.getHttpServer())
      .post('/scenario-runs')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    const runId = startRes.body.id as string;
    expect(startRes.body.repoUrl).toBe('https://github.com/test-owner/lumi-tasks-v2');

    // 2. GET returns the ticket from the seeded scenario, no intro yet.
    const beforeIntro = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(beforeIntro.body.scenario.ticket.id).toBe('LUMI-142');
    expect(beforeIntro.body.pmIntro).toBeNull();

    // 3. PM generates the intro (normally the pm-intro job).
    mockRouter.generate.mockResolvedValueOnce({ content: 'Hi! Welcome to Lumi. Take LUMI-142.' });
    await pm.generateIntro(runId);

    const afterIntro = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(afterIntro.body.pmIntro.content).toContain('Welcome to Lumi');

    // 4. Simulate a PR submission landing in the DB (normally poll-pr).
    //    We insert a submission row directly via a second start? No — use the
    //    poll-pr path by faking an open PR, then poll. Simpler: drive the
    //    Senior review against a submission we create through the public flow.
    //    Create a submission by invoking the DB through a fresh PR detection:
    //    here we insert via the running app's DRIZZLE provider.
    const db = app.get<any>(
      // DRIZZLE symbol is exported from db.module
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../src/db/db.module').DRIZZLE,
    );
    const { schema } = require('@tryout/db');
    const [submission] = await db
      .insert(schema.submissions)
      .values({
        scenarioRunId: runId,
        prUrl: 'https://github.com/test-owner/lumi-tasks-v2/pull/1',
        ciStatus: 'failure',
      })
      .returning();

    // 5. Senior reviews (normally the review job). Model approves, but first
    //    submission is forced to request_changes.
    mockRouter.generate.mockResolvedValueOnce({
      content: JSON.stringify({
        summary: 'Good first pass.',
        comments: ['Add an unarchive endpoint.'],
        verdict: 'approve',
      }),
    });
    await senior.reviewSubmission({
      submissionId: submission.id,
      repoOwner: 'test-owner',
      repoName: 'lumi-tasks-v2',
      prNumber: 1,
    });

    // 6. A real GitHub review was posted with REQUEST_CHANGES.
    expect(mockGitHubService.createPullRequestReview).toHaveBeenCalledWith(
      'test-owner',
      'lumi-tasks-v2',
      1,
      expect.stringContaining('unarchive'),
      'REQUEST_CHANGES',
    );

    // 7. GET now surfaces the review verdict.
    const afterReview = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(afterReview.body.latestReview.verdict).toBe('request_changes');
    expect(afterReview.body.latestSubmission.prUrl).toContain('/pull/1');
  });
});
```

- [ ] **Step 3: Run the full e2e suite**

Ensure infra is up (`docker compose ps`) and migrations + seed have been applied (`pnpm --filter @tryout/db migrate` then `... seed`). Run:

```bash
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout JWT_SECRET=dev pnpm --filter @tryout/api test:e2e
```

Expected: PASS — auth (7) + scenario-runs (4) + visible-loop (1) = **12 e2e tests**. (The "worker process failed to exit gracefully" notice from BullMQ is expected and harmless.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/jest-e2e.setup.ts apps/api/test/visible-loop.e2e-spec.ts
git commit -m "test(api): e2e for the visible loop (intro + review)"
```

---

## Task 12: Web — the run page

A single client page that starts (or resumes) the run and polls it, rendering the team/ticket intro, the PM's message, the repo link, CI/submission status, and the Senior's review. The run id is kept in `localStorage` so no list endpoint is needed.

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/app/signup/page.tsx`
- Create: `apps/web/src/components/RunView.tsx`
- Create: `apps/web/src/app/run/page.tsx`

- [ ] **Step 1: Extend the API client**

Edit `apps/web/src/lib/api.ts` to read:

```ts
import type { AuthResponse, ScenarioCompanyContext, ScenarioTicket } from '@tryout/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('tryout_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface StartRunResponse {
  id: string;
  repoUrl: string;
  status: string;
}

export interface ScenarioRunView {
  id: string;
  status: string;
  startedAt: string | null;
  scenario: {
    title: string;
    companyContext: ScenarioCompanyContext;
    ticket: ScenarioTicket;
  } | null;
  repo: { url: string; prNumber: number | null } | null;
  pmIntro: { content: string; createdAt: string } | null;
  latestSubmission: { prUrl: string; ciStatus: string | null; createdAt: string } | null;
  latestReview: {
    verdict: 'approve' | 'request_changes';
    comments: { summary: string; comments: string[] } | null;
    createdAt: string;
  } | null;
}

export const api = {
  signup: (email: string, password: string) =>
    post<AuthResponse>('/auth/signup', { email, password }),
  login: (email: string, password: string) =>
    post<AuthResponse>('/auth/login', { email, password }),

  startRun: async (): Promise<StartRunResponse> => {
    const res = await fetch(`${API_URL}/scenario-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Failed to start run (${res.status})`);
    return res.json() as Promise<StartRunResponse>;
  },

  getRun: async (id: string): Promise<ScenarioRunView> => {
    const res = await fetch(`${API_URL}/scenario-runs/${id}`, {
      headers: { ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Failed to load run (${res.status})`);
    return res.json() as Promise<ScenarioRunView>;
  },
};
```

- [ ] **Step 2: Redirect to /run after auth**

In `apps/web/src/app/login/page.tsx`, change the post-login redirect line:

```ts
      window.location.href = '/';
```

to:

```ts
      window.location.href = '/run';
```

In `apps/web/src/app/signup/page.tsx`, find the equivalent redirect after a successful signup (it sets `tryout_token` then navigates) and change its target to `/run` as well. If signup currently navigates to `/`, make it `/run`.

- [ ] **Step 3: Create the RunView component**

Create `apps/web/src/components/RunView.tsx`:

```tsx
import type { ScenarioRunView } from '@/lib/api';

interface RunViewProps {
  run: ScenarioRunView;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md, 12px)',
  padding: 'var(--space-4)',
  boxShadow: 'var(--shadow-card, 0 1px 3px rgba(0,0,0,0.08))',
};

function CiBadge({ status }: { status: string | null }) {
  const label = status ?? 'pending';
  const color =
    status === 'success'
      ? 'var(--color-success, #16794d)'
      : status === 'failure'
        ? 'var(--color-danger, #b42318)'
        : 'var(--color-muted)';
  return <span style={{ color, fontWeight: 600 }}>CI: {label}</span>;
}

export function RunView({ run }: RunViewProps) {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-4)' }}>
      <header>
        <p style={{ color: 'var(--color-muted)', margin: 0 }}>
          {run.scenario?.companyContext.name} · {run.scenario?.companyContext.user_role}
        </p>
        <h1 style={{ fontSize: 'var(--text-xl, 1.75rem)', margin: 'var(--space-1) 0' }}>
          {run.scenario?.title ?? 'Your scenario'}
        </h1>
        <p style={{ color: 'var(--color-muted)', margin: 0 }}>Status: {run.status}</p>
      </header>

      {run.scenario && (
        <section style={cardStyle} aria-labelledby="ticket-heading">
          <h2 id="ticket-heading" style={{ marginTop: 0, fontSize: 'var(--text-md, 1.25rem)' }}>
            {run.scenario.ticket.id}: {run.scenario.ticket.title}
          </h2>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{run.scenario.ticket.body}</p>
        </section>
      )}

      <section style={cardStyle} aria-labelledby="pm-heading">
        <h2 id="pm-heading" style={{ marginTop: 0, fontSize: 'var(--text-md, 1.25rem)' }}>Message from your PM</h2>
        {run.pmIntro ? (
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{run.pmIntro.content}</p>
        ) : (
          <p style={{ color: 'var(--color-muted)', margin: 0 }}>Your PM is writing… (refreshes automatically)</p>
        )}
      </section>

      <section style={cardStyle} aria-labelledby="repo-heading">
        <h2 id="repo-heading" style={{ marginTop: 0, fontSize: 'var(--text-md, 1.25rem)' }}>Your repository</h2>
        {run.repo ? (
          <p style={{ margin: 0 }}>
            <a href={run.repo.url} target="_blank" rel="noreferrer">Open your repo on GitHub →</a>
          </p>
        ) : (
          <p style={{ color: 'var(--color-muted)', margin: 0 }}>Provisioning your repo…</p>
        )}
        <p style={{ marginTop: 'var(--space-2)', color: 'var(--color-muted)' }}>
          Clone it, implement the ticket, and open a pull request. We&apos;ll detect it automatically.
        </p>
      </section>

      <section style={cardStyle} aria-labelledby="review-heading">
        <h2 id="review-heading" style={{ marginTop: 0, fontSize: 'var(--text-md, 1.25rem)' }}>Pull request & review</h2>
        {run.latestSubmission ? (
          <>
            <p style={{ margin: '0 0 var(--space-2)' }}>
              <a href={run.latestSubmission.prUrl} target="_blank" rel="noreferrer">View your PR →</a>{' '}
              · <CiBadge status={run.latestSubmission.ciStatus} />
            </p>
            {run.latestReview ? (
              <div>
                <p style={{ fontWeight: 600, margin: '0 0 var(--space-1)' }}>
                  Senior review:{' '}
                  {run.latestReview.verdict === 'approve' ? 'Approved ✅' : 'Changes requested 🔁'}
                </p>
                {run.latestReview.comments && (
                  <>
                    <p style={{ margin: '0 0 var(--space-1)' }}>{run.latestReview.comments.summary}</p>
                    <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                      {run.latestReview.comments.comments.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : (
              <p style={{ color: 'var(--color-muted)', margin: 0 }}>Senior is reviewing once CI finishes…</p>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--color-muted)', margin: 0 }}>No pull request opened yet.</p>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Create the run page**

Create `apps/web/src/app/run/page.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, type ScenarioRunView } from '@/lib/api';
import { RunView } from '@/components/RunView';

const RUN_ID_KEY = 'tryout_run_id';

export default function RunPage() {
  const [run, setRun] = useState<ScenarioRunView | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(RUN_ID_KEY);
    if (stored) setRunId(stored);
  }, []);

  const refresh = useCallback(async (id: string) => {
    try {
      const data = await api.getRun(id);
      setRun(data);
    } catch {
      setError('Could not load your run.');
    }
  }, []);

  useEffect(() => {
    if (!runId) return;
    refresh(runId);
    const interval = setInterval(() => refresh(runId), 15_000);
    return () => clearInterval(interval);
  }, [runId, refresh]);

  async function onStart() {
    setStarting(true);
    setError(null);
    try {
      const res = await api.startRun();
      window.localStorage.setItem(RUN_ID_KEY, res.id);
      setRunId(res.id);
    } catch {
      setError('Could not start the scenario. Are you logged in?');
    } finally {
      setStarting(false);
    }
  }

  if (!runId) {
    return (
      <main style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 'var(--text-xl, 1.75rem)', margin: 0 }}>Ready to join the team?</h1>
        <p style={{ color: 'var(--color-muted)', margin: 0 }}>
          Start the scenario to get your repo, your ticket, and a message from your PM.
        </p>
        {error && <p role="alert" style={{ color: 'var(--color-danger, #b42318)', margin: 0 }}>{error}</p>}
        <button type="button" onClick={onStart} disabled={starting}>
          {starting ? 'Setting things up…' : 'Start the scenario'}
        </button>
      </main>
    );
  }

  if (!run) {
    return (
      <main style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-5)' }}>
        {error ? (
          <p role="alert" style={{ color: 'var(--color-danger, #b42318)' }}>{error}</p>
        ) : (
          <p style={{ color: 'var(--color-muted)' }}>Loading your run…</p>
        )}
      </main>
    );
  }

  return <RunView run={run} />;
}
```

- [ ] **Step 5: Build the web app**

Run: `pnpm --filter @tryout/web build`
Expected: Next.js build succeeds (route `/run` listed). If the build fails on `localStorage`/`window` during prerender, confirm the page has `'use client'` at the top (it does) — `/run` is a client component and is not statically prerendered with browser APIs at module scope.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/app/login/page.tsx apps/web/src/app/signup/page.tsx apps/web/src/components/RunView.tsx apps/web/src/app/run/page.tsx
git commit -m "feat(web): add the run page showing intro, repo, CI, and review"
```

---

## Task 13: Update project docs

Correct the milestone map (STATUS.md got it wrong during M1) and note the new agents/LLM wiring in CLAUDE.md.

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update STATUS.md milestone table and M2 section**

Edit `docs/STATUS.md`:
- In the milestone table, set the rows to: `M2 — The Visible Loop ✅ Complete`, `M3 — Conversations 🔲 Pending`, `M4 — Grading 🔲 Pending`, `M5 — Polish 🔲 Pending`.
- Replace the old M2/M3/M4 prose sections with spec-aligned ones:
  - **M2 — The Visible Loop ✅** — Anthropic router behind LlmRouter; PmService generates the intro; SeniorReviewService reviews the real diff and posts a GitHub review (request_changes on first submission); pm-intro + review queues; widened GET /scenario-runs/:id; web run page. Tests: API unit 20, e2e 12, template 4.
  - **M3 — Conversations 🔲** — chat with PM (clarify) and Senior (help), persisted as AgentMessages; web chat thread.
  - **M4 — Grading 🔲** — Grader + scorecard, async job, results page.
  - **M5 — Polish 🔲** — retry/next, soft deadline, optional scope change, UX tightening.

- [ ] **Step 2: Update CLAUDE.md**

Edit `CLAUDE.md`:
- In the "Key Source Files → API" table, add rows for `llm/llm.module.ts` (provides `LLM_ROUTER`), `agents/pm.service.ts`, `agents/senior-review.service.ts`, and the two agent processors.
- Under "Environment Variables", add `ANTHROPIC_API_KEY` (required when agents run) and the optional `LLM_CHAT_MODEL` / `LLM_REVIEW_MODEL`.
- Under "What NOT to Build", update so conversational chat is M3 and grading is M4 (remove the now-incorrect M2 framing).

- [ ] **Step 3: Commit**

```bash
git add docs/STATUS.md CLAUDE.md
git commit -m "docs: align milestones with spec and record M2 completion"
```

---

## M2 Verification Gate

Run before declaring M2 complete. All must pass:

- [ ] `pnpm -r --workspace-concurrency=1 build` — all workspace packages compile.
- [ ] `pnpm --filter @tryout/llm test` — 3 AnthropicLlmRouter tests pass.
- [ ] `pnpm --filter @tryout/api test` — 20 unit tests pass (PasswordService 3, GitHubService 5, PollPrProcessor 3, PollCiProcessor 5, PmService 1, SeniorReviewService 3).
- [ ] `pnpm --filter @tryout/api test:e2e` — 12 e2e tests pass (auth 7, scenario-runs 4, visible-loop 1), against real Postgres with mocked GitHub/queue/LLM.
- [ ] `cd templates/lumi-tasks-api && npm test` — 4 template tests still pass.
- [ ] `pnpm --filter @tryout/web build` — web builds with the `/run` route.
- [ ] **Manual end-to-end (requires real `GITHUB_TOKEN`, `GITHUB_OWNER`, `ANTHROPIC_API_KEY` in `.env`, and the template repo pushed + marked as a template on GitHub):**
  - Start infra, migrate, seed.
  - Run API and web.
  - Sign up in the browser → land on `/run` → click "Start the scenario".
  - Within a few seconds the PM intro appears and the repo link works.
  - Clone the repo, push a branch, open a PR. Within ~60–90 s the page shows the PR, CI status, and a Senior review with "Changes requested".

**Out of M2 (do not build here):** human→agent chat (M3), scoring/scorecard (M4), run status transitions beyond `onboarding`, retry/next, the soft deadline, the optional scope-change event, inline per-line PR comments.
