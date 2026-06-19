# Intake Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the project-catalog browse flow with a free-form AI intake conversation (recruiter persona "Sam") that profiles the candidate, then matches them to a prebuilt scenario and hands off to the run.

**Architecture:** New `IntakeModule` in the NestJS API mirrors the existing `AgentChatService` pattern. Intake state lives in a new `candidate_profiles` table (transcript + extracted profile as JSONB) because no `scenario_run` exists yet during intake. A thin `ScenarioMatcher` picks the best-fit available scenario (only Scenario-01 today) and an LLM writes the fit rationale. On placement, the existing `ScenarioRunsService.startRun` is reused unchanged. The web dashboard swaps `CatalogFlow` for an `IntakeChat` component.

**Tech Stack:** NestJS 10, Drizzle ORM, Postgres 16, BullMQ (unchanged), Next.js 14 App Router, class-validator, Jest + supertest.

**Spec:** `docs/superpowers/specs/2026-06-19-intake-agent-design.md`

---

## File Structure

**Create:**
- `apps/api/src/intake/intake.module.ts` — module wiring
- `apps/api/src/intake/intake.service.ts` — conversation engine + profile + placement
- `apps/api/src/intake/intake.controller.ts` — REST endpoints
- `apps/api/src/intake/scenario-matcher.service.ts` — profile → scenario/role/rationale
- `apps/api/src/intake/intake.prompts.ts` — Sam persona + extraction instructions + opening greeting
- `apps/api/src/intake/dto/send-intake-message.dto.ts` — turn DTO
- `apps/api/src/intake/intake.service.spec.ts` — unit tests
- `apps/api/src/intake/scenario-matcher.service.spec.ts` — unit tests
- `apps/api/test/intake.e2e-spec.ts` — round-trip e2e
- `packages/shared/src/intake.ts` — shared intake types
- `apps/web/src/app/dashboard/IntakeChat.tsx` — chat + assignment UI

**Modify:**
- `packages/db/src/schema.ts` — add `candidate_profiles` table
- `packages/llm/src/router.ts` — add `'recruiter'` to `LlmRole`
- `packages/shared/src/index.ts` — export intake types
- `apps/api/src/scenario-runs/scenario-runs.module.ts` — export `ScenarioRunsService`
- `apps/api/src/agents/pm.service.ts` — inject recruiter notes into PM intro
- `apps/api/src/app.module.ts` — register `IntakeModule`
- `apps/web/src/lib/api.ts` — add intake methods; remove catalog client calls
- `apps/web/src/app/dashboard/page.tsx` — render `IntakeChat` instead of `CatalogFlow`

**Delete:**
- `apps/web/src/app/dashboard/CatalogFlow.tsx`
- `apps/web/src/app/dashboard/ProjectCatalog.tsx`
- `apps/web/src/app/dashboard/RolePicker.tsx`
- `apps/web/src/app/dashboard/TeamFormation.tsx`

---

## Task 1: Database — `candidate_profiles` table + migration

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create (generated): `packages/db/migrations/XXXX_*.sql`

- [ ] **Step 1: Add the table to the schema**

Append to `packages/db/src/schema.ts` (after the `scorecards` table, before the `User` type exports):

```typescript
// One row per intake session. Lives outside scenario_runs because intake
// happens BEFORE a run exists. transcript + profile are LLM-maintained.
export const candidateProfiles = pgTable('candidate_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  // Set once the candidate is placed into a run.
  scenarioRunId: uuid('scenario_run_id').references(() => scenarioRuns.id),
  experienceLevel: text('experience_level'),
  languages: jsonb('languages').notNull().default([]),
  strengths: jsonb('strengths').notNull().default([]),
  gaps: jsonb('gaps').notNull().default([]),
  goals: text('goals'),
  confidence: integer('confidence').notNull().default(0),
  // Array of { role: 'recruiter' | 'candidate', content: string }.
  transcript: jsonb('transcript').notNull().default([]),
  matchedScenarioId: uuid('matched_scenario_id').references(() => scenarios.id),
  matchedRole: text('matched_role'),
  matchRationale: text('match_rationale'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @tryout/db generate`
Expected: a new file `packages/db/migrations/XXXX_*.sql` containing `CREATE TABLE "candidate_profiles"`. Do NOT apply it yet (applied in Task 12 with infra checks).

- [ ] **Step 3: Build the db package to surface the new export**

Run: `pnpm --filter @tryout/db build`
Expected: exits 0; `candidateProfiles` is now part of `schema`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations
git commit -m "feat(db): candidate_profiles table for intake sessions"
```

---

## Task 2: Shared intake types

**Files:**
- Create: `packages/shared/src/intake.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the types**

Create `packages/shared/src/intake.ts`:

```typescript
export type IntakeSpeaker = 'recruiter' | 'candidate';

export interface IntakeMessage {
  role: IntakeSpeaker;
  content: string;
}

export interface ProfileSnapshot {
  experienceLevel: string | null;
  languages: string[];
  strengths: string[];
  gaps: string[];
  goals: string | null;
  confidence: number;
}

export interface IntakeSessionView {
  id: string;
  transcript: IntakeMessage[];
  profile: ProfileSnapshot;
  readyToPlace: boolean;
}

export interface IntakeTurnResult {
  reply: string;
  transcript: IntakeMessage[];
  profile: ProfileSnapshot;
  readyToPlace: boolean;
}

export interface IntakePlacementResult {
  runId: string;
  scenarioId: string;
  role: string;
  rationale: string;
}
```

- [ ] **Step 2: Export from the package index**

Add to `packages/shared/src/index.ts` (alongside the other `export *` lines):

```typescript
export * from './intake';
```

- [ ] **Step 3: Build the shared package**

Run: `pnpm --filter @tryout/shared build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/intake.ts packages/shared/src/index.ts
git commit -m "feat(shared): intake session + profile types"
```

---

## Task 3: LLM role + Sam prompts

**Files:**
- Modify: `packages/llm/src/router.ts:1`
- Create: `apps/api/src/intake/intake.prompts.ts`

- [ ] **Step 1: Add the recruiter role to the LLM union**

In `packages/llm/src/router.ts`, change line 1:

```typescript
export type LlmRole = 'pm' | 'senior' | 'grader' | 'recruiter';
```

(The router maps by `taskComplexity`, not `role`, so no other change is needed.)

- [ ] **Step 2: Build the llm package**

Run: `pnpm --filter @tryout/llm build`
Expected: exits 0.

- [ ] **Step 3: Write the prompts module**

Create `apps/api/src/intake/intake.prompts.ts`:

```typescript
export const OPENING_GREETING =
  "Hi — I'm Sam, talent lead here. Before I place you on a team, I want to get a quick read on you. " +
  "Tell me a bit about your background: what have you built, what languages or stacks do you reach for, " +
  "and where do you feel strongest?";

// Sam answers each turn as STRICT JSON so we can extract a profile while replying.
export const SAM_SYSTEM = [
  "You are Sam, a warm, sharp talent lead at a software company. You are interviewing a junior",
  "engineer to understand their experience, strengths, gaps, and goals before placing them on a team.",
  "Ask one focused follow-up at a time. Be encouraging but get real signal. Do NOT assign a project",
  "yourself — placement happens after this chat.",
  "",
  "Respond with STRICT JSON only (no prose, no markdown fences), shaped exactly:",
  '{ "reply": string, "profile": { "experienceLevel": string|null, "languages": string[],',
  '  "strengths": string[], "gaps": string[], "goals": string|null, "confidence": number } }',
  "",
  "`reply` is your next message to the candidate. `profile` is your CURRENT best read of them across",
  "the whole conversation (cumulative, not just this turn). `confidence` is 0-100: how confident you",
  "are that you know enough to place them. Raise it as the picture gets clearer.",
].join('\n');

export const RATIONALE_SYSTEM = [
  "You are Sam, a talent lead. In 2-3 sentences, tell the candidate why the assigned project fits them.",
  "Reference their strengths and growth areas specifically. Warm, direct, second person. Plain text only.",
].join('\n');
```

- [ ] **Step 4: Commit**

```bash
git add packages/llm/src/router.ts apps/api/src/intake/intake.prompts.ts
git commit -m "feat(intake): recruiter LLM role + Sam prompts"
```

---

## Task 4: ScenarioMatcher service

**Files:**
- Create: `apps/api/src/intake/scenario-matcher.service.ts`
- Test: `apps/api/src/intake/scenario-matcher.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/intake/scenario-matcher.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ScenarioMatcherService } from './scenario-matcher.service';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn(),
};
const mockRouter = { generate: jest.fn() };

const profile = {
  experienceLevel: 'junior',
  languages: ['typescript'],
  strengths: ['api design'],
  gaps: ['testing'],
  goals: 'get hired',
  confidence: 80,
};

describe('ScenarioMatcherService', () => {
  let service: ScenarioMatcherService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ScenarioMatcherService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: LLM_ROUTER, useValue: mockRouter },
      ],
    }).compile();
    service = moduleRef.get(ScenarioMatcherService);
  });

  it('returns the available scenario, a selectable role, and an LLM rationale', async () => {
    // 1) available scenario lookup
    mockDb.limit.mockResolvedValueOnce([
      { id: 'scn-1', definition: { title: 'Archive', team: ['backend_engineer', 'pm_mai'] } },
    ]);
    // 2) team roles lookup
    mockDb.orderBy.mockResolvedValueOnce([
      { key: 'pm_mai', selectableByCandidate: false },
      { key: 'backend_engineer', selectableByCandidate: true },
    ]);
    mockRouter.generate.mockResolvedValue({ content: 'This backend ticket stretches your testing.' });

    const result = await service.match(profile);

    expect(result.scenarioId).toBe('scn-1');
    expect(result.role).toBe('backend_engineer');
    expect(result.rationale).toContain('testing');
    expect(mockRouter.generate.mock.calls[0][0].role).toBe('recruiter');
  });

  it('throws when no scenario is available', async () => {
    mockDb.limit.mockResolvedValueOnce([]);
    await expect(service.match(profile)).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tryout/api test -- scenario-matcher`
Expected: FAIL — cannot find module `./scenario-matcher.service`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/intake/scenario-matcher.service.ts`:

```typescript
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { ProfileSnapshot } from '@tryout/shared';
import type { ScenarioDefinition } from '@tryout/shared';
import type { LlmRouter } from '@tryout/llm';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { RATIONALE_SYSTEM } from './intake.prompts';

export interface MatchResult {
  scenarioId: string;
  role: string;
  rationale: string;
}

@Injectable()
export class ScenarioMatcherService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_ROUTER) private readonly router: LlmRouter,
  ) {}

  async match(profile: ProfileSnapshot): Promise<MatchResult> {
    const [scenario] = await this.db
      .select({ id: schema.scenarios.id, definition: schema.scenarios.definition })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.available, true))
      .limit(1);
    if (!scenario) {
      throw new BadRequestException('No scenarios are available to place you in yet.');
    }

    const def = scenario.definition as ScenarioDefinition;
    const teamKeys = def.team ?? [];
    const roles = await this.db
      .select()
      .from(schema.teamRoles)
      .orderBy(asc(schema.teamRoles.sortOrder));
    const selectable = new Set(
      roles.filter((r) => r.selectableByCandidate).map((r) => r.key),
    );
    const role = teamKeys.find((k) => selectable.has(k));
    if (!role) {
      throw new BadRequestException('Available scenario has no candidate-selectable role.');
    }

    const rationale = await this.writeRationale(profile, def.title);
    return { scenarioId: scenario.id, role, rationale };
  }

  private async writeRationale(profile: ProfileSnapshot, scenarioTitle: string): Promise<string> {
    const summary = [
      `Project: ${scenarioTitle}`,
      `Experience: ${profile.experienceLevel ?? 'unknown'}`,
      `Languages: ${profile.languages.join(', ') || 'unknown'}`,
      `Strengths: ${profile.strengths.join(', ') || 'unknown'}`,
      `Growth areas: ${profile.gaps.join(', ') || 'unknown'}`,
      `Goals: ${profile.goals ?? 'unknown'}`,
    ].join('\n');

    const result = await this.router.generate({
      role: 'recruiter',
      taskComplexity: 'chat',
      messages: [
        { role: 'system', content: RATIONALE_SYSTEM },
        { role: 'user', content: summary },
      ],
    });
    return result.content;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tryout/api test -- scenario-matcher`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/intake/scenario-matcher.service.ts apps/api/src/intake/scenario-matcher.service.spec.ts
git commit -m "feat(intake): ScenarioMatcher picks scenario, role, and writes fit rationale"
```

---

## Task 5: IntakeService — start/resume + ownership

**Files:**
- Create: `apps/api/src/intake/intake.service.ts`
- Test: `apps/api/src/intake/intake.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/intake/intake.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { ScenarioMatcherService } from './scenario-matcher.service';
import { ScenarioRunsService } from '../scenario-runs/scenario-runs.service';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { OPENING_GREETING } from './intake.prompts';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
};
const mockRouter = { generate: jest.fn() };
const mockMatcher = { match: jest.fn() };
const mockRuns = { startRun: jest.fn() };

function build(): Promise<IntakeService> {
  return Test.createTestingModule({
    providers: [
      IntakeService,
      { provide: DRIZZLE, useValue: mockDb },
      { provide: LLM_ROUTER, useValue: mockRouter },
      { provide: ScenarioMatcherService, useValue: mockMatcher },
      { provide: ScenarioRunsService, useValue: mockRuns },
    ],
  })
    .compile()
    .then((m) => m.get(IntakeService));
}

describe('IntakeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.values.mockReturnThis();
    mockDb.where.mockReturnThis();
  });

  it('creates a new session with the opening greeting when none is active', async () => {
    mockDb.limit.mockResolvedValueOnce([]); // no active profile
    mockDb.returning.mockResolvedValueOnce([
      { id: 'cp-1', transcript: [{ role: 'recruiter', content: OPENING_GREETING }], confidence: 0 },
    ]);

    const service = await build();
    const session = await service.startOrResume('user-1');

    expect(session.id).toBe('cp-1');
    expect(session.transcript[0]).toEqual({ role: 'recruiter', content: OPENING_GREETING });
    expect(session.readyToPlace).toBe(false);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('resumes the existing active session instead of creating one', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'cp-1',
        transcript: [{ role: 'recruiter', content: 'hi' }, { role: 'candidate', content: 'hey' }],
        experienceLevel: 'junior',
        languages: ['ts'],
        strengths: [],
        gaps: [],
        goals: null,
        confidence: 20,
        scenarioRunId: null,
      },
    ]);

    const service = await build();
    const session = await service.startOrResume('user-1');

    expect(session.id).toBe('cp-1');
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(session.profile.confidence).toBe(20);
  });

  it('throws NotFound loading a session that belongs to another user', async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: 'cp-1', userId: 'someone-else' }]);
    const service = await build();
    await expect(service.getSession('cp-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tryout/api test -- intake.service`
Expected: FAIL — cannot find module `./intake.service`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/intake/intake.service.ts`:

```typescript
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, isNull, desc } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type {
  IntakeMessage,
  IntakePlacementResult,
  IntakeSessionView,
  IntakeTurnResult,
  ProfileSnapshot,
} from '@tryout/shared';
import type { LlmRouter } from '@tryout/llm';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { ScenarioMatcherService } from './scenario-matcher.service';
import { ScenarioRunsService } from '../scenario-runs/scenario-runs.service';
import { OPENING_GREETING, SAM_SYSTEM } from './intake.prompts';

const READY_CONFIDENCE = 70;
const TURN_CAP = 12;

type ProfileRow = typeof schema.candidateProfiles.$inferSelect;

@Injectable()
export class IntakeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_ROUTER) private readonly router: LlmRouter,
    private readonly matcher: ScenarioMatcherService,
    private readonly runs: ScenarioRunsService,
  ) {}

  async startOrResume(userId: string): Promise<IntakeSessionView> {
    const [active] = await this.db
      .select()
      .from(schema.candidateProfiles)
      .where(
        and(
          eq(schema.candidateProfiles.userId, userId),
          isNull(schema.candidateProfiles.scenarioRunId),
        ),
      )
      .orderBy(desc(schema.candidateProfiles.createdAt))
      .limit(1);

    if (active) return this.toView(active as ProfileRow);

    const [created] = await this.db
      .insert(schema.candidateProfiles)
      .values({
        userId,
        transcript: [{ role: 'recruiter', content: OPENING_GREETING }],
      })
      .returning();
    return this.toView(created as ProfileRow);
  }

  async getSession(id: string, userId: string): Promise<IntakeSessionView> {
    const row = await this.loadOwned(id, userId);
    return this.toView(row);
  }

  async sendTurn(id: string, userId: string, content: string): Promise<IntakeTurnResult> {
    const row = await this.loadOwned(id, userId);
    if (row.scenarioRunId) {
      throw new BadRequestException('This intake is already complete.');
    }

    const transcript: IntakeMessage[] = [
      ...(row.transcript as IntakeMessage[]),
      { role: 'candidate', content },
    ];

    const { reply, profile } = await this.askSam(transcript, this.toProfile(row));
    transcript.push({ role: 'recruiter', content: reply });

    const candidateTurns = transcript.filter((m) => m.role === 'candidate').length;
    const readyToPlace = profile.confidence >= READY_CONFIDENCE || candidateTurns >= TURN_CAP;

    await this.db
      .update(schema.candidateProfiles)
      .set({
        transcript,
        experienceLevel: profile.experienceLevel,
        languages: profile.languages,
        strengths: profile.strengths,
        gaps: profile.gaps,
        goals: profile.goals,
        confidence: profile.confidence,
      })
      .where(eq(schema.candidateProfiles.id, id));

    return { reply, transcript, profile, readyToPlace };
  }

  async place(id: string, userId: string): Promise<IntakePlacementResult> {
    const row = await this.loadOwned(id, userId);
    if (row.scenarioRunId) {
      throw new BadRequestException('This intake is already complete.');
    }

    const match = await this.matcher.match(this.toProfile(row));
    const run = await this.runs.startRun(userId, {
      scenarioId: match.scenarioId,
      role: match.role,
    });

    await this.db
      .update(schema.candidateProfiles)
      .set({
        scenarioRunId: run.id,
        matchedScenarioId: match.scenarioId,
        matchedRole: match.role,
        matchRationale: match.rationale,
      })
      .where(eq(schema.candidateProfiles.id, id));

    return { runId: run.id, scenarioId: match.scenarioId, role: match.role, rationale: match.rationale };
  }

  private async loadOwned(id: string, userId: string): Promise<ProfileRow> {
    const [row] = await this.db
      .select()
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.id, id))
      .limit(1);
    if (!row || row.userId !== userId) {
      throw new NotFoundException(`Intake session ${id} not found.`);
    }
    return row as ProfileRow;
  }

  /** One LLM call: Sam replies AND returns a cumulative profile read, as strict JSON. */
  private async askSam(
    transcript: IntakeMessage[],
    current: ProfileSnapshot,
  ): Promise<{ reply: string; profile: ProfileSnapshot }> {
    const messages = [
      { role: 'system' as const, content: SAM_SYSTEM },
      ...transcript.map((m) => ({
        role: (m.role === 'candidate' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const result = await this.router.generate({
      role: 'recruiter',
      taskComplexity: 'chat',
      messages,
    });

    return this.parseSam(result.content, current);
  }

  /** Tolerant parse: fall back to raw text as the reply and keep the prior profile. */
  private parseSam(raw: string, current: ProfileSnapshot): { reply: string; profile: ProfileSnapshot } {
    try {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
      const parsed = JSON.parse(json) as {
        reply?: string;
        profile?: Partial<ProfileSnapshot>;
      };
      return {
        reply: typeof parsed.reply === 'string' ? parsed.reply : raw,
        profile: this.mergeProfile(current, parsed.profile ?? {}),
      };
    } catch {
      return { reply: raw, profile: current };
    }
  }

  private mergeProfile(current: ProfileSnapshot, patch: Partial<ProfileSnapshot>): ProfileSnapshot {
    return {
      experienceLevel:
        typeof patch.experienceLevel === 'string' ? patch.experienceLevel : current.experienceLevel,
      languages: Array.isArray(patch.languages) ? patch.languages : current.languages,
      strengths: Array.isArray(patch.strengths) ? patch.strengths : current.strengths,
      gaps: Array.isArray(patch.gaps) ? patch.gaps : current.gaps,
      goals: typeof patch.goals === 'string' ? patch.goals : current.goals,
      confidence:
        typeof patch.confidence === 'number'
          ? Math.max(0, Math.min(100, patch.confidence))
          : current.confidence,
    };
  }

  private toProfile(row: ProfileRow): ProfileSnapshot {
    return {
      experienceLevel: row.experienceLevel ?? null,
      languages: (row.languages as string[]) ?? [],
      strengths: (row.strengths as string[]) ?? [],
      gaps: (row.gaps as string[]) ?? [],
      goals: row.goals ?? null,
      confidence: row.confidence ?? 0,
    };
  }

  private toView(row: ProfileRow): IntakeSessionView {
    const profile = this.toProfile(row);
    const transcript = (row.transcript as IntakeMessage[]) ?? [];
    const candidateTurns = transcript.filter((m) => m.role === 'candidate').length;
    return {
      id: row.id,
      transcript,
      profile,
      readyToPlace: profile.confidence >= READY_CONFIDENCE || candidateTurns >= TURN_CAP,
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tryout/api test -- intake.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/intake/intake.service.ts apps/api/src/intake/intake.service.spec.ts
git commit -m "feat(intake): IntakeService start/resume + ownership"
```

---

## Task 6: IntakeService — turn handling + placement tests

**Files:**
- Modify: `apps/api/src/intake/intake.service.spec.ts`

- [ ] **Step 1: Add failing tests for sendTurn + place**

Append these tests inside the `describe('IntakeService', ...)` block in `apps/api/src/intake/intake.service.spec.ts`:

```typescript
  it('parses Sam JSON, merges the profile, and flips readyToPlace on high confidence', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'cp-1',
        userId: 'user-1',
        transcript: [{ role: 'recruiter', content: 'hi' }],
        experienceLevel: null,
        languages: [],
        strengths: [],
        gaps: [],
        goals: null,
        confidence: 10,
        scenarioRunId: null,
      },
    ]);
    mockRouter.generate.mockResolvedValueOnce({
      content:
        '{"reply":"Great, sounds like you know APIs well.","profile":{"experienceLevel":"junior","languages":["typescript"],"strengths":["api design"],"gaps":["testing"],"goals":"get hired","confidence":85}}',
    });

    const service = await build();
    const result = await service.sendTurn('cp-1', 'user-1', 'I built a few REST APIs in Nest.');

    expect(result.reply).toContain('APIs');
    expect(result.profile.strengths).toEqual(['api design']);
    expect(result.profile.confidence).toBe(85);
    expect(result.readyToPlace).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('falls back to raw text and keeps the prior profile when Sam output is not JSON', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'cp-1',
        userId: 'user-1',
        transcript: [{ role: 'recruiter', content: 'hi' }],
        experienceLevel: 'mid',
        languages: ['go'],
        strengths: ['concurrency'],
        gaps: [],
        goals: null,
        confidence: 30,
        scenarioRunId: null,
      },
    ]);
    mockRouter.generate.mockResolvedValueOnce({ content: 'Tell me more about that.' });

    const service = await build();
    const result = await service.sendTurn('cp-1', 'user-1', 'I worked on a scheduler.');

    expect(result.reply).toBe('Tell me more about that.');
    expect(result.profile.experienceLevel).toBe('mid');
    expect(result.profile.languages).toEqual(['go']);
    expect(result.readyToPlace).toBe(false);
  });

  it('places the candidate: matches, starts a run, and links the profile', async () => {
    mockDb.limit.mockResolvedValueOnce([
      { id: 'cp-1', userId: 'user-1', languages: [], strengths: [], gaps: [], confidence: 80, scenarioRunId: null },
    ]);
    mockMatcher.match.mockResolvedValueOnce({
      scenarioId: 'scn-1',
      role: 'backend_engineer',
      rationale: 'Fits your API strength.',
    });
    mockRuns.startRun.mockResolvedValueOnce({ id: 'run-1', repoUrl: 'u', status: 'onboarding' });

    const service = await build();
    const result = await service.place('cp-1', 'user-1');

    expect(mockRuns.startRun).toHaveBeenCalledWith('user-1', {
      scenarioId: 'scn-1',
      role: 'backend_engineer',
    });
    expect(result.runId).toBe('run-1');
    expect(result.rationale).toContain('API');
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioRunId: 'run-1', matchedRole: 'backend_engineer' }),
    );
  });
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `pnpm --filter @tryout/api test -- intake.service`
Expected: PASS (6 tests total). The implementation from Task 5 already covers these paths.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/intake/intake.service.spec.ts
git commit -m "test(intake): cover turn parsing, fallback, and placement"
```

---

## Task 7: Controller, DTO, module wiring

**Files:**
- Create: `apps/api/src/intake/dto/send-intake-message.dto.ts`
- Create: `apps/api/src/intake/intake.controller.ts`
- Create: `apps/api/src/intake/intake.module.ts`
- Modify: `apps/api/src/scenario-runs/scenario-runs.module.ts:14`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the DTO**

Create `apps/api/src/intake/dto/send-intake-message.dto.ts`:

```typescript
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SendIntakeMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content: string;
}
```

- [ ] **Step 2: Write the controller**

Create `apps/api/src/intake/intake.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { SendIntakeMessageDto } from './dto/send-intake-message.dto';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('intake')
@UseGuards(JwtAuthGuard)
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post()
  start(@CurrentUser() user: AuthUser) {
    return this.intake.startOrResume(user.sub);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.intake.getSession(id, user.sub);
  }

  @Post(':id/messages')
  send(
    @Param('id') id: string,
    @Body() dto: SendIntakeMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.intake.sendTurn(id, user.sub, dto.content);
  }

  @Post(':id/place')
  place(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.intake.place(id, user.sub);
  }
}
```

- [ ] **Step 3: Export `ScenarioRunsService` so intake can reuse it**

In `apps/api/src/scenario-runs/scenario-runs.module.ts`, add an `exports` line to the `@Module({...})`:

```typescript
@Module({
  imports: [AuthModule, GitHubModule, QueueModule],
  controllers: [ScenarioRunsController],
  providers: [ScenarioRunsService, PollPrProcessor, PollCiProcessor],
  exports: [ScenarioRunsService],
})
export class ScenarioRunsModule {}
```

- [ ] **Step 4: Write the module**

Create `apps/api/src/intake/intake.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { ScenarioRunsModule } from '../scenario-runs/scenario-runs.module';
import { IntakeController } from './intake.controller';
import { IntakeService } from './intake.service';
import { ScenarioMatcherService } from './scenario-matcher.service';

@Module({
  imports: [AuthModule, LlmModule, ScenarioRunsModule],
  controllers: [IntakeController],
  providers: [IntakeService, ScenarioMatcherService],
})
export class IntakeModule {}
```

- [ ] **Step 5: Register the module in AppModule**

In `apps/api/src/app.module.ts`, add the import and include `IntakeModule` in the module's `imports` array (mirror how `AgentsModule` is registered):

```typescript
import { IntakeModule } from './intake/intake.module';
```

Add `IntakeModule` to the `imports: [...]` list.

- [ ] **Step 6: Verify the API compiles and all unit tests still pass**

Run: `pnpm --filter @tryout/api test`
Expected: PASS — existing 29 + new intake tests (8). No compile errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/intake apps/api/src/scenario-runs/scenario-runs.module.ts apps/api/src/app.module.ts
git commit -m "feat(intake): controller, DTO, module wiring; export ScenarioRunsService"
```

---

## Task 8: PM intro reflects the recruiter's notes

**Files:**
- Modify: `apps/api/src/agents/pm.service.ts`
- Test: `apps/api/src/agents/pm.service.spec.ts`

- [ ] **Step 1: Add a failing test**

Append this test inside the `describe` block of `apps/api/src/agents/pm.service.spec.ts` (match the existing mock-db style in that file; the run + scenario lookups are followed by a candidate-profile lookup):

```typescript
  it('includes the recruiter notes in the PM system prompt when a profile exists', async () => {
    // run lookup, scenario lookup, then candidate-profile lookup
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }])
      .mockResolvedValueOnce([{ strengths: ['api design'], gaps: ['testing'], goals: 'get hired' }]);
    mockRouter.generate.mockResolvedValue({ content: 'Welcome aboard!' });
    mockDb.returning.mockResolvedValue([{ id: 'm', agentRole: 'pm', direction: 'agent', content: 'Welcome aboard!' }]);

    await service.generateIntro('run-1');

    const system = mockRouter.generate.mock.calls[0][0].messages[0].content;
    expect(system).toContain('testing');
    expect(system).toContain('get hired');
  });
```

> If `scenarioDefinition` / the mock-db object are named differently in the existing spec, reuse whatever that file already defines — do not redeclare them.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @tryout/api test -- pm.service`
Expected: FAIL — the system prompt does not contain `testing`.

- [ ] **Step 3: Inject the notes**

In `apps/api/src/agents/pm.service.ts`, after the scenario lookup (the block that throws `'Scenario not found.'`) and before building `system`, add a profile lookup:

```typescript
    const [profile] = await this.db
      .select({
        strengths: schema.candidateProfiles.strengths,
        gaps: schema.candidateProfiles.gaps,
        goals: schema.candidateProfiles.goals,
      })
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.scenarioRunId, scenarioRunId))
      .limit(1);

    const recruiterNotes = profile
      ? [
          '',
          "Sam (talent lead) shared notes on this engineer — reflect them subtly in your welcome, do not quote them verbatim:",
          `- Strengths: ${((profile.strengths as string[]) ?? []).join(', ') || 'unknown'}`,
          `- Growth areas: ${((profile.gaps as string[]) ?? []).join(', ') || 'unknown'}`,
          `- Goals: ${profile.goals ?? 'unknown'}`,
        ].join('\n')
      : '';
```

Then change the `system` array's final element to append `recruiterNotes`. The existing array ends with `def.ticket.body`; add `recruiterNotes` as the last entry:

```typescript
    const system = [
      def.agent_prompts.pm_mai.system,
      '',
      `Company: ${c.name}. ${c.product}`,
      `Team: ${c.team}`,
      `The engineer's role: ${c.user_role}`,
      '',
      `Ticket ${def.ticket.id}: ${def.ticket.title}`,
      def.ticket.body,
      recruiterNotes,
    ].join('\n');
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @tryout/api test -- pm.service`
Expected: PASS — including the new test and the existing PM test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/pm.service.ts apps/api/src/agents/pm.service.spec.ts
git commit -m "feat(intake): PM welcome reflects recruiter profile notes"
```

---

## Task 9: API e2e — intake round-trip

**Files:**
- Create: `apps/api/test/intake.e2e-spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `apps/api/test/intake.e2e-spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GitHubService } from '../src/github/github.service';
import { QueueService } from '../src/queue/queue.service';
import { LLM_ROUTER } from '../src/llm/llm.module';

const mockGitHubService = {
  createRepoFromTemplate: jest.fn().mockResolvedValue({
    htmlUrl: 'https://github.com/test-owner/lumi-tasks-intake',
    fullName: 'test-owner/lumi-tasks-intake',
    repoName: 'lumi-tasks-intake',
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

// Sam returns high-confidence JSON on a turn; plain text for the match rationale.
const mockRouter = {
  generate: jest.fn().mockResolvedValue({
    content:
      '{"reply":"Got it — you clearly know your way around APIs.","profile":{"experienceLevel":"junior","languages":["typescript"],"strengths":["api design"],"gaps":["testing"],"goals":"get hired","confidence":90}}',
  }),
};

describe('Intake (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let intakeId: string;
  const email = `intake-${Date.now()}@example.com`;
  const password = 'sup3r-secret-pw';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated intake start', async () => {
    await request(app.getHttpServer()).post('/intake').expect(401);
  });

  it('starts an intake session with Sam opening greeting', async () => {
    const res = await request(app.getHttpServer())
      .post('/intake')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.transcript[0].role).toBe('recruiter');
    expect(res.body.readyToPlace).toBe(false);
    intakeId = res.body.id;
  });

  it('processes a turn, extracts a profile, and signals readyToPlace', async () => {
    const res = await request(app.getHttpServer())
      .post(`/intake/${intakeId}/messages`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ content: 'I built a few REST APIs in NestJS.' })
      .expect(201);
    expect(res.body.profile.strengths).toContain('api design');
    expect(res.body.readyToPlace).toBe(true);
  });

  it('places the candidate into a real run', async () => {
    // Next generate() call is the match rationale (plain text).
    mockRouter.generate.mockResolvedValueOnce({
      content: 'This backend ticket is a great fit — it plays to your API strength and stretches testing.',
    });
    const res = await request(app.getHttpServer())
      .post(`/intake/${intakeId}/place`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    expect(res.body.runId).toBeDefined();
    expect(res.body.role).toBeDefined();
    expect(res.body.rationale).toContain('testing');
    expect(mockGitHubService.createRepoFromTemplate).toHaveBeenCalled();
  });

  it('refuses a second placement on a completed intake', async () => {
    await request(app.getHttpServer())
      .post(`/intake/${intakeId}/place`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);
  });
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout JWT_SECRET=dev pnpm --filter @tryout/api test:e2e -- intake`
Expected: PASS (5 tests). Requires Postgres up and the Task 12 migration applied — if it fails with a missing-table error, apply the migration first (Task 12, Step 1).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/intake.e2e-spec.ts
git commit -m "test(intake): e2e round-trip start → turn → place"
```

---

## Task 10: Web API client — intake methods

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Add intake types + methods, remove catalog client calls**

In `apps/web/src/lib/api.ts`:

1. Update the type import block to drop the catalog-only types and add intake types:

```typescript
import type {
  AuthResponse,
  ScenarioCompanyContext,
  ScenarioTicket,
  TeamSeatView,
  IntakeSessionView,
  IntakeTurnResult,
  IntakePlacementResult,
} from '@tryout/shared';
```

2. Delete the `getScenarios` and `getScenario` methods from the `api` object (the catalog browse is gone).

3. Add these methods to the `api` object (keep `startRun`, `getRun`, `getMessages`, `sendMessage`, `requestGrade`, `getScorecard` as they are):

```typescript
  startIntake: async (): Promise<IntakeSessionView> => {
    const res = await fetch(`${API_URL}/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Failed to start intake (${res.status})`);
    return res.json() as Promise<IntakeSessionView>;
  },

  getIntake: async (id: string): Promise<IntakeSessionView> => {
    const res = await fetch(`${API_URL}/intake/${id}`, { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error(`Failed to load intake (${res.status})`);
    return res.json() as Promise<IntakeSessionView>;
  },

  sendIntakeMessage: async (id: string, content: string): Promise<IntakeTurnResult> => {
    const res = await fetch(`${API_URL}/intake/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(`Failed to send message (${res.status})`);
    return res.json() as Promise<IntakeTurnResult>;
  },

  placeIntake: async (id: string): Promise<IntakePlacementResult> => {
    const res = await fetch(`${API_URL}/intake/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || `Failed to place (${res.status})`);
    }
    return res.json() as Promise<IntakePlacementResult>;
  },
```

- [ ] **Step 2: Type-check the web package**

Run: `pnpm --filter @tryout/web exec tsc --noEmit`
Expected: errors ONLY in files that still import the removed `getScenarios`/`getScenario` (fixed in Task 11). If any other file errors, fix the import there.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): intake API client methods; drop catalog browse calls"
```

---

## Task 11: Web — IntakeChat + dashboard swap

**Files:**
- Create: `apps/web/src/app/dashboard/IntakeChat.tsx`
- Modify: `apps/web/src/app/dashboard/page.tsx`
- Delete: `CatalogFlow.tsx`, `ProjectCatalog.tsx`, `RolePicker.tsx`, `TeamFormation.tsx`

- [ ] **Step 1: Write the IntakeChat component**

Create `apps/web/src/app/dashboard/IntakeChat.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { IntakeMessage } from '@tryout/shared';
import { api } from '@/lib/api';
import styles from './dashboard.module.css';

const RUN_ID_KEY = 'tryout_run_id';
const INTAKE_ID_KEY = 'tryout_intake_id';

export function IntakeChat({ onPlaced }: { onPlaced: () => void }) {
  const router = useRouter();
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [messages, setMessages] = useState<IntakeMessage[]>([]);
  const [readyToPlace, setReadyToPlace] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    const stored = window.localStorage.getItem(INTAKE_ID_KEY);
    const load = stored ? api.getIntake(stored) : api.startIntake();
    load
      .then((session) => {
        if (!active) return;
        window.localStorage.setItem(INTAKE_ID_KEY, session.id);
        setIntakeId(session.id);
        setMessages(session.transcript);
        setReadyToPlace(session.readyToPlace);
      })
      .catch(() => active && setError('Could not start onboarding. Please refresh.'));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const content = draft.trim();
    if (!content || !intakeId || busy) return;
    setBusy(true);
    setError(null);
    setMessages((prev) => [...prev, { role: 'candidate', content }]);
    setDraft('');
    try {
      const result = await api.sendIntakeMessage(intakeId, content);
      setMessages(result.transcript);
      setReadyToPlace(result.readyToPlace);
    } catch {
      setError('Message failed to send. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function place() {
    if (!intakeId || placing) return;
    setPlacing(true);
    setError(null);
    try {
      const result = await api.placeIntake(intakeId);
      window.localStorage.setItem(RUN_ID_KEY, result.runId);
      window.localStorage.removeItem(INTAKE_ID_KEY);
      onPlaced();
      router.push('/run');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not place you. Try again.');
      setPlacing(false);
    }
  }

  return (
    <section className={styles.intake} aria-label="Onboarding chat with Sam">
      <div className={styles.intakeThread}>
        {messages.map((m, i) => (
          <div
            key={i}
            className={`${styles.intakeBubble} ${
              m.role === 'recruiter' ? styles.intakeFromSam : styles.intakeFromYou
            }`}
          >
            {m.role === 'recruiter' && <span className={styles.intakeWho}>Sam · Talent Lead</span>}
            <p>{m.content}</p>
          </div>
        ))}
        {busy && <p className={styles.intakeTyping}>Sam is typing…</p>}
        <div ref={endRef} />
      </div>

      {error && <p className={styles.alert}>{error}</p>}

      {readyToPlace && (
        <div className={styles.intakeReady}>
          <p>Sam has a good read on you.</p>
          <button type="button" className={styles.btnPrimary} onClick={place} disabled={placing}>
            {placing ? 'Finding your fit…' : 'Show me where I fit →'}
          </button>
        </div>
      )}

      <form
        className={styles.intakeComposer}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className={styles.intakeInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tell Sam about your experience…"
          disabled={busy || !intakeId}
          aria-label="Your message to Sam"
        />
        <button type="submit" className={styles.btnPrimary} disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Swap the dashboard to render IntakeChat**

In `apps/web/src/app/dashboard/page.tsx`:

1. Replace the import `import { CatalogFlow } from './CatalogFlow';` with `import { IntakeChat } from './IntakeChat';`.
2. Replace the empty-state render `<CatalogFlow onStarted={() => setPhase('active')} />` with `<IntakeChat onPlaced={() => setPhase('active')} />`.
3. Update the empty-state greeting copy: change the `<h1>` empty branch from `<>Pick a project to <em>try out</em>.</>` to `<>Let’s find your <em>fit</em>.</>` and the `greetSub` empty branch text to `'Chat with Sam, our talent lead. A few minutes and you’ll be placed on a real team with a real ticket.'`.

- [ ] **Step 3: Add IntakeChat styles**

Append to `apps/web/src/app/dashboard/dashboard.module.css`:

```css
.intake {
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 1rem);
  max-width: 46rem;
  margin: 0 auto;
  width: 100%;
}
.intakeThread {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.25rem;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
  border-radius: 16px;
  background: var(--surface, #fff);
  max-height: 60vh;
  overflow-y: auto;
}
.intakeBubble {
  max-width: 80%;
  padding: 0.75rem 1rem;
  border-radius: 14px;
  line-height: 1.5;
}
.intakeFromSam {
  align-self: flex-start;
  background: var(--surface-2, #f4f4f5);
}
.intakeFromYou {
  align-self: flex-end;
  background: var(--accent-soft, #e8efff);
}
.intakeWho {
  display: block;
  font-size: 0.72rem;
  font-weight: 600;
  opacity: 0.6;
  margin-bottom: 0.2rem;
}
.intakeTyping {
  align-self: flex-start;
  font-size: 0.85rem;
  opacity: 0.6;
}
.intakeReady {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--accent, #2563eb);
  border-radius: 14px;
}
.intakeComposer {
  display: flex;
  gap: 0.5rem;
}
.intakeInput {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-radius: 12px;
  font: inherit;
}
```

- [ ] **Step 4: Delete the dead catalog components**

```bash
git rm apps/web/src/app/dashboard/CatalogFlow.tsx \
       apps/web/src/app/dashboard/ProjectCatalog.tsx \
       apps/web/src/app/dashboard/RolePicker.tsx \
       apps/web/src/app/dashboard/TeamFormation.tsx
```

- [ ] **Step 5: Type-check the web package**

Run: `pnpm --filter @tryout/web exec tsc --noEmit`
Expected: exits 0 (no remaining references to the deleted components or removed API methods).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/dashboard
git commit -m "feat(web): intake chat replaces catalog browse on the dashboard"
```

---

## Task 12: Apply migration, reseed, verify, document

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Apply the migration (verify the live Postgres port first)**

Confirm the port (memory note: flips between 5432/5542):

Run: `docker ps --format "{{.Names}} {{.Ports}}"`
Then apply (adjust the port if needed):

Run: `DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/db migrate`
Expected: `migrations applied successfully!`, `candidate_profiles` created.

- [ ] **Step 2: Reseed (idempotent) to confirm nothing broke**

Run: `DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/db seed`
Expected: `Seed complete.`

- [ ] **Step 3: Run the full API unit + e2e suites**

Run: `pnpm --filter @tryout/api test`
Expected: PASS (existing 29 + intake unit 8 = 37).

Run: `DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout JWT_SECRET=dev pnpm --filter @tryout/api test:e2e`
Expected: PASS (existing 21 + intake 5 = 26).

- [ ] **Step 4: Manual smoke (optional but recommended)**

With API (3001) and web (3000) running: sign in → land on the Sam chat → send 1-2 messages → click "Show me where I fit" → confirm redirect to `/run` with the PM intro referencing your stated growth areas.

- [ ] **Step 5: Update STATUS.md**

In `docs/STATUS.md`, replace the "In Progress — Project Catalog → Role → Team Formation" section with a short "Intake Agent" section: note the catalog browse was superseded by the Sam intake flow, the `candidate_profiles` table, the `IntakeModule` (`POST /intake`, `/intake/:id/messages`, `/intake/:id/place`, `GET /intake/:id`), the `ScenarioMatcher`, and PM-intro profile injection. Update the Key Metrics table (DB tables 9 → 10; API endpoints 9 → 13; BullMQ queues unchanged; unit/e2e counts).

- [ ] **Step 6: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: intake agent replaces catalog flow in STATUS"
```

---

## Self-Review Notes

- **Spec coverage:** intake conversation (Tasks 5-7), free-form + structured extraction (Task 5 `askSam`/`mergeProfile`), agent-proposes-confirm + turn cap (Task 5 `READY_CONFIDENCE`/`TURN_CAP`), Sam persona (Task 3), `candidate_profiles` (Task 1), matcher today→Scenario-01 (Task 4), handoff reusing `startRun` (Task 6 `place`), PM framing (Task 8), catalog removal (Tasks 10-11), testing (Tasks 4-9). All covered.
- **Type consistency:** `ProfileSnapshot`, `IntakeMessage`, `IntakeTurnResult`, `IntakeSessionView`, `IntakePlacementResult` defined in Task 2 and used unchanged in Tasks 5-11. `MatchResult` is matcher-internal; `startRun` is called with `{ scenarioId, role }` matching `CreateRunDto`.
- **Deferred (out of scope, per spec):** Tryout Record reuse of the profile; multi-scenario authoring; runtime scenario generation.
