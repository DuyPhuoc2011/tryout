# Arena M1-B1 — Environment & Turn Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and govern arena environments and turns — who may create one, how many may exist, what a submitted design does, and what state it lands in — consuming `@tryout/arena` for validation.

**Architecture:** A new NestJS module `apps/api/src/arena/` over two Drizzle tables. Two one-way status machines (environment, turn) following the `purchases` precedent: guarded transitions, idempotent, never downgrading. `parseDesign` from `@tryout/arena` runs at submission, so an invalid design is rejected as a stored, buyer-readable message before any infrastructure is touched. No cloud calls in this milestone — the runner that consumes an accepted turn is M1-B2.

**Tech Stack:** NestJS 10, Drizzle ORM, Postgres 16, Jest + supertest, `@tryout/arena`.

**Spec:** `docs/superpowers/specs/2026-07-19-k8s-vs-serverless-arena-design.md`

---

## Why M1-B Is Four Plans, Not One

M1-B as scoped in the spec covers four independently-testable subsystems. One plan spanning all four would be unexecutable, so:

| Sub-plan | Contents | Depends on M0? |
|---|---|---|
| **M1-B1 (this plan)** | Persistence, lifecycle state machines, ownership, quotas, design submission | **No** |
| M1-B2 | First-party Terraform module for a buyer environment + arena-runner job that applies it | No |
| M1-B3 | Load + chaos harness; emits the `Usage` and `RunMetrics` vectors `@tryout/arena` already consumes | **Yes** — traffic profile numbers |
| M1-B4 | Scoreboard UI + the reproducibility gate | **Yes** — par thresholds |

**This plan is deliberately first because it is the largest piece with zero M0 dependency.** It can be built and merged while the M0 experiment is still unrun. B3 and B4 must wait for a recorded GO.

---

## Scope

**In scope:** `arena_environments` and `arena_turns` tables; ownership enforcement (buyer must own a paid purchase of the listing); one environment per buyer per listing; a global concurrent-environment cap; a per-buyer apply rate limit; design submission with `parseDesign` validation; read endpoints.

**Out of scope:** any GCP call, Terraform execution, load generation, scoring, the scoreboard, GitHub PR webhooks (B2 owns the webhook that drives a turn forward), TTL reaping (B2, once environments are real).

---

## File Structure

```
packages/db/src/schema.ts            — MODIFY: add two tables + two enums
packages/db/migrations/              — generated migration

apps/api/src/arena/
├── arena.module.ts                  — wires the module, imports AuthModule
├── arena.constants.ts               — quotas and TTL as named constants
├── ownership.service.ts             — "does this user own a paid purchase of this listing?"
├── ownership.service.spec.ts
├── environments.service.ts          — create / list. Quota + slug generation
├── environments.service.spec.ts
├── turns.service.ts                 — submit a design, validate, store verdict-or-errors
├── turns.service.spec.ts
├── arena.controller.ts              — JWT-guarded HTTP surface
└── dto/submit-turn.dto.ts           — class-validator DTO

apps/api/test/arena.e2e-spec.ts      — end-to-end against real Postgres
apps/api/src/app.module.ts           — MODIFY: register ArenaModule
```

**Responsibility boundaries:** `ownership` answers one question and is reused by both services. `environments` owns creation and quota. `turns` owns validation and turn state. Splitting by responsibility rather than stuffing one `arena.service.ts` keeps each file small enough to reason about, matching how `catalog`/`purchases`/`tutor` are already organized.

---

### Task 1: Database schema and migration

**Files:**
- Modify: `packages/db/src/schema.ts`
- Generate: `packages/db/migrations/*.sql`

- [ ] **Step 1: Add enums and tables to `packages/db/src/schema.ts`**

Append after the existing `tutorThreads` table, before the type exports at the bottom:

```typescript
// One-way lifecycle. An environment never returns to an earlier state; `degraded`
// means a partial apply left it unusable and it must be reprovisioned.
export const arenaEnvStatusEnum = pgEnum('arena_env_status', [
  'pending',
  'provisioning',
  'ready',
  'degraded',
  'destroyed',
]);

// A turn is one submitted design. `rejected` is a validation failure — it never
// reaches infrastructure. Everything from `applying` onward costs real money.
export const arenaTurnStatusEnum = pgEnum('arena_turn_status', [
  'submitted',
  'rejected',
  'applying',
  'apply_failed',
  'applied',
  'measuring',
  'scored',
]);

export const arenaEnvironments = pgTable(
  'arena_environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => scenarioListings.id),
    // Becomes a GCP resource name. Must match /^env-[a-z0-9]{6,32}$/ — the same
    // pattern @tryout/arena's renderTfvars enforces.
    envSlug: text('env_slug').notNull().unique(),
    status: arenaEnvStatusEnum('status').notNull().default('pending'),
    // Nothing lives forever by accident. The reaper (M1-B2) sweeps past this.
    ttlExpiresAt: timestamp('ttl_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One environment per buyer per scenario. Reprovisioning reuses the row.
    userListingUnique: unique('arena_env_user_listing_unique').on(t.userId, t.listingId),
  }),
);

export const arenaTurns = pgTable('arena_turns', {
  id: uuid('id').primaryKey().defaultRandom(),
  environmentId: uuid('environment_id')
    .notNull()
    .references(() => arenaEnvironments.id),
  status: arenaTurnStatusEnum('status').notNull().default('submitted'),
  // Validation failures, shaped as @tryout/arena's ParseError[]. Already
  // sanitized and length-bounded by parseDesign before they get here.
  parseErrors: jsonb('parse_errors'),
  // Rendered ArenaTfvars. Null until a design validates.
  tfvars: jsonb('tfvars'),
  // Verdict from scoreRun. Null until M1-B3/B4 score the run.
  verdict: jsonb('verdict'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Add `jsonb` to the drizzle imports**

At the top of `packages/db/src/schema.ts`, add `jsonb` to the existing import list from `drizzle-orm/pg-core`.

- [ ] **Step 3: Verify the db package builds**

Run: `pnpm --filter @tryout/db build`
Expected: exit 0.

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @tryout/db generate`
Expected: a new SQL file in `packages/db/migrations/`. Read it and confirm it creates both enums, both tables, and the unique constraints — do not assume.

- [ ] **Step 5: Apply the migration against local Postgres**

Confirm the container port first — this repo's Postgres flips between 5432 and 5542 depending on whether a native Postgres is running. Check with `docker compose ps` and use the port it actually reports.

Run: `DATABASE_URL=postgres://tryout:tryout@localhost:<port>/tryout pnpm --filter @tryout/db migrate`
Expected: applies cleanly. Report the real output.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations
git commit -m "feat(db): arena environment and turn tables"
```

---

### Task 2: Constants and the ownership check

**Files:**
- Create: `apps/api/src/arena/arena.constants.ts`
- Create: `apps/api/src/arena/ownership.service.ts`
- Test: `apps/api/src/arena/ownership.service.spec.ts`

Ownership is the gate on everything: only a buyer who actually paid for a listing may spend our infrastructure budget on it.

- [ ] **Step 1: Create `apps/api/src/arena/arena.constants.ts`**

```typescript
/**
 * Quotas exist because every environment and every apply costs real money on
 * infrastructure we own. These are the ceilings referenced in the design spec.
 */

/** Hours an environment lives before the reaper may destroy it. */
export const ENVIRONMENT_TTL_HOURS = 72;

/** Global cap on environments not yet destroyed. Beyond this, creation is refused. */
export const MAX_CONCURRENT_ENVIRONMENTS = 25;

/** Per-buyer cap on turns submitted in a rolling hour. Each turn is an apply. */
export const MAX_TURNS_PER_HOUR = 6;

/** Statuses that still consume infrastructure, and so count against the cap. */
export const LIVE_ENVIRONMENT_STATUSES = [
  'pending',
  'provisioning',
  'ready',
  'degraded',
] as const;
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/arena/ownership.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { OwnershipService } from './ownership.service';
import { DRIZZLE } from '../db/db.module';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn(),
};

describe('OwnershipService', () => {
  let service: OwnershipService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    const moduleRef = await Test.createTestingModule({
      providers: [OwnershipService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();
    service = moduleRef.get(OwnershipService);
  });

  it('resolves for a buyer whose purchase reached invite_sent', async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: 'p1', status: 'invite_sent' }]);
    await expect(service.assertOwnsListing('u1', 'l1')).resolves.toBeUndefined();
  });

  it('resolves for a buyer whose purchase is paid but the invite failed', async () => {
    // An invite failure is our problem, not theirs. They paid; they get access.
    mockDb.limit.mockResolvedValueOnce([{ id: 'p1', status: 'invite_failed' }]);
    await expect(service.assertOwnsListing('u1', 'l1')).resolves.toBeUndefined();
  });

  it('rejects a buyer with no purchase row', async () => {
    mockDb.limit.mockResolvedValueOnce([]);
    await expect(service.assertOwnsListing('u1', 'l1')).rejects.toThrow(ForbiddenException);
  });

  it('rejects a purchase still pending payment', async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: 'p1', status: 'pending' }]);
    await expect(service.assertOwnsListing('u1', 'l1')).rejects.toThrow(ForbiddenException);
  });

  it('rejects a refunded purchase', async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: 'p1', status: 'refunded' }]);
    await expect(service.assertOwnsListing('u1', 'l1')).rejects.toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @tryout/api test -- ownership`
Expected: FAIL — cannot find module `./ownership.service`.

- [ ] **Step 4: Write the service**

Create `apps/api/src/arena/ownership.service.ts`:

```typescript
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';

/** Purchase statuses that grant scenario access. */
const ENTITLED_STATUSES = new Set(['paid', 'invite_sent', 'invite_failed']);

@Injectable()
export class OwnershipService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Throw unless the user holds an entitling purchase for the listing.
   *
   * `invite_failed` entitles deliberately: the GitHub invite failing is our
   * fault, not the buyer's, and they have already paid.
   */
  async assertOwnsListing(userId: string, listingId: string): Promise<void> {
    const [purchase] = await this.db
      .select({ id: schema.purchases.id, status: schema.purchases.status })
      .from(schema.purchases)
      .where(
        and(
          eq(schema.purchases.userId, userId),
          eq(schema.purchases.listingId, listingId),
        ),
      )
      .limit(1);

    if (!purchase || !ENTITLED_STATUSES.has(purchase.status)) {
      // Deliberately identical for "no purchase" and "unentitled purchase":
      // the response must not reveal which listings a stranger has bought.
      throw new ForbiddenException('You do not own this scenario');
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @tryout/api test -- ownership`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/arena/arena.constants.ts apps/api/src/arena/ownership.service.ts apps/api/src/arena/ownership.service.spec.ts
git commit -m "feat(arena-api): purchase-entitlement check for scenario access"
```

---

### Task 3: Environment creation, slug generation, and quotas

**Files:**
- Create: `apps/api/src/arena/environments.service.ts`
- Test: `apps/api/src/arena/environments.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/arena/environments.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { EnvironmentsService } from './environments.service';
import { OwnershipService } from './ownership.service';
import { DRIZZLE } from '../db/db.module';
import { MAX_CONCURRENT_ENVIRONMENTS } from './arena.constants';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
};

const ownership = { assertOwnsListing: jest.fn() };

describe('EnvironmentsService', () => {
  let service: EnvironmentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    ownership.assertOwnsListing.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        EnvironmentsService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: OwnershipService, useValue: ownership },
      ],
    }).compile();
    service = moduleRef.get(EnvironmentsService);
  });

  /** Arrange the three reads create() performs, in order. */
  function arrangeReads(opts: { liveCount: number; existing?: unknown }) {
    // 1. global live count
    mockDb.where.mockResolvedValueOnce([{ count: opts.liveCount }]);
    // 2. existing env for this user+listing
    mockDb.limit.mockResolvedValueOnce(opts.existing ? [opts.existing] : []);
  }

  it('checks entitlement before doing anything else', async () => {
    ownership.assertOwnsListing.mockRejectedValueOnce(new Error('nope'));
    await expect(service.create('u1', 'l1')).rejects.toThrow('nope');
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('creates an environment with a schema-valid slug and a TTL in the future', async () => {
    arrangeReads({ liveCount: 0 });
    mockDb.returning.mockResolvedValueOnce([{ id: 'e1', envSlug: 'env-abc123' }]);

    const before = Date.now();
    const result = await service.create('u1', 'l1');

    expect(result.id).toBe('e1');
    const inserted = mockDb.values.mock.calls[0][0];
    // Must satisfy the pattern @tryout/arena's renderTfvars enforces.
    expect(inserted.envSlug).toMatch(/^env-[a-z0-9]{6,32}$/);
    expect(inserted.status).toBe('pending');
    expect(new Date(inserted.ttlExpiresAt).getTime()).toBeGreaterThan(before);
  });

  it('generates a distinct slug on each call', async () => {
    const slugs = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      jest.clearAllMocks();
      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.where.mockReturnThis();
      mockDb.insert.mockReturnThis();
      mockDb.values.mockReturnThis();
      ownership.assertOwnsListing.mockResolvedValue(undefined);
      arrangeReads({ liveCount: 0 });
      mockDb.returning.mockResolvedValueOnce([{ id: 'e1' }]);
      await service.create('u1', 'l1');
      slugs.add(mockDb.values.mock.calls[0][0].envSlug);
    }
    expect(slugs.size).toBe(20);
  });

  it('refuses when an environment already exists for this user and listing', async () => {
    arrangeReads({ liveCount: 0, existing: { id: 'e-old', status: 'ready' } });
    await expect(service.create('u1', 'l1')).rejects.toThrow(ConflictException);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('refuses when the global concurrency cap is reached', async () => {
    arrangeReads({ liveCount: MAX_CONCURRENT_ENVIRONMENTS });
    await expect(service.create('u1', 'l1')).rejects.toThrow(ServiceUnavailableException);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('states the queue position rather than failing silently at the cap', async () => {
    arrangeReads({ liveCount: MAX_CONCURRENT_ENVIRONMENTS });
    // A silent stall is the exact failure mode this project's own F09 incident
    // was about. The refusal must say what is happening.
    await expect(service.create('u1', 'l1')).rejects.toThrow(/capacity/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tryout/api test -- environments`
Expected: FAIL — cannot find module `./environments.service`.

- [ ] **Step 3: Write the service**

Create `apps/api/src/arena/environments.service.ts`:

```typescript
import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, count } from 'drizzle-orm';
import { schema, type Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';
import { OwnershipService } from './ownership.service';
import {
  ENVIRONMENT_TTL_HOURS,
  LIVE_ENVIRONMENT_STATUSES,
  MAX_CONCURRENT_ENVIRONMENTS,
} from './arena.constants';

/** Slug alphabet chosen to satisfy /^env-[a-z0-9]{6,32}$/ and GCP resource naming. */
const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_BODY_LENGTH = 12;

function generateEnvSlug(): string {
  const bytes = randomBytes(SLUG_BODY_LENGTH);
  let body = '';
  for (let i = 0; i < SLUG_BODY_LENGTH; i += 1) {
    body += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return `env-${body}`;
}

@Injectable()
export class EnvironmentsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly ownership: OwnershipService,
  ) {}

  /**
   * Create the buyer's environment for a scenario they own.
   *
   * Entitlement is checked before any quota read so an unentitled caller can
   * never learn how much capacity is in use.
   */
  async create(userId: string, listingId: string) {
    await this.ownership.assertOwnsListing(userId, listingId);

    const [live] = await this.db
      .select({ count: count() })
      .from(schema.arenaEnvironments)
      .where(inArray(schema.arenaEnvironments.status, [...LIVE_ENVIRONMENT_STATUSES]));

    if (Number(live?.count ?? 0) >= MAX_CONCURRENT_ENVIRONMENTS) {
      // Explicit refusal, never a silent stall — the lesson of this project's
      // own F09 incident, where queued work vanished with no signal.
      throw new ServiceUnavailableException(
        'The arena is at capacity. Try again shortly.',
      );
    }

    const [existing] = await this.db
      .select({ id: schema.arenaEnvironments.id })
      .from(schema.arenaEnvironments)
      .where(
        and(
          eq(schema.arenaEnvironments.userId, userId),
          eq(schema.arenaEnvironments.listingId, listingId),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictException('You already have an environment for this scenario');
    }

    const ttlExpiresAt = new Date(Date.now() + ENVIRONMENT_TTL_HOURS * 60 * 60 * 1000);

    const [created] = await this.db
      .insert(schema.arenaEnvironments)
      .values({
        userId,
        listingId,
        envSlug: generateEnvSlug(),
        status: 'pending',
        ttlExpiresAt,
      })
      .returning();

    return created;
  }

  /** The caller's own environments. Never exposes another buyer's. */
  async mine(userId: string) {
    return this.db
      .select({
        id: schema.arenaEnvironments.id,
        listingId: schema.arenaEnvironments.listingId,
        envSlug: schema.arenaEnvironments.envSlug,
        status: schema.arenaEnvironments.status,
        ttlExpiresAt: schema.arenaEnvironments.ttlExpiresAt,
        createdAt: schema.arenaEnvironments.createdAt,
      })
      .from(schema.arenaEnvironments)
      .where(eq(schema.arenaEnvironments.userId, userId));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tryout/api test -- environments`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/arena/environments.service.ts apps/api/src/arena/environments.service.spec.ts
git commit -m "feat(arena-api): environment creation with slug generation and quotas"
```

---

### Task 4: Turn submission and design validation

**Files:**
- Create: `apps/api/src/arena/turns.service.ts`
- Test: `apps/api/src/arena/turns.service.spec.ts`

This is where `@tryout/arena` earns its keep: an invalid design becomes a stored, buyer-readable rejection and never reaches infrastructure.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/arena/turns.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TurnsService } from './turns.service';
import { DRIZZLE } from '../db/db.module';
import { MAX_TURNS_PER_HOUR } from './arena.constants';

const validYaml = [
  'schema_version: 1',
  'api:',
  '  platform: cloudrun',
  '  min_instances: 1',
  '  max_instances: 10',
  '  concurrency: 80',
  '  cpu: 1',
  '  memory: 1Gi',
  'workers:',
  '  placement: separate_service',
  '  min_instances: 1',
  'cache:',
  '  enabled: true',
  '  tier: basic-1gb',
  'db:',
  '  tier: small',
].join('\n');

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
};

describe('TurnsService', () => {
  let service: TurnsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    const moduleRef = await Test.createTestingModule({
      providers: [TurnsService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();
    service = moduleRef.get(TurnsService);
  });

  /**
   * Arrange the two reads submit() performs, in call order.
   *
   * submit() calls .where() TWICE: first in the environment lookup (which then
   * chains .limit()), then in the rate-limit count (which resolves at .where()).
   * So the first .where() must return the chain and only the second may resolve
   * — mockResolvedValueOnce alone would front-load the queue and wrongly resolve
   * the first call, breaking the environment lookup.
   */
  function arrange(opts: { env?: unknown; recentTurns?: number }) {
    mockDb.where
      .mockReturnValueOnce(mockDb) // read 1: environment lookup, resolves at .limit()
      .mockResolvedValueOnce([{ count: opts.recentTurns ?? 0 }]); // read 2: count
    mockDb.limit.mockResolvedValueOnce(opts.env ? [opts.env] : []);
  }

  const readyEnv = { id: 'e1', userId: 'u1', envSlug: 'env-abc123', status: 'ready' };

  it('rejects an environment that does not belong to the caller', async () => {
    arrange({ env: undefined });
    await expect(service.submit('u1', 'e1', validYaml)).rejects.toThrow(NotFoundException);
  });

  it('stores a valid design as applying, with rendered tfvars', async () => {
    arrange({ env: readyEnv });
    mockDb.returning.mockResolvedValueOnce([{ id: 't1', status: 'applying' }]);

    const turn = await service.submit('u1', 'e1', validYaml);

    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.status).toBe('applying');
    expect(inserted.parseErrors).toBeNull();
    expect(inserted.tfvars).toMatchObject({
      environment_id: 'env-abc123',
      api_min_instances: 1,
      worker_service_enabled: true,
    });
    expect(turn.id).toBe('t1');
  });

  it('stores an invalid design as rejected, with errors and no tfvars', async () => {
    arrange({ env: readyEnv });
    mockDb.returning.mockResolvedValueOnce([{ id: 't1', status: 'rejected' }]);

    const bad = validYaml.replace('max_instances: 10', 'max_instances: 999');
    await service.submit('u1', 'e1', bad);

    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.status).toBe('rejected');
    expect(inserted.tfvars).toBeNull();
    expect(inserted.parseErrors[0].path).toBe('api.max_instances');
  });

  it('rejects rather than throws on malformed YAML', async () => {
    arrange({ env: readyEnv });
    mockDb.returning.mockResolvedValueOnce([{ id: 't1', status: 'rejected' }]);

    await expect(service.submit('u1', 'e1', 'api: [unclosed')).resolves.toBeDefined();
    expect(mockDb.values.mock.calls[0][0].status).toBe('rejected');
  });

  it('does not count a rejected turn against the apply rate limit', async () => {
    // Validation costs nothing. Only applies cost money, so only applies are limited.
    arrange({ env: readyEnv, recentTurns: MAX_TURNS_PER_HOUR });
    mockDb.returning.mockResolvedValueOnce([{ id: 't1', status: 'rejected' }]);

    const bad = validYaml.replace('cpu: 1', 'cpu: 64');
    await expect(service.submit('u1', 'e1', bad)).resolves.toBeDefined();
    expect(mockDb.values.mock.calls[0][0].status).toBe('rejected');
  });

  it('refuses a valid design once the hourly apply limit is reached', async () => {
    arrange({ env: readyEnv, recentTurns: MAX_TURNS_PER_HOUR });
    await expect(service.submit('u1', 'e1', validYaml)).rejects.toThrow(
      /rate limit|too many/i,
    );
  });
});
```

Note on the rate-limit assertion: NestJS has no `TooManyRequestsException`, which is why the last test matches on the message rather than an exception class. The implementation raises `HttpException` with `HttpStatus.TOO_MANY_REQUESTS`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tryout/api test -- turns`
Expected: FAIL — cannot find module `./turns.service`.

- [ ] **Step 3: Write the service**

Create `apps/api/src/arena/turns.service.ts`:

```typescript
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, eq, gte } from 'drizzle-orm';
import { parseDesign, renderTfvars } from '@tryout/arena';
import { schema, type Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';
import { MAX_TURNS_PER_HOUR } from './arena.constants';

@Injectable()
export class TurnsService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Submit a design for an environment the caller owns.
   *
   * A design that fails validation is stored as `rejected` and never reaches
   * infrastructure — that rejection is the cheap path, so it is deliberately
   * NOT rate limited. Only applies, which cost real money, are.
   */
  async submit(userId: string, environmentId: string, rawDesign: string) {
    const [environment] = await this.db
      .select({
        id: schema.arenaEnvironments.id,
        envSlug: schema.arenaEnvironments.envSlug,
      })
      .from(schema.arenaEnvironments)
      .where(
        and(
          eq(schema.arenaEnvironments.id, environmentId),
          // Scoped by userId, so another buyer's environment is indistinguishable
          // from one that does not exist.
          eq(schema.arenaEnvironments.userId, userId),
        ),
      )
      .limit(1);

    if (!environment) throw new NotFoundException('Environment not found');

    const parsed = parseDesign(rawDesign);

    if (!parsed.ok) {
      const [rejected] = await this.db
        .insert(schema.arenaTurns)
        .values({
          environmentId: environment.id,
          status: 'rejected',
          parseErrors: parsed.errors,
          tfvars: null,
        })
        .returning();
      return rejected;
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [recent] = await this.db
      .select({ count: count() })
      .from(schema.arenaTurns)
      .where(
        and(
          eq(schema.arenaTurns.environmentId, environment.id),
          gte(schema.arenaTurns.createdAt, oneHourAgo),
        ),
      );

    if (Number(recent?.count ?? 0) >= MAX_TURNS_PER_HOUR) {
      throw new HttpException(
        `Rate limit: at most ${MAX_TURNS_PER_HOUR} applies per hour`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const tfvars = renderTfvars(parsed.design, environment.envSlug);

    const [accepted] = await this.db
      .insert(schema.arenaTurns)
      .values({
        environmentId: environment.id,
        status: 'applying',
        parseErrors: null,
        tfvars,
      })
      .returning();

    return accepted;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tryout/api test -- turns`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/arena/turns.service.ts apps/api/src/arena/turns.service.spec.ts
git commit -m "feat(arena-api): turn submission validates designs before any apply"
```

---

### Task 5: Controller, module, and registration

**Files:**
- Create: `apps/api/src/arena/dto/submit-turn.dto.ts`
- Create: `apps/api/src/arena/arena.controller.ts`
- Create: `apps/api/src/arena/arena.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create the DTO**

`apps/api/src/arena/dto/submit-turn.dto.ts`:

```typescript
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitTurnDto {
  /**
   * Raw design.yaml text. The 16KB ceiling mirrors parseDesign's own cap so an
   * oversized body is refused at the edge rather than inside the parser.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(16 * 1024)
  design!: string;
}
```

- [ ] **Step 2: Create the controller**

`apps/api/src/arena/arena.controller.ts`:

```typescript
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { EnvironmentsService } from './environments.service';
import { TurnsService } from './turns.service';
import { SubmitTurnDto } from './dto/submit-turn.dto';

@Controller('arena')
@UseGuards(JwtAuthGuard)
export class ArenaController {
  constructor(
    private readonly environments: EnvironmentsService,
    private readonly turns: TurnsService,
  ) {}

  @Post('environments/:listingId')
  create(
    @CurrentUser() user: AuthUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ) {
    return this.environments.create(user.sub, listingId);
  }

  @Get('environments/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.environments.mine(user.sub);
  }

  @Post('environments/:environmentId/turns')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('environmentId', ParseUUIDPipe) environmentId: string,
    @Body() dto: SubmitTurnDto,
  ) {
    return this.turns.submit(user.sub, environmentId, dto.design);
  }
}
```

Note the route ordering: `environments/mine` must be declared before any `environments/:param` GET route to avoid `mine` being captured as a parameter. There is no such GET here, but keep the ordering if you add one.

- [ ] **Step 3: Create the module**

`apps/api/src/arena/arena.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArenaController } from './arena.controller';
import { EnvironmentsService } from './environments.service';
import { TurnsService } from './turns.service';
import { OwnershipService } from './ownership.service';

@Module({
  imports: [AuthModule],
  controllers: [ArenaController],
  providers: [EnvironmentsService, TurnsService, OwnershipService],
})
export class ArenaModule {}
```

- [ ] **Step 4: Register in `apps/api/src/app.module.ts`**

Add `ArenaModule` to the `imports` array, importing it from `./arena/arena.module`. Follow the existing formatting of that array exactly.

- [ ] **Step 5: Add the dependency**

`apps/api/package.json` needs `"@tryout/arena": "workspace:*"` in `dependencies`, alongside the existing `@tryout/db` and `@tryout/shared` entries. Then run `pnpm install`.

- [ ] **Step 6: Verify the API builds and unit tests pass**

Run: `pnpm --filter @tryout/api build`
Expected: exit 0.

Run: `pnpm --filter @tryout/api test`
Expected: all suites pass, including the 17 new arena tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/arena apps/api/src/app.module.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(arena-api): JWT-guarded arena controller and module"
```

---

### Task 6: End-to-end tests against real Postgres

**Files:**
- Create: `apps/api/test/arena.e2e-spec.ts`

Unit tests use a mocked Drizzle, so they cannot catch a wrong column name, a broken constraint, or a bad migration. These can.

- [ ] **Step 1: Read the existing e2e pattern first**

Read `apps/api/test/marketplace.e2e-spec.ts` and `apps/api/test/jest-e2e.setup.ts` before writing anything. Match how they bootstrap the app, seed users and listings, obtain a JWT, and clean up. Do not invent a different harness.

- [ ] **Step 2: Write the e2e spec**

Create `apps/api/test/arena.e2e-spec.ts` covering, using that same harness:

1. `POST /arena/environments/:listingId` returns 403 for a user with no purchase.
2. `POST /arena/environments/:listingId` returns 403 for a user whose purchase is `pending`.
3. With an `invite_sent` purchase, it creates an environment whose `envSlug` matches `/^env-[a-z0-9]{6,32}$/` and whose `ttlExpiresAt` is in the future.
4. A second create for the same user and listing returns 409.
5. `GET /arena/environments/mine` returns only the caller's environments — seed a second user with their own environment and assert it is absent.
6. `POST /arena/environments/:environmentId/turns` with a valid design returns a turn with status `applying` and non-null `tfvars`.
7. The same endpoint with an out-of-range lever returns a turn with status `rejected`, non-empty `parseErrors`, and null `tfvars`.
8. Submitting to another user's environment returns 404 — not 403, since the existence of that environment must not be revealed.
9. All endpoints return 401 without a JWT.

Write real assertions on response bodies and status codes. Persist through the real database; do not mock `DRIZZLE` in this file.

- [ ] **Step 3: Run the e2e suite**

Confirm the Postgres port first (`docker compose ps` — this repo's container flips between 5432 and 5542).

Run:
```
DATABASE_URL=postgres://tryout:tryout@localhost:<port>/tryout JWT_SECRET=dev pnpm --filter @tryout/api test:e2e
```
Expected: all suites pass, including the new arena spec and the pre-existing auth, marketplace, and tutor specs. Report the real output.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/arena.e2e-spec.ts
git commit -m "test(arena-api): end-to-end lifecycle coverage against real Postgres"
```

---

## Done When

- `pnpm --filter @tryout/api test` passes, including 17 new unit tests.
- `pnpm --filter @tryout/api test:e2e` passes, including 9 new e2e cases.
- `pnpm -r --workspace-concurrency=1 build` passes.
- The migration applies cleanly to a fresh database.
- No GCP call, Terraform execution, or load generation exists anywhere in this milestone.

## What M1-B2 Picks Up

The first-party Terraform module that builds a buyer environment from `ArenaTfvars`, and the arena-runner Cloud Run Job that consumes an `applying` turn: plan → apply with a namespace-scoped service account → advance the turn to `applied` or `apply_failed` → post the result to the customer's PR. Also the TTL reaper, which only becomes meaningful once environments consume real resources. Still no M0 dependency.
