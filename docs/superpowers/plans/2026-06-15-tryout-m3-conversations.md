# Tryout M3 — Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the candidate hold a two-way conversation with the PM (to clarify the deliberately-ambiguous ticket) and the Senior (to ask for help without being handed the answer), with every turn persisted as an `AgentMessage` and rendered in the web UI.

**Architecture:** A single synchronous request/response `AgentChatService` handles both personas (spec §5 Decision 2 — each agent is one well-prompted LLM call). `POST /scenario-runs/:id/messages` persists the user's turn, builds the per-persona system prompt plus the prior conversation for that agent, calls the existing `LLM_ROUTER` (chat complexity → Haiku), persists and returns the agent's reply. The first message moves the run from `onboarding` to `in_progress`. `GET /scenario-runs/:id/messages` returns the full transcript. The web `/run` page gains two chat panels (PM, Senior).

**Tech Stack:** Existing `LLM_ROUTER` (`AnthropicLlmRouter`), Drizzle `agentMessages` table, NestJS controller + `class-validator` DTO, React client components.

**Source spec:** `docs/team-sim-spec-v1.md` §3 (clarify with PM, ask Senior for help), §9 (PM rewards good questions / stays in character; Senior helps without revealing the solution), §11 M3 ("Conversations — chat with the PM and the Senior, persisted as AgentMessages").

---

## Conventions

- All commands run from repo root (`H:\TRYOUT`) unless a step says otherwise.
- Build the API with `pnpm --filter @tryout/api build`. If the pnpm store flakes (missing `next`/`has-flag`), run `pnpm install --force` then retry.
- Run a single API test file with `pnpm --filter @tryout/api test -- <name-fragment>`.
- Chat is **synchronous** request/response (not queued): the POST does the LLM call inline and returns the reply. Unlike the M2 PM-intro and review jobs, there is no BullMQ job here.
- The persona system prompts come from the seeded scenario `definition`. The PM persona (`agent_prompts.pm_mai.system`) already embeds the canonical clarification answers; the Senior persona (`agent_prompts.senior_alex.system`) already describes CHAT vs PR-REVIEW modes.
- Agents remain single well-prompted LLM calls. Do not add a graph or autonomous loop.

---

## Prerequisites

All M2 prerequisites (a real `ANTHROPIC_API_KEY` for live use; tests mock the router). Nothing new.

---

## File Structure

```
apps/api/src/agents/
├── dto/
│   └── send-message.dto.ts            ← NEW — { agentRole, content } validation
├── agent-chat.service.ts              ← NEW — sendMessage + listMessages (both personas)
├── agent-chat.service.spec.ts         ← NEW — unit tests (mocked db + router)
├── agent-chat.controller.ts           ← NEW — POST/GET /scenario-runs/:id/messages
└── agents.module.ts                   ← MODIFY — import AuthModule; add chat service + controller

apps/api/test/
└── conversations.e2e-spec.ts          ← NEW — send/list messages end to end (mocked router)

apps/web/src/
├── lib/api.ts                         ← MODIFY — getMessages + sendMessage + AgentMessageView
├── components/ChatPanel.tsx           ← NEW — one agent's thread + input box
└── app/run/page.tsx                   ← MODIFY — render PM + Senior chat panels

docs/STATUS.md                         ← MODIFY — mark M3 complete
```

---

## Task 1: `AgentChatService` — the conversation engine

One service drives both personas. `sendMessage` persists the user turn, flips the run to `in_progress` on the first message, replays that agent's prior turns into the model, and persists + returns the reply. `listMessages` returns the whole transcript for the run (both agents), ownership-checked.

**Files:**
- Create: `apps/api/src/agents/agent-chat.service.ts`
- Create: `apps/api/src/agents/agent-chat.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/agents/agent-chat.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AgentChatService } from './agent-chat.service';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';

const scenarioDefinition = {
  title: 'Add the ability to archive tasks',
  company_context: { name: 'Lumi', product: 'p', team: 't', user_role: 'Backend Engineer' },
  ticket: { id: 'LUMI-142', title: 'Archive', body: 'Add archive.' },
  agent_prompts: {
    pm_mai: { system: 'You are Mai, the PM.' },
    senior_alex: { system: 'You are Alex, a senior engineer.' },
  },
  ground_truth: { solution_notes: 'Soft archive; add unarchive.', red_flags: [] },
};

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
};

const mockRouter = { generate: jest.fn() };

describe('AgentChatService', () => {
  let service: AgentChatService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentChatService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: LLM_ROUTER, useValue: mockRouter },
      ],
    }).compile();
    service = moduleRef.get(AgentChatService);
    // Default: insert chains resolve (the user-message insert is awaited with no .returning()).
    mockDb.values.mockReturnThis();
    mockDb.where.mockReturnThis();
  });

  it('persists the user turn, flips onboarding → in_progress, and returns the agent reply', async () => {
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'run-1', userId: 'user-1', scenarioId: 'scn-1', status: 'onboarding' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }]);
    // history (after the user turn is inserted): one user message for the PM thread.
    mockDb.orderBy.mockResolvedValue([
      { direction: 'user', content: 'Should archived tasks be hidden?' },
    ]);
    mockRouter.generate.mockResolvedValue({ content: 'Good question — yes, hide them by default.' });
    mockDb.returning.mockResolvedValue([
      { id: 'msg-2', agentRole: 'pm', direction: 'agent', content: 'Good question — yes, hide them by default.' },
    ]);

    const reply = await service.sendMessage('run-1', 'user-1', 'pm', 'Should archived tasks be hidden?');

    // Status moved to in_progress.
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ status: 'in_progress' });

    // The model got the PM persona as system + the user turn mapped to role 'user'.
    const callArg = mockRouter.generate.mock.calls[0][0];
    expect(callArg.role).toBe('pm');
    expect(callArg.taskComplexity).toBe('chat');
    expect(callArg.messages[0].role).toBe('system');
    expect(callArg.messages[0].content).toContain('You are Mai, the PM.');
    expect(callArg.messages[1]).toEqual({ role: 'user', content: 'Should archived tasks be hidden?' });

    // Two inserts: the user turn and the agent reply.
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
    expect(reply.content).toBe('Good question — yes, hide them by default.');
  });

  it('does not change status when the run is already in_progress', async () => {
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'run-1', userId: 'user-1', scenarioId: 'scn-1', status: 'in_progress' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }]);
    mockDb.orderBy.mockResolvedValue([{ direction: 'user', content: 'hi' }]);
    mockRouter.generate.mockResolvedValue({ content: 'hello' });
    mockDb.returning.mockResolvedValue([{ id: 'm', agentRole: 'senior', direction: 'agent', content: 'hello' }]);

    await service.sendMessage('run-1', 'user-1', 'senior', 'hi');

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('uses the Senior persona (CHAT mode) for senior messages', async () => {
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'run-1', userId: 'user-1', scenarioId: 'scn-1', status: 'in_progress' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }]);
    mockDb.orderBy.mockResolvedValue([{ direction: 'user', content: 'where do I start?' }]);
    mockRouter.generate.mockResolvedValue({ content: 'Look at tasks.service.ts.' });
    mockDb.returning.mockResolvedValue([{ id: 'm', agentRole: 'senior', direction: 'agent', content: 'Look at tasks.service.ts.' }]);

    await service.sendMessage('run-1', 'user-1', 'senior', 'where do I start?');

    const system = mockRouter.generate.mock.calls[0][0].messages[0].content;
    expect(system).toContain('You are Alex, a senior engineer.');
    expect(system).toContain('CHAT mode');
  });

  it('throws NotFound when the run belongs to another user', async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: 'run-1', userId: 'someone-else', status: 'onboarding' }]);

    await expect(
      service.sendMessage('run-1', 'user-1', 'pm', 'hi'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tryout/api test -- agent-chat.service`
Expected: FAIL — cannot find module `./agent-chat.service`.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/agents/agent-chat.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, asc } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { ScenarioDefinition } from '@tryout/shared';
import type { LlmRouter } from '@tryout/llm';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';

export type ChatAgentRole = 'pm' | 'senior';

@Injectable()
export class AgentChatService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_ROUTER) private readonly router: LlmRouter,
  ) {}

  async listMessages(runId: string, userId: string) {
    await this.loadOwnedRun(runId, userId);
    return this.db
      .select()
      .from(schema.agentMessages)
      .where(eq(schema.agentMessages.scenarioRunId, runId))
      .orderBy(asc(schema.agentMessages.createdAt));
  }

  async sendMessage(
    runId: string,
    userId: string,
    agentRole: ChatAgentRole,
    content: string,
  ) {
    const run = await this.loadOwnedRun(runId, userId);
    const def = await this.loadDefinition(run.scenarioId);

    await this.db.insert(schema.agentMessages).values({
      scenarioRunId: runId,
      agentRole,
      direction: 'user',
      content,
    });

    if (run.status === 'onboarding') {
      await this.db
        .update(schema.scenarioRuns)
        .set({ status: 'in_progress' })
        .where(eq(schema.scenarioRuns.id, runId));
    }

    const history = await this.db
      .select()
      .from(schema.agentMessages)
      .where(
        and(
          eq(schema.agentMessages.scenarioRunId, runId),
          eq(schema.agentMessages.agentRole, agentRole),
        ),
      )
      .orderBy(asc(schema.agentMessages.createdAt));

    const system = agentRole === 'pm' ? this.buildPmSystem(def) : this.buildSeniorSystem(def);
    const messages = [
      { role: 'system' as const, content: system },
      ...history.map((m) => ({
        role: (m.direction === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const result = await this.router.generate({
      role: agentRole,
      taskComplexity: 'chat',
      messages,
    });

    const [agentMessage] = await this.db
      .insert(schema.agentMessages)
      .values({
        scenarioRunId: runId,
        agentRole,
        direction: 'agent',
        content: result.content,
      })
      .returning();

    return agentMessage;
  }

  private async loadOwnedRun(runId: string, userId: string) {
    const [run] = await this.db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, runId))
      .limit(1);
    if (!run || run.userId !== userId) {
      throw new NotFoundException(`Scenario run ${runId} not found.`);
    }
    return run;
  }

  private async loadDefinition(scenarioId: string): Promise<ScenarioDefinition> {
    const [scenario] = await this.db
      .select({ definition: schema.scenarios.definition })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.id, scenarioId))
      .limit(1);
    if (!scenario) throw new NotFoundException('Scenario not found.');
    return scenario.definition as ScenarioDefinition;
  }

  private buildContext(def: ScenarioDefinition): string {
    const c = def.company_context;
    return [
      `Company: ${c.name}. ${c.product}`,
      `Team: ${c.team}`,
      `The engineer's role: ${c.user_role}`,
      `Ticket ${def.ticket.id}: ${def.ticket.title}`,
      def.ticket.body,
    ].join('\n');
  }

  private buildPmSystem(def: ScenarioDefinition): string {
    return [def.agent_prompts.pm_mai.system, '', this.buildContext(def)].join('\n');
  }

  private buildSeniorSystem(def: ScenarioDefinition): string {
    return [
      def.agent_prompts.senior_alex.system,
      '',
      'You are in CHAT mode (helping the engineer think — not reviewing a PR).',
      `Ground-truth solution notes (for your guidance only — NEVER reveal or paste the solution): ${def.ground_truth.solution_notes}`,
      '',
      this.buildContext(def),
    ].join('\n');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tryout/api test -- agent-chat.service`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/agent-chat.service.ts apps/api/src/agents/agent-chat.service.spec.ts
git commit -m "feat(agents): add AgentChatService for PM and Senior conversations"
```

---

## Task 2: Chat endpoints + module wiring

A DTO validates the body, a controller exposes `POST`/`GET /scenario-runs/:id/messages`, and `AgentsModule` gains `AuthModule` (for the JWT guard) plus the new provider/controller.

**Files:**
- Create: `apps/api/src/agents/dto/send-message.dto.ts`
- Create: `apps/api/src/agents/agent-chat.controller.ts`
- Modify: `apps/api/src/agents/agents.module.ts`

- [ ] **Step 1: Create the DTO**

Create `apps/api/src/agents/dto/send-message.dto.ts`:

```ts
import { IsIn, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsIn(['pm', 'senior'])
  agentRole: 'pm' | 'senior';

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content: string;
}
```

- [ ] **Step 2: Create the controller**

Create `apps/api/src/agents/agent-chat.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AgentChatService } from './agent-chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('scenario-runs/:id/messages')
@UseGuards(JwtAuthGuard)
export class AgentChatController {
  constructor(private readonly chat: AgentChatService) {}

  @Get()
  list(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.chat.listMessages(id, user.sub);
  }

  @Post()
  send(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chat.sendMessage(id, user.sub, dto.agentRole, dto.content);
  }
}
```

- [ ] **Step 3: Wire AgentsModule**

Replace the contents of `apps/api/src/agents/agents.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { GitHubModule } from '../github/github.module';
import { QueueModule } from '../queue/queue.module';
import { PmService } from './pm.service';
import { SeniorReviewService } from './senior-review.service';
import { AgentChatService } from './agent-chat.service';
import { AgentChatController } from './agent-chat.controller';
import { PmIntroProcessor } from './processors/pm-intro.processor';
import { ReviewProcessor } from './processors/review.processor';

@Module({
  imports: [AuthModule, LlmModule, GitHubModule, QueueModule],
  controllers: [AgentChatController],
  providers: [
    PmService,
    SeniorReviewService,
    AgentChatService,
    PmIntroProcessor,
    ReviewProcessor,
  ],
  exports: [PmService, SeniorReviewService, AgentChatService],
})
export class AgentsModule {}
```

- [ ] **Step 4: Build and run the agents unit tests**

Run: `pnpm --filter @tryout/api build`
Expected: no TS errors.

Run: `pnpm --filter @tryout/api test -- agents`
Expected: PASS — `pm.service` (1), `senior-review.service` (3), `agent-chat.service` (4) = 8 tests in the agents folder.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/dto apps/api/src/agents/agent-chat.controller.ts apps/api/src/agents/agents.module.ts
git commit -m "feat(agents): expose POST/GET /scenario-runs/:id/messages"
```

---

## Task 3: E2E — a real conversation

Drives the HTTP endpoints against a real Postgres with a mocked LLM router (and mocked GitHub/queue so a run can be created). Verifies the user turn + agent reply persist, the transcript reads back in order, the run flips to `in_progress`, and auth is enforced.

**Files:**
- Create: `apps/api/test/conversations.e2e-spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `apps/api/test/conversations.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GitHubService } from '../src/github/github.service';
import { QueueService } from '../src/queue/queue.service';
import { LLM_ROUTER } from '../src/llm/llm.module';

const mockGitHubService = {
  createRepoFromTemplate: jest.fn().mockResolvedValue({
    htmlUrl: 'https://github.com/test-owner/lumi-tasks-m3',
    fullName: 'test-owner/lumi-tasks-m3',
    repoName: 'lumi-tasks-m3',
  }),
  listOpenPullRequests: jest.fn().mockResolvedValue([]),
  getPullRequestDiff: jest.fn().mockResolvedValue(''),
  getCheckRuns: jest.fn().mockResolvedValue([]),
  createPullRequestReview: jest.fn().mockResolvedValue(undefined),
};

const mockQueueService = {
  enqueuePollPr: jest.fn().mockResolvedValue(undefined),
  enqueuePollCi: jest.fn().mockResolvedValue(undefined),
  enqueuePmIntro: jest.fn().mockResolvedValue(undefined),
  enqueueReview: jest.fn().mockResolvedValue(undefined),
};

const mockRouter = { generate: jest.fn() };

describe('Conversations (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let runId: string;
  const email = `m3-${Date.now()}@example.com`;
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

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(201);
    authToken = signup.body.token;

    const start = await request(app.getHttpServer())
      .post('/scenario-runs')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    runId = start.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated message posts', async () => {
    await request(app.getHttpServer())
      .post(`/scenario-runs/${runId}/messages`)
      .send({ agentRole: 'pm', content: 'hi' })
      .expect(401);
  });

  it('rejects an invalid agentRole', async () => {
    await request(app.getHttpServer())
      .post(`/scenario-runs/${runId}/messages`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ agentRole: 'ceo', content: 'hi' })
      .expect(400);
  });

  it('sends a PM message and gets a persisted agent reply', async () => {
    mockRouter.generate.mockResolvedValueOnce({
      content: 'Good question — hide archived tasks by default.',
    });

    const res = await request(app.getHttpServer())
      .post(`/scenario-runs/${runId}/messages`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ agentRole: 'pm', content: 'Should archived tasks be hidden from the list?' })
      .expect(201);

    expect(res.body.agentRole).toBe('pm');
    expect(res.body.direction).toBe('agent');
    expect(res.body.content).toContain('hide archived tasks');
  });

  it('returns the full transcript in order', async () => {
    const res = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}/messages`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    // The PM exchange above: one user turn then one agent turn.
    const pmMessages = res.body.filter((m: any) => m.agentRole === 'pm');
    expect(pmMessages.length).toBeGreaterThanOrEqual(2);
    expect(pmMessages[0].direction).toBe('user');
    expect(pmMessages[1].direction).toBe('agent');
  });

  it('moved the run to in_progress after the first message', async () => {
    const res = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(res.body.status).toBe('in_progress');
  });
});
```

- [ ] **Step 2: Run the full e2e suite**

Ensure infra is up (`docker compose ps`) and the seed has been applied. Run:

```bash
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout JWT_SECRET=dev pnpm --filter @tryout/api test:e2e
```

Expected: PASS — auth (7) + scenario-runs (4) + visible-loop (1) + conversations (5) = **17 e2e tests**.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/conversations.e2e-spec.ts
git commit -m "test(api): e2e for PM and Senior conversations"
```

---

## Task 4: Web — chat panels on the run page

A reusable `ChatPanel` renders one agent's thread and an input box; the `/run` page shows one for the PM and one for the Senior. Sending posts the message, then re-fetches the transcript.

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/components/ChatPanel.tsx`
- Modify: `apps/web/src/app/run/page.tsx`

- [ ] **Step 1: Add chat methods to the API client**

Edit `apps/web/src/lib/api.ts`. Add this type after the `ScenarioRunView` interface:

```ts
export interface AgentMessageView {
  id: string;
  agentRole: 'pm' | 'senior';
  direction: 'user' | 'agent';
  content: string;
  createdAt: string;
}
```

Then add these two methods inside the `api` object, after `getRun`:

```ts
  getMessages: async (runId: string): Promise<AgentMessageView[]> => {
    const res = await fetch(`${API_URL}/scenario-runs/${runId}/messages`, {
      headers: { ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Failed to load messages (${res.status})`);
    return res.json() as Promise<AgentMessageView[]>;
  },

  sendMessage: async (
    runId: string,
    agentRole: 'pm' | 'senior',
    content: string,
  ): Promise<AgentMessageView> => {
    const res = await fetch(`${API_URL}/scenario-runs/${runId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ agentRole, content }),
    });
    if (!res.ok) throw new Error(`Failed to send message (${res.status})`);
    return res.json() as Promise<AgentMessageView>;
  },
```

- [ ] **Step 2: Create the ChatPanel component**

Create `apps/web/src/components/ChatPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { api, type AgentMessageView } from '@/lib/api';

interface ChatPanelProps {
  runId: string;
  agentRole: 'pm' | 'senior';
  title: string;
  messages: AgentMessageView[];
  onSent: () => void;
}

const panelStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md, 12px)',
  padding: 'var(--space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  minHeight: 320,
};

export function ChatPanel({ runId, agentRole, title, messages, onSent }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const thread = messages.filter((m) => m.agentRole === agentRole);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setError(null);
    try {
      await api.sendMessage(runId, agentRole, content);
      setDraft('');
      onSent();
    } catch {
      setError('Could not send. Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section style={panelStyle} aria-label={`Chat with ${title}`}>
      <h2 style={{ margin: 0, fontSize: 'var(--text-md, 1.25rem)' }}>{title}</h2>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', overflowY: 'auto' }}>
        {thread.length === 0 ? (
          <p style={{ color: 'var(--color-muted)', margin: 0 }}>No messages yet. Say hello.</p>
        ) : (
          thread.map((m) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.direction === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background:
                  m.direction === 'user' ? 'var(--color-accent-soft, #eef2ff)' : 'var(--color-bg, #f6f6f6)',
                borderRadius: 10,
                padding: 'var(--space-2) var(--space-3)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content}
            </div>
          ))
        )}
      </div>
      {error && <p role="alert" style={{ color: 'var(--color-danger, #b42318)', margin: 0 }}>{error}</p>}
      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input
          aria-label={`Message ${title}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${title}…`}
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 3: Render the panels on the run page**

Edit `apps/web/src/app/run/page.tsx`. Update the imports at the top:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, type ScenarioRunView, type AgentMessageView } from '@/lib/api';
import { RunView } from '@/components/RunView';
import { ChatPanel } from '@/components/ChatPanel';
```

Add a `messages` state alongside the existing `run` state (just after the `const [run, setRun] = ...` line):

```tsx
  const [messages, setMessages] = useState<AgentMessageView[]>([]);
```

Replace the existing `refresh` callback with one that also pulls messages:

```tsx
  const refresh = useCallback(async (id: string) => {
    try {
      const [data, msgs] = await Promise.all([api.getRun(id), api.getMessages(id)]);
      setRun(data);
      setMessages(msgs);
    } catch {
      setError('Could not load your run.');
    }
  }, []);
```

Finally, replace the last `return <RunView run={run} />;` line with a layout that adds the two chat panels under the run view:

```tsx
  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-4)' }}>
      <RunView run={run} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
        <ChatPanel
          runId={run.id}
          agentRole="pm"
          title="Mai (PM)"
          messages={messages}
          onSent={() => refresh(run.id)}
        />
        <ChatPanel
          runId={run.id}
          agentRole="senior"
          title="Alex (Senior)"
          messages={messages}
          onSent={() => refresh(run.id)}
        />
      </div>
    </div>
  );
```

> Note: `RunView` already wraps its content in a `<main>` with its own `max-width`; nesting it here is fine for M3. If the double-centering looks off, that is a polish item for M5, not a blocker.

- [ ] **Step 4: Build the web app**

Run: `pnpm --filter @tryout/web build`
Expected: Next.js build succeeds with the `/run` route. (If it fails on a missing `next` binary, run `pnpm install --force` and rebuild — known store flakiness.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/components/ChatPanel.tsx apps/web/src/app/run/page.tsx
git commit -m "feat(web): add PM and Senior chat panels to the run page"
```

---

## Task 5: Update project docs

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Mark M3 complete**

Edit `docs/STATUS.md`:
- In the milestone table, change the M3 row to `| M3 | Conversations | ✅ Complete |`.
- Replace the `## M3 — Conversations 🔲` section heading with `## M3 — Conversations ✅` and replace its `### Planned` list with a `### Done` list:
  - `AgentChatService` — one synchronous LLM call per turn for both personas; persists user + agent `AgentMessage`s
  - `POST /scenario-runs/:id/messages` + `GET /scenario-runs/:id/messages` (JWT-guarded, ownership-checked, `SendMessageDto` validation)
  - PM uses the persona prompt with canonical clarifications; Senior uses CHAT mode and never reveals the solution
  - First message transitions the run `onboarding → in_progress`
  - Web `/run` page: PM + Senior chat panels
  - Test coverage: API unit 24 (adds AgentChatService 4), e2e 17 (adds conversations 5)
- Update the "Key Metrics" table: Unit tests `27 (llm 3 + api 24)`, E2E tests `17`, API endpoints `7` (adds messages POST/GET).

- [ ] **Step 2: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: record M3 (conversations) completion"
```

---

## M3 Verification Gate

Run before declaring M3 complete. All must pass:

- [ ] `pnpm --filter @tryout/api build` — compiles with no TS errors.
- [ ] `pnpm --filter @tryout/api test` — 24 unit tests pass (M2's 20 + AgentChatService 4).
- [ ] `pnpm --filter @tryout/api test:e2e` — 17 e2e tests pass (auth 7, scenario-runs 4, visible-loop 1, conversations 5), against real Postgres with a mocked LLM router.
- [ ] `pnpm --filter @tryout/web build` — web builds with the `/run` route.
- [ ] **Manual (requires real `ANTHROPIC_API_KEY`):** start the stack, open `/run`, send the PM a clarifying question ("Should archived tasks be hidden from the default list?") and confirm a useful in-character reply; ask the Senior "where should I start?" and confirm it nudges toward a file without pasting the solution.

**Out of M3 (do not build here):** grading / scorecard (M4); the optional PM scope-change injected event, retry/next, and soft deadline (M5); streaming responses; per-line PR review comments.
