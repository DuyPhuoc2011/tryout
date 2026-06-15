# Tryout M4 — Grading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a candidate has done the work, let them submit the run for grading; a single structured LLM "Grader" call reads the whole record — the PM/Senior conversation, the real PR diff, the candidate's CI status, the Senior's review thread, and the scenario's ground truth + rubric — and produces a persisted technical + professional **Scorecard** that the web UI renders.

**Architecture:** A `GradingService` owns three operations: `requestGrade` (ownership-checked; refuses if no PR was ever opened; flips status to `grading` and enqueues an async `grade` job), `gradeRun` (the Grader — one `LLM_ROUTER` call at `grade` complexity → Sonnet — that assembles the context, parses the structured scorecard JSON, persists a `Scorecard`, and flips status to `complete`), and `getScorecard` (reads it back). A `GradeProcessor` BullMQ worker runs `gradeRun` off the queue. Per the spec, the Grader is a single well-prompted call with the ground truth in hand, so its judgments are anchored, not vibes. **No code execution / sandbox** (spec §5): the Grader establishes technical correctness from the diff + the candidate's own CI status + ground-truth notes; running a hidden acceptance suite on GitHub is a deliberate later follow-up.

**Tech Stack:** Existing `LLM_ROUTER` (`grade` → Sonnet), `GitHubService.getPullRequestDiff`, BullMQ `grade` queue, the existing `scorecards` Drizzle table, a results view in Next.js.

**Source spec:** `docs/team-sim-spec-v1.md` §9 (the Grader: single structured evaluation over the full transcript + PR + CI + review + ground truth; feedback specific, actionable, kind), §10 (technical vs professional dimensions, scored and explained separately + an overall note; rubric authored per-scenario), §11 M4 ("Implement the Grader and the scorecard … run as an async job, render the result").

---

## Conventions

- All commands run from repo root (`H:\TRYOUT`) unless a step says otherwise.
- Build the API with `pnpm --filter @tryout/api build`. If the pnpm store flakes (missing `next`/`has-flag`), run `pnpm install --force` then retry.
- Run a single API test file with `pnpm --filter @tryout/api test -- <name-fragment>`.
- Grading is an **async job** (spec §11): `requestGrade` enqueues; `GradeProcessor` runs `gradeRun`. Tests invoke `gradeRun` directly (the queue is mocked), mirroring how M2/M3 e2e drive the agent services.
- The Grader is a single well-prompted LLM call (spec §9). No multi-pass, no agent graph.
- `grade` task complexity routes to the review model (`claude-sonnet-4-6`) — see `AnthropicLlmRouter`.
- Scores are integers 0–100 (the `scorecards` columns are `integer`); the parser clamps to that range.

---

## Prerequisites

All prior prerequisites. Live grading needs a real `ANTHROPIC_API_KEY`; the automated suite mocks the router. No new env vars.

---

## File Structure

```
packages/shared/src/
└── scenario.ts                         ← MODIFY — add rubric types + rubric on ScenarioDefinition

apps/api/src/
├── queue/
│   ├── queue.constants.ts              ← MODIFY — add GRADE queue name + GradeJobData
│   ├── queue.module.ts                 ← MODIFY — register the grade queue
│   └── queue.service.ts                ← MODIFY — enqueueGrade helper
├── grading/
│   ├── grading.service.ts              ← NEW — requestGrade, gradeRun, getScorecard
│   ├── grading.service.spec.ts         ← NEW — unit tests (mocked db/router/github/queue)
│   ├── grading.controller.ts           ← NEW — POST :id/grade, GET :id/scorecard
│   ├── grade.processor.ts              ← NEW — BullMQ worker → gradeRun
│   └── grading.module.ts               ← NEW — wires the above
└── app.module.ts                       ← MODIFY — import GradingModule

apps/api/test/
└── grading.e2e-spec.ts                 ← NEW — request grade + scorecard end to end

apps/web/src/
├── lib/api.ts                          ← MODIFY — requestGrade + getScorecard + ScorecardView type
├── components/ScorecardView.tsx        ← NEW — renders technical + professional scores
└── app/run/page.tsx                    ← MODIFY — grade button + scorecard rendering

docs/STATUS.md                          ← MODIFY — mark M4 complete
```

---

## Task 1: Rubric types in `@tryout/shared`

The Grader enumerates the scenario's rubric criteria in its prompt, so the rubric must be part of the typed `ScenarioDefinition`.

**Files:**
- Modify: `packages/shared/src/scenario.ts`

- [ ] **Step 1: Add rubric types and extend ScenarioDefinition**

Edit `packages/shared/src/scenario.ts`. Add these interfaces after `ScenarioGroundTruth`:

```ts
export interface ScenarioRubricCriterion {
  id: string;
  weight: number;
  description: string;
}

export interface ScenarioRubricDimension {
  weight: number;
  criteria: ScenarioRubricCriterion[];
}

export interface ScenarioRubric {
  technical: ScenarioRubricDimension;
  professional: ScenarioRubricDimension;
}
```

Then add a `rubric` field to the `ScenarioDefinition` interface, after `ground_truth`:

```ts
  ground_truth: ScenarioGroundTruth;
  rubric: ScenarioRubric;
```

- [ ] **Step 2: Build the package**

Run: `pnpm --filter @tryout/shared build`
Expected: compiles with no TS errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/scenario.ts
git commit -m "feat(shared): add rubric types to ScenarioDefinition"
```

---

## Task 2: Grade queue plumbing

**Files:**
- Modify: `apps/api/src/queue/queue.constants.ts`
- Modify: `apps/api/src/queue/queue.module.ts`
- Modify: `apps/api/src/queue/queue.service.ts`

- [ ] **Step 1: Add the queue name and job type**

Edit `apps/api/src/queue/queue.constants.ts`. Add `GRADE: 'grade'` to `QUEUE_NAMES` so it reads:

```ts
export const QUEUE_NAMES = {
  POLL_PR: 'poll-pr',
  POLL_CI: 'poll-ci',
  PM_INTRO: 'pm-intro',
  REVIEW: 'review',
  GRADE: 'grade',
} as const;
```

Then add this interface at the end of the file:

```ts
export interface GradeJobData {
  scenarioRunId: string;
}
```

- [ ] **Step 2: Register the grade queue**

Edit `apps/api/src/queue/queue.module.ts`. Add one `registerQueue` call after the existing ones:

```ts
    BullModule.registerQueue({ name: QUEUE_NAMES.GRADE }),
```

- [ ] **Step 3: Add the enqueue helper**

Edit `apps/api/src/queue/queue.service.ts`:

Add `GradeJobData` to the import from `./queue.constants`:

```ts
import {
  QUEUE_NAMES,
  PollPrJobData,
  PollCiJobData,
  PmIntroJobData,
  GradeJobData,
} from './queue.constants';
```

Add the grade queue to the constructor injections (after `reviewQueue`):

```ts
    @InjectQueue(QUEUE_NAMES.GRADE) private readonly gradeQueue: Queue,
```

Add this method after `enqueueReview`:

```ts
  async enqueueGrade(data: GradeJobData): Promise<void> {
    await this.gradeQueue.add('grade', data, {
      attempts: 2,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
```

- [ ] **Step 4: Build**

Run: `pnpm --filter @tryout/api build`
Expected: no TS errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/queue/queue.constants.ts apps/api/src/queue/queue.module.ts apps/api/src/queue/queue.service.ts
git commit -m "feat(queue): add grade queue with enqueueGrade helper"
```

---

## Task 3: `GradingService` — the Grader

`requestGrade` validates and kicks off the async job; `gradeRun` is the single Grader LLM call that assembles the record, parses the scorecard, persists it, and completes the run; `getScorecard` reads it back. All three are ownership-aware where they face a user.

**Files:**
- Create: `apps/api/src/grading/grading.service.ts`
- Create: `apps/api/src/grading/grading.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/grading/grading.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GradingService } from './grading.service';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { GitHubService } from '../github/github.service';
import { QueueService } from '../queue/queue.service';

const scenarioDefinition = {
  title: 'Add the ability to archive tasks',
  company_context: { name: 'Lumi', product: 'p', team: 't', user_role: 'Backend Engineer' },
  ticket: { id: 'LUMI-142', title: 'Archive', body: 'Add archive.' },
  agent_prompts: {
    pm_mai: { system: 'You are Mai.' },
    senior_alex: { system: 'You are Alex.' },
  },
  ground_truth: { solution_notes: 'Soft archive; add unarchive.', red_flags: ['hard delete'] },
  rubric: {
    technical: {
      weight: 0.5,
      criteria: [{ id: 'correctness', weight: 0.5, description: 'Feature works.' }],
    },
    professional: {
      weight: 0.5,
      criteria: [{ id: 'surfaced_ambiguity', weight: 0.5, description: 'Asked a clarifying question.' }],
    },
  },
};

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
};

const mockRouter = { generate: jest.fn() };
const mockGitHub = { getPullRequestDiff: jest.fn() };
const mockQueue = { enqueueGrade: jest.fn() };

describe('GradingService', () => {
  let service: GradingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GradingService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: LLM_ROUTER, useValue: mockRouter },
        { provide: GitHubService, useValue: mockGitHub },
        { provide: QueueService, useValue: mockQueue },
      ],
    }).compile();
    service = moduleRef.get(GradingService);
    mockDb.values.mockReturnThis();
    mockDb.where.mockReturnThis();
  });

  describe('requestGrade', () => {
    it('rejects when the run has no submission', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 'run-1', userId: 'user-1', status: 'in_progress' }]);
      mockDb.orderBy.mockResolvedValueOnce([]); // no submissions

      await expect(service.requestGrade('run-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(mockQueue.enqueueGrade).not.toHaveBeenCalled();
    });

    it('flips status to grading and enqueues when a submission exists', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 'run-1', userId: 'user-1', status: 'in_progress' }]);
      mockDb.orderBy.mockResolvedValueOnce([{ id: 'sub-1', prUrl: 'x' }]);

      const res = await service.requestGrade('run-1', 'user-1');

      expect(mockDb.set).toHaveBeenCalledWith({ status: 'grading' });
      expect(mockQueue.enqueueGrade).toHaveBeenCalledWith({ scenarioRunId: 'run-1' });
      expect(res.status).toBe('grading');
    });

    it('throws NotFound when the run belongs to another user', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 'run-1', userId: 'someone-else', status: 'in_progress' }]);
      await expect(service.requestGrade('run-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('gradeRun', () => {
    it('grades the run: persists a scorecard and completes the run', async () => {
      // run, scenario (two .limit loads)
      mockDb.limit
        .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1', status: 'grading' }])
        .mockResolvedValueOnce([{ definition: scenarioDefinition }]);
      // submissions, messages, reviews (three .orderBy loads, in this order)
      mockDb.orderBy
        .mockResolvedValueOnce([
          { id: 'sub-1', prUrl: 'https://github.com/test-owner/lumi-tasks-x/pull/3', ciStatus: 'success' },
        ])
        .mockResolvedValueOnce([
          { agentRole: 'pm', direction: 'user', content: 'Should archived be hidden?' },
          { agentRole: 'pm', direction: 'agent', content: 'Yes, hide them by default.' },
        ])
        .mockResolvedValueOnce([
          { verdict: 'request_changes', comments: { summary: 'Add unarchive', comments: [] } },
        ]);
      mockGitHub.getPullRequestDiff.mockResolvedValue('diff --git a/x b/x');
      mockRouter.generate.mockResolvedValue({
        content: JSON.stringify({
          technicalScore: 82,
          technicalFeedback: 'Solid; missing an edge case.',
          professionalScore: 90,
          professionalFeedback: 'Asked a great clarifying question.',
          overallFeedback: 'Strong first ticket.',
        }),
      });

      await service.gradeRun('run-1');

      // Grader was called as the grader at grade complexity.
      const callArg = mockRouter.generate.mock.calls[0][0];
      expect(callArg.role).toBe('grader');
      expect(callArg.taskComplexity).toBe('grade');
      // The diff was fetched from the parsed PR URL.
      expect(mockGitHub.getPullRequestDiff).toHaveBeenCalledWith('test-owner', 'lumi-tasks-x', 3);
      // The scorecard was inserted with parsed scores.
      const inserted = mockDb.values.mock.calls.at(-1)[0];
      expect(inserted.scenarioRunId).toBe('run-1');
      expect(inserted.technicalScore).toBe(82);
      expect(inserted.professionalScore).toBe(90);
      expect(inserted.overallFeedback).toBe('Strong first ticket.');
      // The run was completed.
      expect(mockDb.set).toHaveBeenCalledWith({ status: 'complete' });
    });

    it('clamps out-of-range scores to 0–100', async () => {
      mockDb.limit
        .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1', status: 'grading' }])
        .mockResolvedValueOnce([{ definition: scenarioDefinition }]);
      mockDb.orderBy
        .mockResolvedValueOnce([{ id: 'sub-1', prUrl: 'https://github.com/o/r/pull/1', ciStatus: 'failure' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockGitHub.getPullRequestDiff.mockResolvedValue('diff');
      mockRouter.generate.mockResolvedValue({
        content: JSON.stringify({
          technicalScore: 130,
          technicalFeedback: 't',
          professionalScore: -20,
          professionalFeedback: 'p',
          overallFeedback: 'o',
        }),
      });

      await service.gradeRun('run-1');

      const inserted = mockDb.values.mock.calls.at(-1)[0];
      expect(inserted.technicalScore).toBe(100);
      expect(inserted.professionalScore).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tryout/api test -- grading.service`
Expected: FAIL — cannot find module `./grading.service`.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/grading/grading.service.ts`:

```ts
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, asc, desc } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { ScenarioDefinition } from '@tryout/shared';
import type { LlmRouter } from '@tryout/llm';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { GitHubService } from '../github/github.service';
import { QueueService } from '../queue/queue.service';

interface ParsedScorecard {
  technicalScore: number;
  technicalFeedback: string;
  professionalScore: number;
  professionalFeedback: string;
  overallFeedback: string;
}

const MAX_DIFF_CHARS = 12_000;

@Injectable()
export class GradingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_ROUTER) private readonly router: LlmRouter,
    private readonly github: GitHubService,
    private readonly queue: QueueService,
  ) {}

  async requestGrade(runId: string, userId: string): Promise<{ status: string }> {
    await this.loadOwnedRun(runId, userId);

    const submissions = await this.db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.scenarioRunId, runId))
      .orderBy(desc(schema.submissions.createdAt));
    if (submissions.length === 0) {
      throw new BadRequestException('Cannot grade a run with no pull request submission yet.');
    }

    await this.db
      .update(schema.scenarioRuns)
      .set({ status: 'grading' })
      .where(eq(schema.scenarioRuns.id, runId));

    await this.queue.enqueueGrade({ scenarioRunId: runId });
    return { status: 'grading' };
  }

  async getScorecard(runId: string, userId: string) {
    await this.loadOwnedRun(runId, userId);
    const [scorecard] = await this.db
      .select()
      .from(schema.scorecards)
      .where(eq(schema.scorecards.scenarioRunId, runId))
      .orderBy(desc(schema.scorecards.createdAt))
      .limit(1);
    if (!scorecard) throw new NotFoundException('No scorecard yet for this run.');
    return scorecard;
  }

  async gradeRun(scenarioRunId: string): Promise<void> {
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

    const submissions = await this.db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.scenarioRunId, scenarioRunId))
      .orderBy(desc(schema.submissions.createdAt));
    const latest = submissions[0];
    if (!latest) throw new BadRequestException('No submission to grade.');

    const messages = await this.db
      .select()
      .from(schema.agentMessages)
      .where(eq(schema.agentMessages.scenarioRunId, scenarioRunId))
      .orderBy(asc(schema.agentMessages.createdAt));

    const reviews = await this.db
      .select({
        verdict: schema.reviews.verdict,
        comments: schema.reviews.comments,
      })
      .from(schema.reviews)
      .innerJoin(schema.submissions, eq(schema.reviews.submissionId, schema.submissions.id))
      .where(eq(schema.submissions.scenarioRunId, scenarioRunId))
      .orderBy(asc(schema.reviews.createdAt));

    const { owner, repo, prNumber } = this.parsePrUrl(latest.prUrl);
    const rawDiff = await this.github.getPullRequestDiff(owner, repo, prNumber);
    const diff = rawDiff.slice(0, MAX_DIFF_CHARS);

    const system = this.buildSystem(def);
    const user = this.buildUserContext(def, messages, reviews, latest.ciStatus, diff);

    const result = await this.router.generate({
      role: 'grader',
      taskComplexity: 'grade',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const parsed = this.parseScorecard(result.content);

    await this.db.insert(schema.scorecards).values({
      scenarioRunId,
      technicalScore: parsed.technicalScore,
      technicalFeedback: parsed.technicalFeedback,
      professionalScore: parsed.professionalScore,
      professionalFeedback: parsed.professionalFeedback,
      overallFeedback: parsed.overallFeedback,
    });

    await this.db
      .update(schema.scenarioRuns)
      .set({ status: 'complete' })
      .where(eq(schema.scenarioRuns.id, scenarioRunId));
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

  private parsePrUrl(prUrl: string): { owner: string; repo: string; prNumber: number } {
    const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) throw new BadRequestException(`Cannot parse PR URL: ${prUrl}`);
    return { owner: m[1], repo: m[2], prNumber: Number(m[3]) };
  }

  private buildSystem(def: ScenarioDefinition): string {
    const tech = def.rubric.technical.criteria
      .map((c) => `- ${c.id} (weight ${c.weight}): ${c.description}`)
      .join('\n');
    const prof = def.rubric.professional.criteria
      .map((c) => `- ${c.id} (weight ${c.weight}): ${c.description}`)
      .join('\n');
    return [
      'You are the Grader for a software-engineering simulation. You have the ground truth, so your judgments are anchored, not vibes. Your written feedback is specific, actionable, and kind — this is a learning product, never demoralizing.',
      '',
      `Ground-truth solution notes: ${def.ground_truth.solution_notes}`,
      `Red flags to penalize if present: ${def.ground_truth.red_flags.join('; ')}`,
      '',
      `Technical dimension (overall weight ${def.rubric.technical.weight}):`,
      tech,
      `Professional dimension (overall weight ${def.rubric.professional.weight}):`,
      prof,
      '',
      'Score each dimension 0–100. Respond ONLY with JSON, no prose around it, matching exactly:',
      '{"technicalScore": number, "technicalFeedback": string, "professionalScore": number, "professionalFeedback": string, "overallFeedback": string}',
    ].join('\n');
  }

  private buildUserContext(
    def: ScenarioDefinition,
    messages: { agentRole: string; direction: string; content: string }[],
    reviews: { verdict: string; comments: unknown }[],
    ciStatus: string | null,
    diff: string,
  ): string {
    const transcript = messages.length
      ? messages.map((m) => `[${m.agentRole}/${m.direction}] ${m.content}`).join('\n')
      : '(no messages — the engineer never spoke to the PM or Senior)';
    const reviewThread = reviews.length
      ? reviews
          .map((r) => `[senior verdict: ${r.verdict}] ${JSON.stringify(r.comments)}`)
          .join('\n')
      : '(no reviews)';
    return [
      `Ticket ${def.ticket.id}: ${def.ticket.title}`,
      def.ticket.body,
      '',
      `CI status on the final submission: ${ciStatus ?? 'unknown'}`,
      '',
      '--- Conversation transcript ---',
      transcript,
      '',
      '--- Senior review thread ---',
      reviewThread,
      '',
      '--- PR diff ---',
      diff,
    ].join('\n');
  }

  private parseScorecard(content: string): ParsedScorecard {
    const fallback: ParsedScorecard = {
      technicalScore: 0,
      technicalFeedback: '',
      professionalScore: 0,
      professionalFeedback: '',
      overallFeedback: content.trim(),
    };
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1) return fallback;
    try {
      const o = JSON.parse(content.slice(start, end + 1));
      return {
        technicalScore: this.clampScore(o.technicalScore),
        technicalFeedback: String(o.technicalFeedback ?? ''),
        professionalScore: this.clampScore(o.professionalScore),
        professionalFeedback: String(o.professionalFeedback ?? ''),
        overallFeedback: String(o.overallFeedback ?? ''),
      };
    } catch {
      return fallback;
    }
  }

  private clampScore(value: unknown): number {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tryout/api test -- grading.service`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/grading/grading.service.ts apps/api/src/grading/grading.service.spec.ts
git commit -m "feat(grading): add GradingService (Grader + request + read)"
```

---

## Task 4: Processor, controller, module, wiring

The BullMQ worker, the two HTTP endpoints, and the module that binds it all — then import it into `AppModule`.

**Files:**
- Create: `apps/api/src/grading/grade.processor.ts`
- Create: `apps/api/src/grading/grading.controller.ts`
- Create: `apps/api/src/grading/grading.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create the processor**

Create `apps/api/src/grading/grade.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, GradeJobData } from '../queue/queue.constants';
import { GradingService } from './grading.service';

@Processor(QUEUE_NAMES.GRADE)
export class GradeProcessor extends WorkerHost {
  private readonly logger = new Logger(GradeProcessor.name);

  constructor(private readonly grading: GradingService) {
    super();
  }

  async process(job: Job<GradeJobData>): Promise<void> {
    this.logger.log(`Grading run ${job.data.scenarioRunId}`);
    await this.grading.gradeRun(job.data.scenarioRunId);
  }
}
```

- [ ] **Step 2: Create the controller**

Create `apps/api/src/grading/grading.controller.ts`:

```ts
import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { GradingService } from './grading.service';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('scenario-runs/:id')
@UseGuards(JwtAuthGuard)
export class GradingController {
  constructor(private readonly grading: GradingService) {}

  @Post('grade')
  grade(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.grading.requestGrade(id, user.sub);
  }

  @Get('scorecard')
  scorecard(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.grading.getScorecard(id, user.sub);
  }
}
```

- [ ] **Step 3: Create the module**

Create `apps/api/src/grading/grading.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { GitHubModule } from '../github/github.module';
import { QueueModule } from '../queue/queue.module';
import { GradingService } from './grading.service';
import { GradingController } from './grading.controller';
import { GradeProcessor } from './grade.processor';

@Module({
  imports: [AuthModule, LlmModule, GitHubModule, QueueModule],
  controllers: [GradingController],
  providers: [GradingService, GradeProcessor],
  exports: [GradingService],
})
export class GradingModule {}
```

- [ ] **Step 4: Wire into AppModule**

Edit `apps/api/src/app.module.ts` to read:

```ts
import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { ScenarioRunsModule } from './scenario-runs/scenario-runs.module';
import { AgentsModule } from './agents/agents.module';
import { GradingModule } from './grading/grading.module';

@Module({
  imports: [DbModule, AuthModule, ScenarioRunsModule, AgentsModule, GradingModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 5: Build and run all unit tests**

Run: `pnpm --filter @tryout/api build`
Expected: no TS errors.

Run: `pnpm --filter @tryout/api test`
Expected: PASS — 24 (M3) + GradingService 5 = **29 unit tests**.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/grading/grade.processor.ts apps/api/src/grading/grading.controller.ts apps/api/src/grading/grading.module.ts apps/api/src/app.module.ts
git commit -m "feat(grading): add grade processor, endpoints, module wiring"
```

---

## Task 5: E2E — grade a run and read the scorecard

Drives the endpoints against real Postgres with mocked GitHub/queue/LLM. A submission is inserted directly (the queue is mocked, so `poll-pr` never runs), `gradeRun` is invoked directly to stand in for the worker, and the scorecard reads back.

**Files:**
- Create: `apps/api/test/grading.e2e-spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `apps/api/test/grading.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GitHubService } from '../src/github/github.service';
import { QueueService } from '../src/queue/queue.service';
import { LLM_ROUTER } from '../src/llm/llm.module';
import { GradingService } from '../src/grading/grading.service';
import { DRIZZLE } from '../src/db/db.module';
import { schema } from '@tryout/db';

const mockGitHubService = {
  createRepoFromTemplate: jest.fn().mockResolvedValue({
    htmlUrl: 'https://github.com/test-owner/lumi-tasks-m4',
    fullName: 'test-owner/lumi-tasks-m4',
    repoName: 'lumi-tasks-m4',
  }),
  listOpenPullRequests: jest.fn().mockResolvedValue([]),
  getPullRequestDiff: jest.fn().mockResolvedValue('diff --git a/x b/x\n+archive'),
  getCheckRuns: jest.fn().mockResolvedValue([]),
  createPullRequestReview: jest.fn().mockResolvedValue(undefined),
};

const mockQueueService = {
  enqueuePollPr: jest.fn().mockResolvedValue(undefined),
  enqueuePollCi: jest.fn().mockResolvedValue(undefined),
  enqueuePmIntro: jest.fn().mockResolvedValue(undefined),
  enqueueReview: jest.fn().mockResolvedValue(undefined),
  enqueueGrade: jest.fn().mockResolvedValue(undefined),
};

const mockRouter = { generate: jest.fn() };

describe('Grading (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let runId: string;
  let grading: GradingService;
  let db: any;
  const email = `m4-${Date.now()}@example.com`;
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

    grading = app.get(GradingService);
    db = app.get(DRIZZLE);

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

  it('rejects an unauthenticated grade request', async () => {
    await request(app.getHttpServer()).post(`/scenario-runs/${runId}/grade`).expect(401);
  });

  it('refuses to grade a run with no submission', async () => {
    await request(app.getHttpServer())
      .post(`/scenario-runs/${runId}/grade`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);
  });

  it('404s for a scorecard that does not exist yet', async () => {
    await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}/scorecard`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });

  it('grades a run and returns the scorecard', async () => {
    // A PR submission lands (normally via poll-pr, which is mocked here).
    await db.insert(schema.submissions).values({
      scenarioRunId: runId,
      prUrl: 'https://github.com/test-owner/lumi-tasks-m4/pull/1',
      ciStatus: 'success',
    });

    // Request grading: flips status to grading + enqueues (mocked).
    const reqRes = await request(app.getHttpServer())
      .post(`/scenario-runs/${runId}/grade`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    expect(reqRes.body.status).toBe('grading');

    // Run the Grader directly (stands in for the GradeProcessor worker).
    mockRouter.generate.mockResolvedValueOnce({
      content: JSON.stringify({
        technicalScore: 78,
        technicalFeedback: 'Works; missing one edge case.',
        professionalScore: 88,
        professionalFeedback: 'Good clarifying question to the PM.',
        overallFeedback: 'Strong submission overall.',
      }),
    });
    await grading.gradeRun(runId);

    // The scorecard reads back.
    const cardRes = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}/scorecard`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(cardRes.body.technicalScore).toBe(78);
    expect(cardRes.body.professionalScore).toBe(88);
    expect(cardRes.body.overallFeedback).toBe('Strong submission overall.');

    // The run is now complete.
    const runRes = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(runRes.body.status).toBe('complete');
  });
});
```

- [ ] **Step 2: Run the full e2e suite**

Ensure infra is up and the seed is applied. Run:

```bash
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout JWT_SECRET=dev pnpm --filter @tryout/api test:e2e
```

Expected: PASS — auth 7 + scenario-runs 4 + visible-loop 1 + conversations 5 + grading 4 = **21 e2e tests**.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/grading.e2e-spec.ts
git commit -m "test(api): e2e for grading and scorecard"
```

---

## Task 6: Web — grade button + scorecard

The `/run` page gains a "Submit for grading" action (shown once a PR exists) and renders the scorecard when the run completes.

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/components/ScorecardView.tsx`
- Modify: `apps/web/src/app/run/page.tsx`

- [ ] **Step 1: Add API client methods**

Edit `apps/web/src/lib/api.ts`. Add this type after `AgentMessageView`:

```ts
export interface ScorecardView {
  technicalScore: number;
  technicalFeedback: string;
  professionalScore: number;
  professionalFeedback: string;
  overallFeedback: string;
  createdAt: string;
}
```

Add these two methods inside the `api` object, after `sendMessage`:

```ts
  requestGrade: async (runId: string): Promise<{ status: string }> => {
    const res = await fetch(`${API_URL}/scenario-runs/${runId}/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Failed to request grading (${res.status})`);
    return res.json() as Promise<{ status: string }>;
  },

  getScorecard: async (runId: string): Promise<ScorecardView | null> => {
    const res = await fetch(`${API_URL}/scenario-runs/${runId}/scorecard`, {
      headers: { ...authHeaders() },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to load scorecard (${res.status})`);
    return res.json() as Promise<ScorecardView>;
  },
```

- [ ] **Step 2: Create the ScorecardView component**

Create `apps/web/src/components/ScorecardView.tsx`:

```tsx
import type { ScorecardView as Scorecard } from '@/lib/api';

interface ScorecardViewProps {
  scorecard: Scorecard;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md, 12px)',
  padding: 'var(--space-4)',
  display: 'grid',
  gap: 'var(--space-3)',
};

function Dimension({ label, score, feedback }: { label: string; score: number; feedback: string }) {
  const color =
    score >= 80 ? 'var(--color-success, #16794d)' : score >= 50 ? '#b8860b' : 'var(--color-danger, #b42318)';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--text-base, 1rem)' }}>{label}</h3>
        <span style={{ fontWeight: 700, fontSize: 'var(--text-lg, 1.5rem)', color }}>{score}<span style={{ color: 'var(--color-muted)', fontSize: 'var(--text-sm, 0.875rem)' }}>/100</span></span>
      </div>
      <p style={{ margin: 'var(--space-1) 0 0', whiteSpace: 'pre-wrap' }}>{feedback}</p>
    </div>
  );
}

export function ScorecardView({ scorecard }: ScorecardViewProps) {
  return (
    <section style={cardStyle} aria-labelledby="scorecard-heading">
      <h2 id="scorecard-heading" style={{ margin: 0, fontSize: 'var(--text-md, 1.25rem)' }}>Your scorecard</h2>
      <Dimension label="Technical" score={scorecard.technicalScore} feedback={scorecard.technicalFeedback} />
      <Dimension label="Professional" score={scorecard.professionalScore} feedback={scorecard.professionalFeedback} />
      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)' }}>
        <h3 style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--text-base, 1rem)' }}>Overall</h3>
        <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{scorecard.overallFeedback}</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Wire the grade action + scorecard into the run page**

Edit `apps/web/src/app/run/page.tsx`.

Update the imports:

```tsx
import { api, type ScenarioRunView, type AgentMessageView, type ScorecardView as Scorecard } from '@/lib/api';
import { RunView } from '@/components/RunView';
import { ChatPanel } from '@/components/ChatPanel';
import { ScorecardView } from '@/components/ScorecardView';
```

Add scorecard + grading state next to the existing `messages` state:

```tsx
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [grading, setGrading] = useState(false);
```

Replace the `refresh` callback so it also pulls the scorecard:

```tsx
  const refresh = useCallback(async (id: string) => {
    try {
      const [data, msgs, card] = await Promise.all([
        api.getRun(id),
        api.getMessages(id),
        api.getScorecard(id),
      ]);
      setRun(data);
      setMessages(msgs);
      setScorecard(card);
    } catch {
      setError('Could not load your run.');
    }
  }, []);
```

Add a grade handler just before the `return` of the final (run-loaded) branch — i.e. after the `if (!run) { ... }` block:

```tsx
  async function onGrade() {
    if (!run) return;
    setGrading(true);
    setError(null);
    try {
      await api.requestGrade(run.id);
      await refresh(run.id);
    } catch {
      setError('Could not submit for grading. Open a PR first.');
    } finally {
      setGrading(false);
    }
  }
```

Replace the final `return (...)` block (the one rendering `RunView` + chat panels) with:

```tsx
  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-4)' }}>
      <RunView run={run} />

      {scorecard ? (
        <ScorecardView scorecard={scorecard} />
      ) : run.status === 'grading' ? (
        <p style={{ color: 'var(--color-muted)', margin: 0 }}>Grading in progress… (refreshes automatically)</p>
      ) : run.latestSubmission ? (
        <button type="button" onClick={onGrade} disabled={grading}>
          {grading ? 'Submitting…' : 'Submit for grading'}
        </button>
      ) : null}

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

- [ ] **Step 4: Build the web app**

Run: `pnpm --filter @tryout/web build`
Expected: Next.js build succeeds with the `/run` route. (If it fails on a missing `next` binary, run `pnpm install --force` and rebuild — known store flakiness.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/components/ScorecardView.tsx apps/web/src/app/run/page.tsx
git commit -m "feat(web): add grade action and scorecard to the run page"
```

---

## Task 7: Update project docs

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Mark M4 complete**

Edit `docs/STATUS.md`:
- In the milestone table, change the M4 row to `| M4 | Grading | ✅ Complete |`.
- Replace the `## M4 — Grading 🔲` heading with `## M4 — Grading ✅`, and replace its `### Planned` list with a `### Done` list:
  - `GradingService` — single Grader LLM call over transcript + PR diff + CI status + review thread + ground truth + rubric; persists a `Scorecard`
  - `POST /scenario-runs/:id/grade` (async job; refuses with no submission) + `GET /scenario-runs/:id/scorecard`
  - `grade` BullMQ queue + `GradeProcessor`; run status `grading → complete`
  - Scores clamped 0–100; LLM-judged technical correctness from the diff + CI (no sandbox — hidden-suite execution is a deliberate later follow-up)
  - Web `/run` page: "Submit for grading" action + scorecard render
  - Test coverage: API unit 29 (adds GradingService 5), e2e 21 (adds grading 4)
- Update the "Key Metrics" table: Unit tests `32 (llm 3 + api 29)`, E2E tests `21`, API endpoints `9` (adds grade POST + scorecard GET), BullMQ queues `5 (poll-pr, poll-ci, pm-intro, review, grade)`.

- [ ] **Step 2: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: record M4 (grading) completion"
```

---

## M4 Verification Gate

Run before declaring M4 complete. All must pass:

- [ ] `pnpm --filter @tryout/api build` — compiles with no TS errors.
- [ ] `pnpm --filter @tryout/api test` — 29 unit tests pass (M3's 24 + GradingService 5).
- [ ] `pnpm --filter @tryout/api test:e2e` — 21 e2e tests pass (auth 7, scenario-runs 4, visible-loop 1, conversations 5, grading 4), against real Postgres with a mocked LLM router.
- [ ] `pnpm --filter @tryout/web build` — web builds with the `/run` route.
- [ ] **Manual (requires real `ANTHROPIC_API_KEY` + a run that has an open PR):** click "Submit for grading"; within a few seconds the run shows a scorecard with a technical score, a professional score, and an overall note — all specific and tied to what actually happened in the run.

**Out of M4 (do not build here):** executing a hidden acceptance suite on GitHub (the real-test follow-up); retry/next, soft deadline, the optional PM scope-change event (M5); re-grading / score history UI; auto-grading on Senior approval.
