# Tryout M0 — Foundation & Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Tryout monorepo so a user can sign up, log in, and hit an authenticated route, with the full data model and LLM-router seams in place for later milestones.

**Architecture:** A pnpm monorepo with a NestJS API (`apps/api`) and a Next.js app (`apps/web`), sharing types via `packages/shared`, a Drizzle/Postgres data layer via `packages/db`, and a provider-agnostic LLM interface stub via `packages/llm`. Auth is email/password with bcrypt hashing and JWT bearer tokens. Local infra (Postgres + Redis) runs via docker-compose; both apps ship as Cloud Run containers.

**Tech Stack:** pnpm workspaces, TypeScript, NestJS 10, Next.js 14 (App Router), Drizzle ORM + postgres.js, PostgreSQL 16, bcrypt, `@nestjs/jwt`, class-validator, Jest + Supertest, Redis (infra only), Docker.

**Source spec:** `docs/superpowers/specs/2026-06-14-tryout-foundation-design.md`

**Conventions used throughout this plan:**
- Workspace package names: `@tryout/api`, `@tryout/web`, `@tryout/db`, `@tryout/shared`, `@tryout/llm`.
- All commands run from the repo root (`H:\TRYOUT`) unless a step says otherwise.
- Secrets come from env vars only; never commit a real `.env`.
- Every schema change goes through a Drizzle migration — no ad-hoc SQL.

---

## File Structure

Files created in this plan, by responsibility:

```
tryout/
├── package.json                      # root workspace scripts + dev deps
├── pnpm-workspace.yaml               # workspace globs
├── tsconfig.base.json                # shared compiler options
├── docker-compose.yml                # local Postgres + Redis
├── .env.example                      # documented env contract
├── .dockerignore
├── apps/
│   ├── api/                          # NestJS backend
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.build.json
│   │   ├── nest-cli.json
│   │   ├── jest.config.ts            # unit test config
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── main.ts               # bootstrap + global ValidationPipe
│   │   │   ├── app.module.ts         # wires DbModule, AuthModule, HealthController
│   │   │   ├── config/env.ts         # validated env access
│   │   │   ├── db/db.module.ts       # provides the Drizzle client (DRIZZLE token)
│   │   │   ├── health/health.controller.ts
│   │   │   └── auth/
│   │   │       ├── auth.module.ts
│   │   │       ├── auth.controller.ts
│   │   │       ├── auth.service.ts
│   │   │       ├── password.service.ts
│   │   │       ├── jwt-auth.guard.ts
│   │   │       ├── current-user.decorator.ts
│   │   │       └── dto/
│   │   │           ├── signup.dto.ts
│   │   │           └── login.dto.ts
│   │   └── test/
│   │       ├── jest-e2e.config.ts
│   │       └── auth.e2e-spec.ts       # signup → login → /auth/me round trip
│   └── web/                          # Next.js app
│       ├── package.json
│       ├── next.config.mjs
│       ├── tsconfig.json
│       └── src/
│           ├── app/
│           │   ├── layout.tsx
│           │   ├── globals.css        # design tokens
│           │   ├── page.tsx           # redirect to /login
│           │   ├── login/page.tsx
│           │   └── signup/page.tsx
│           └── lib/api.ts             # typed fetch client to the API
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── enums.ts               # agent role, run status, etc.
│   │       └── auth.ts                # AuthResponse / shared DTO shapes
│   ├── db/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── client.ts             # createDb(), Db type
│   │       └── schema.ts             # ALL entities from spec §4
│   └── llm/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           └── router.ts             # interfaces + NotImplemented stub (built at M2)
├── scenarios/
│   └── scenario-01-archive-tasks.md  # moved from repo root
└── templates/
    └── .gitkeep                      # lumi-tasks-api source lands here at M1
```

---

## Task 1: Monorepo skeleton

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.dockerignore`
- Modify: `.gitignore`

- [ ] **Step 1: Create the workspace manifest**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 2: Create the root package.json**

Create `package.json`:

```json
{
  "name": "tryout",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev:api": "pnpm --filter @tryout/api start:dev",
    "dev:web": "pnpm --filter @tryout/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "db:generate": "pnpm --filter @tryout/db generate",
    "db:migrate": "pnpm --filter @tryout/db migrate",
    "infra:up": "docker compose up -d",
    "infra:down": "docker compose down"
  },
  "devDependencies": {
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 3: Create the shared TS config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "resolveJsonModule": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create .dockerignore**

Create `.dockerignore`:

```
node_modules
**/node_modules
**/dist
**/.next
.git
.env
.env.local
*.log
```

- [ ] **Step 5: Extend .gitignore**

Add these lines to the existing `.gitignore` (keep the current contents):

```
.next/
coverage/
*.tsbuildinfo
```

- [ ] **Step 6: Verify pnpm reads the workspace**

Run: `pnpm install`
Expected: completes with "Done" and no errors (no packages yet, just installs root `typescript`).

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json .dockerignore .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold pnpm monorepo root"
```

---

## Task 2: Local infra (docker-compose) + env contract

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`

- [ ] **Step 1: Create docker-compose.yml**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: tryout
      POSTGRES_PASSWORD: tryout
      POSTGRES_DB: tryout
    ports:
      - "5432:5432"
    volumes:
      - tryout_pg:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tryout"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  tryout_pg:
```

- [ ] **Step 2: Create .env.example**

Create `.env.example`:

```
# API
PORT=3001
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-only-change-me
JWT_EXPIRES_IN=7d

# Web
NEXT_PUBLIC_API_URL=http://localhost:3001
```

- [ ] **Step 3: Start infra and confirm health**

Run: `docker compose up -d`
Then run: `docker compose ps`
Expected: both `postgres` and `redis` show `(healthy)` within ~15s.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: add local postgres + redis via docker-compose"
```

---

## Task 3: packages/shared — shared enums and DTO shapes

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/enums.ts`
- Create: `packages/shared/src/auth.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/shared/package.json`:

```json
{
  "name": "@tryout/shared",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "echo \"no tests\" && exit 0"
  }
}
```

- [ ] **Step 2: Create the package tsconfig**

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create enums**

Create `packages/shared/src/enums.ts`:

```ts
export const SCENARIO_RUN_STATUSES = [
  'onboarding',
  'in_progress',
  'in_review',
  'grading',
  'complete',
] as const;
export type ScenarioRunStatus = (typeof SCENARIO_RUN_STATUSES)[number];

export const AGENT_ROLES = ['pm', 'senior'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const MESSAGE_DIRECTIONS = ['user', 'agent'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const REVIEW_VERDICTS = ['approve', 'request_changes'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];
```

- [ ] **Step 4: Create auth shapes**

Create `packages/shared/src/auth.ts`:

```ts
export interface PublicUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}
```

- [ ] **Step 5: Create the barrel export**

Create `packages/shared/src/index.ts`:

```ts
export * from './enums';
export * from './auth';
```

- [ ] **Step 6: Build the package**

Run: `pnpm --filter @tryout/shared build`
Expected: `dist/index.js` and `dist/index.d.ts` produced, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add shared enums and auth DTO shapes"
```

---

## Task 4: packages/db — Drizzle schema (full data model)

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/index.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/db/package.json`:

```json
{
  "name": "@tryout/db",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate",
    "test": "echo \"no tests\" && exit 0"
  },
  "dependencies": {
    "drizzle-orm": "^0.33.0",
    "postgres": "^3.4.4"
  },
  "devDependencies": {
    "drizzle-kit": "^0.24.2"
  }
}
```

- [ ] **Step 2: Create the package tsconfig**

Create `packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Define the full schema**

Create `packages/db/src/schema.ts` — this is the entire spec §4 data model. Organization/Cohort are intentionally NOT defined (reserved for later).

```ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';

export const scenarioRunStatus = pgEnum('scenario_run_status', [
  'onboarding',
  'in_progress',
  'in_review',
  'grading',
  'complete',
]);
export const agentRoleEnum = pgEnum('agent_role', ['pm', 'senior']);
export const messageDirectionEnum = pgEnum('message_direction', ['user', 'agent']);
export const reviewVerdictEnum = pgEnum('review_verdict', ['approve', 'request_changes']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  // Nullable: OAuth-only users have no local password.
  passwordHash: text('password_hash'),
  // Reserved for cohorts/orgs (spec §4). No FK yet — Organization isn't built.
  organizationId: uuid('organization_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tracks = pgTable('tracks', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
});

export const scenarios = pgTable('scenarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  trackId: uuid('track_id')
    .notNull()
    .references(() => tracks.id),
  title: text('title').notNull(),
  version: integer('version').notNull().default(1),
  definition: jsonb('definition').notNull(),
  status: text('status').notNull().default('draft'),
});

export const scenarioRuns = pgTable('scenario_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  scenarioId: uuid('scenario_id')
    .notNull()
    .references(() => scenarios.id),
  status: scenarioRunStatus('status').notNull().default('onboarding'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }),
  repoMetadata: jsonb('repo_metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const repos = pgTable('repos', {
  id: uuid('id').primaryKey().defaultRandom(),
  scenarioRunId: uuid('scenario_run_id')
    .notNull()
    .references(() => scenarioRuns.id),
  url: text('url').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  prNumber: integer('pr_number'),
});

export const agentMessages = pgTable('agent_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  scenarioRunId: uuid('scenario_run_id')
    .notNull()
    .references(() => scenarioRuns.id),
  agentRole: agentRoleEnum('agent_role').notNull(),
  direction: messageDirectionEnum('direction').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  scenarioRunId: uuid('scenario_run_id')
    .notNull()
    .references(() => scenarioRuns.id),
  prUrl: text('pr_url').notNull(),
  ciStatus: text('ci_status'),
  ciResults: jsonb('ci_results'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id')
    .notNull()
    .references(() => submissions.id),
  agentRole: agentRoleEnum('agent_role').notNull(),
  comments: jsonb('comments'),
  verdict: reviewVerdictEnum('verdict').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const scorecards = pgTable('scorecards', {
  id: uuid('id').primaryKey().defaultRandom(),
  scenarioRunId: uuid('scenario_run_id')
    .notNull()
    .references(() => scenarioRuns.id),
  technicalScore: integer('technical_score').notNull(),
  technicalFeedback: text('technical_feedback').notNull(),
  professionalScore: integer('professional_score').notNull(),
  professionalFeedback: text('professional_feedback').notNull(),
  overallFeedback: text('overall_feedback').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

- [ ] **Step 4: Create the client factory**

Create `packages/db/src/client.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createDb(connectionString: string) {
  const queryClient = postgres(connectionString);
  return drizzle(queryClient, { schema });
}

export type Db = ReturnType<typeof createDb>;
```

- [ ] **Step 5: Create the barrel export**

Create `packages/db/src/index.ts`:

```ts
export * from './client';
export * as schema from './schema';
export type { User, NewUser } from './schema';
```

- [ ] **Step 6: Create the Drizzle config**

Create `packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://tryout:tryout@localhost:5432/tryout',
  },
});
```

- [ ] **Step 7: Install workspace deps and build**

Run: `pnpm install`
Then run: `pnpm --filter @tryout/db build`
Expected: install succeeds; build emits `dist/` with no TS errors.

- [ ] **Step 8: Generate the initial migration**

Run: `pnpm --filter @tryout/db generate`
Expected: a SQL file appears under `packages/db/migrations/` containing `CREATE TABLE` statements for all 9 tables and the 4 enums.

- [ ] **Step 9: Apply the migration to local Postgres**

Ensure infra is up (`docker compose up -d`), then run:
`DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/db migrate`
Expected: "migrations applied" with no errors.

Verify the tables exist:
Run: `docker compose exec postgres psql -U tryout -d tryout -c "\dt"`
Expected: lists `users`, `tracks`, `scenarios`, `scenario_runs`, `repos`, `agent_messages`, `submissions`, `reviews`, `scorecards`.

- [ ] **Step 10: Commit**

```bash
git add packages/db
git commit -m "feat(db): add full Drizzle schema and initial migration"
```

---

## Task 5: packages/llm — provider-agnostic interface stub

**Files:**
- Create: `packages/llm/package.json`
- Create: `packages/llm/tsconfig.json`
- Create: `packages/llm/src/router.ts`
- Create: `packages/llm/src/index.ts`

Only the interface and a stub exist now; real provider adapters arrive at M2 (per spec §5).

- [ ] **Step 1: Create the package manifest**

Create `packages/llm/package.json`:

```json
{
  "name": "@tryout/llm",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "echo \"no tests\" && exit 0"
  }
}
```

- [ ] **Step 2: Create the package tsconfig**

Create `packages/llm/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Define the router interface and stub**

Create `packages/llm/src/router.ts`:

```ts
export type LlmRole = 'pm' | 'senior' | 'grader';
export type TaskComplexity = 'chat' | 'review' | 'grade';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest {
  role: LlmRole;
  taskComplexity: TaskComplexity;
  messages: LlmMessage[];
  context?: Record<string, unknown>;
  // Structured-output schema (used by the grader at M4).
  responseSchema?: unknown;
}

export interface GenerateResult {
  content: string;
  raw?: unknown;
}

export interface LlmRouter {
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

/**
 * Placeholder router. Real provider adapters + routing policy land at M2.
 * Throwing here makes accidental early use loud rather than silent.
 */
export class NotImplementedLlmRouter implements LlmRouter {
  async generate(): Promise<GenerateResult> {
    throw new Error('LlmRouter is not implemented yet (built at M2).');
  }
}
```

- [ ] **Step 4: Create the barrel export**

Create `packages/llm/src/index.ts`:

```ts
export * from './router';
```

- [ ] **Step 5: Build the package**

Run: `pnpm --filter @tryout/llm build`
Expected: `dist/` emitted, no TS errors.

- [ ] **Step 6: Commit**

```bash
git add packages/llm
git commit -m "feat(llm): add provider-agnostic router interface stub"
```

---

## Task 6: NestJS API scaffold + /health (DB-backed)

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/tsconfig.build.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/jest.config.ts`
- Create: `apps/api/src/config/env.ts`
- Create: `apps/api/src/db/db.module.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/main.ts`

- [ ] **Step 1: Create the package manifest**

Create `apps/api/package.json`:

```json
{
  "name": "@tryout/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "test": "jest --config jest.config.ts",
    "test:e2e": "jest --config test/jest-e2e.config.ts"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.1",
    "@nestjs/core": "^10.4.1",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/platform-express": "^10.4.1",
    "@tryout/db": "workspace:*",
    "@tryout/shared": "workspace:*",
    "bcrypt": "^5.1.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "drizzle-orm": "^0.33.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.4",
    "@nestjs/testing": "^10.4.1",
    "@types/bcrypt": "^5.0.2",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.4",
    "ts-loader": "^9.5.1",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 2: Create TS + Nest configs**

Create `apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true
  },
  "include": ["src", "test"]
}
```

Create `apps/api/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

Create `apps/api/nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "tsConfigPath": "tsconfig.build.json"
  }
}
```

- [ ] **Step 3: Create the unit Jest config**

Create `apps/api/jest.config.ts`:

```ts
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
};

export default config;
```

- [ ] **Step 4: Create validated env access**

Create `apps/api/src/config/env.ts`:

```ts
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: () => required('DATABASE_URL'),
  jwtSecret: () => required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
};
```

- [ ] **Step 5: Create the DB module**

Create `apps/api/src/db/db.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { createDb, type Db } from '@tryout/db';
import { env } from '../config/env';

export const DRIZZLE = Symbol('DRIZZLE');

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: (): Db => createDb(env.databaseUrl()),
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}
```

- [ ] **Step 6: Create the health controller**

Create `apps/api/src/health/health.controller.ts`:

```ts
import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  @Get()
  async check() {
    await this.db.execute(sql`SELECT 1`);
    return { status: 'ok' };
  }
}
```

- [ ] **Step 7: Create the app module**

Create `apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [DbModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 8: Create the bootstrap entrypoint**

Create `apps/api/src/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: true, credentials: true });
  await app.listen(env.port, '0.0.0.0');
}

bootstrap();
```

- [ ] **Step 9: Install and build**

Run: `pnpm install`
Then run: `pnpm --filter @tryout/api build`
Expected: install links workspace deps; build emits `apps/api/dist/main.js` with no TS errors.

- [ ] **Step 10: Smoke-test /health against the real DB**

With infra up and migration applied, run (one line):
`PORT=3001 DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout JWT_SECRET=dev node apps/api/dist/main.js`
In a second terminal run: `curl -s http://localhost:3001/health`
Expected: `{"status":"ok"}`. Stop the server afterward (Ctrl+C).

- [ ] **Step 11: Commit**

```bash
git add apps/api
git commit -m "feat(api): scaffold NestJS app with DB-backed /health"
```

---

## Task 7: Password hashing service (unit TDD)

**Files:**
- Create: `apps/api/src/auth/password.service.ts`
- Test: `apps/api/src/auth/password.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/auth/password.service.spec.ts`:

```ts
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes a password to something other than the plaintext', async () => {
    const hash = await service.hash('correct horse');
    expect(hash).not.toBe('correct horse');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifies a correct password against its hash', async () => {
    const hash = await service.hash('correct horse');
    await expect(service.verify('correct horse', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('correct horse');
    await expect(service.verify('wrong horse', hash)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tryout/api test -- password.service`
Expected: FAIL — cannot find module `./password.service`.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/auth/password.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

@Injectable()
export class PasswordService {
  hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, SALT_ROUNDS);
  }

  verify(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tryout/api test -- password.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/password.service.ts apps/api/src/auth/password.service.spec.ts
git commit -m "feat(auth): add bcrypt password service"
```

---

## Task 8: Auth DTOs + AuthService (signup/login)

**Files:**
- Create: `apps/api/src/auth/dto/signup.dto.ts`
- Create: `apps/api/src/auth/dto/login.dto.ts`
- Create: `apps/api/src/auth/auth.service.ts`

The AuthService is exercised end-to-end by the e2e test in Task 11, so this task has no separate unit test (the DB dependency makes an integration-level test the honest one).

- [ ] **Step 1: Create the signup DTO**

Create `apps/api/src/auth/dto/signup.dto.ts`:

```ts
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
```

- [ ] **Step 2: Create the login DTO**

Create `apps/api/src/auth/dto/login.dto.ts`:

```ts
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
```

- [ ] **Step 3: Implement the AuthService**

Create `apps/api/src/auth/auth.service.ts`:

```ts
import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { AuthResponse, PublicUser } from '@tryout/shared';
import { DRIZZLE } from '../db/db.module';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  async signup(email: string, password: string): Promise<AuthResponse> {
    const normalized = email.toLowerCase().trim();
    const existing = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, normalized))
      .limit(1);

    if (existing.length > 0) {
      // Generic message — do not confirm whether the email is registered (spec §7).
      throw new ConflictException('Unable to create an account with those details.');
    }

    const passwordHash = await this.passwords.hash(password);
    const [user] = await this.db
      .insert(schema.users)
      .values({ email: normalized, passwordHash })
      .returning();

    return this.toAuthResponse(user.id, user.email, user.createdAt);
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const normalized = email.toLowerCase().trim();
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, normalized))
      .limit(1);

    const ok =
      user?.passwordHash != null &&
      (await this.passwords.verify(password, user.passwordHash));

    if (!ok) {
      // Same message for "no such user" and "wrong password" — no enumeration.
      throw new UnauthorizedException('Invalid email or password.');
    }

    return this.toAuthResponse(user.id, user.email, user.createdAt);
  }

  private async toAuthResponse(
    id: string,
    email: string,
    createdAt: Date,
  ): Promise<AuthResponse> {
    const token = await this.jwt.signAsync({ sub: id, email });
    const publicUser: PublicUser = {
      id,
      email,
      createdAt: createdAt.toISOString(),
    };
    return { token, user: publicUser };
  }
}
```

- [ ] **Step 4: Type-check the new code**

Run: `pnpm --filter @tryout/api build`
Expected: compiles with no TS errors (AuthService not yet wired into a module — that's Task 10).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/dto apps/api/src/auth/auth.service.ts
git commit -m "feat(auth): add signup/login DTOs and AuthService"
```

---

## Task 9: JWT guard + current-user decorator

**Files:**
- Create: `apps/api/src/auth/jwt-auth.guard.ts`
- Create: `apps/api/src/auth/current-user.decorator.ts`

- [ ] **Step 1: Create the guard**

Create `apps/api/src/auth/jwt-auth.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface AuthUser {
  sub: string;
  email: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token.');
    }
    const token = header.slice('Bearer '.length);
    try {
      const payload = await this.jwt.verifyAsync<AuthUser>(token);
      (req as Request & { user?: AuthUser }).user = {
        sub: payload.sub,
        email: payload.email,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }
  }
}
```

- [ ] **Step 2: Create the current-user decorator**

Create `apps/api/src/auth/current-user.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './jwt-auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
    return req.user;
  },
);
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @tryout/api build`
Expected: compiles with no TS errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth/jwt-auth.guard.ts apps/api/src/auth/current-user.decorator.ts
git commit -m "feat(auth): add JWT guard and current-user decorator"
```

---

## Task 10: Auth controller + module wiring

**Files:**
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create the controller**

Create `apps/api/src/auth/auth.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type { AuthResponse } from '@tryout/shared';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard, type AuthUser } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  signup(@Body() dto: SignupDto): Promise<AuthResponse> {
    return this.auth.signup(dto.email, dto.password);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return { id: user.sub, email: user.email };
  }
}
```

- [ ] **Step 2: Create the auth module**

Create `apps/api/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: env.jwtSecret(),
        signOptions: { expiresIn: env.jwtExpiresIn },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, JwtAuthGuard],
})
export class AuthModule {}
```

- [ ] **Step 3: Wire AuthModule into the app**

Replace the contents of `apps/api/src/app.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [DbModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 4: Build to confirm wiring compiles**

Run: `pnpm --filter @tryout/api build`
Expected: no TS errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.module.ts apps/api/src/app.module.ts
git commit -m "feat(auth): add auth controller and wire AuthModule"
```

---

## Task 11: Auth E2E round trip (integration test)

**Files:**
- Create: `apps/api/test/jest-e2e.config.ts`
- Create: `apps/api/test/auth.e2e-spec.ts`

This is the M0 verification gate: sign up → log in → call an authenticated route, against a real Postgres.

- [ ] **Step 1: Create the e2e Jest config**

Create `apps/api/test/jest-e2e.config.ts`:

```ts
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  testTimeout: 20000,
};

export default config;
```

- [ ] **Step 2: Write the e2e test**

Create `apps/api/test/auth.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  // Unique email per run so the test is repeatable without DB cleanup.
  const email = `m0-${Date.now()}@example.com`;
  const password = 'sup3r-secret-pw';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects signup with a short password (400)', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'short' })
      .expect(400);
  });

  let token: string;

  it('signs up a new user and returns a token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(201);

    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(email);
    token = res.body.token;
  });

  it('rejects duplicate signup without enumerating (409)', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(409);
  });

  it('logs in with correct credentials (200)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects login with wrong password (401)', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'nope-nope-nope' })
      .expect(401);
  });

  it('rejects /auth/me without a token (401)', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('returns the current user with a valid token (200)', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.email).toBe(email);
  });
});
```

- [ ] **Step 3: Run the e2e suite against local Postgres**

Ensure infra is up and the migration is applied. Run (one line):
`DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout JWT_SECRET=dev pnpm --filter @tryout/api test:e2e`
Expected: all 7 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test
git commit -m "test(api): add auth signup/login/me e2e round trip"
```

---

## Task 12: Next.js app scaffold

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/lib/api.ts`

> **Before writing any UI in this and the next task, read the `frontend-design` skill** (spec hard rule 3). The auth screens must look intentional, not like a default template. The CSS below is a starting token set, not the finished design — apply the skill's guidance.

- [ ] **Step 1: Create the package manifest**

Create `apps/web/package.json`:

```json
{
  "name": "@tryout/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "test": "echo \"no tests\" && exit 0"
  },
  "dependencies": {
    "@tryout/shared": "workspace:*",
    "next": "^14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 2: Create Next + TS config**

Create `apps/web/next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@tryout/shared'],
};

export default nextConfig;
```

Create `apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create the typed API client**

Create `apps/web/src/lib/api.ts`:

```ts
import type { AuthResponse } from '@tryout/shared';

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

export const api = {
  signup: (email: string, password: string) =>
    post<AuthResponse>('/auth/signup', { email, password }),
  login: (email: string, password: string) =>
    post<AuthResponse>('/auth/login', { email, password }),
};
```

- [ ] **Step 4: Create the root layout and design tokens**

Create `apps/web/src/app/globals.css`:

```css
:root {
  --color-surface: oklch(98% 0.01 250);
  --color-text: oklch(22% 0.02 260);
  --color-muted: oklch(55% 0.02 260);
  --color-accent: oklch(58% 0.18 265);
  --color-danger: oklch(55% 0.2 25);
  --radius: 12px;
  --space: clamp(1rem, 0.8rem + 1vw, 1.5rem);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: var(--color-text);
  background: var(--color-surface);
}
```

Create `apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tryout',
  description: 'Do the job, not watch it.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: Create the index redirect**

Create `apps/web/src/app/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/login');
}
```

- [ ] **Step 6: Install and build**

Run: `pnpm install`
Then run: `pnpm --filter @tryout/web build`
Expected: Next build succeeds (it will warn there are no `/login` or `/signup` routes yet — that's fine; they arrive in Task 13). If the build fails because `/login` does not exist, proceed to Task 13 and run the build at its end instead.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): scaffold Next.js app shell and API client"
```

---

## Task 13: Auth UI (login + signup screens)

**Files:**
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/src/app/signup/page.tsx`

> Read the `frontend-design` skill first. The markup below is functional and accessible but deliberately minimal — apply the skill to give it intentional hierarchy, type, and state styling. Do not ship it as-is if it looks like a default form.

- [ ] **Step 1: Create the login page**

Create `apps/web/src/app/login/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.login(email, password);
      localStorage.setItem('tryout_token', res.token);
      window.location.href = '/';
    } catch {
      setError('Invalid email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '10vh auto', padding: 'var(--space)' }}>
      <h1>Welcome back</h1>
      <form onSubmit={onSubmit} aria-label="Log in">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          required
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          required
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Log in'}
        </button>
      </form>
      <p>
        New here? <Link href="/signup">Create an account</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Create the signup page**

Create `apps/web/src/app/signup/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.signup(email, password);
      localStorage.setItem('tryout_token', res.token);
      window.location.href = '/';
    } catch {
      setError('Unable to create an account with those details.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '10vh auto', padding: 'var(--space)' }}>
      <h1>Join Tryout</h1>
      <form onSubmit={onSubmit} aria-label="Sign up">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          required
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="password">Password (min 8 characters)</label>
        <input
          id="password"
          type="password"
          value={password}
          required
          minLength={8}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Build the web app**

Run: `pnpm --filter @tryout/web build`
Expected: build succeeds, `/login` and `/signup` routes compile.

- [ ] **Step 4: Manual smoke test (full stack)**

Start the API (Task 6 Step 10 command) and infra, then in another terminal run:
`NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm --filter @tryout/web dev`
Open `http://localhost:3000`, get redirected to `/login`, click through to `/signup`, create an account.
Expected: redirect to `/`, and a `tryout_token` value present in `localStorage`. Stop both servers afterward.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/login apps/web/src/app/signup
git commit -m "feat(web): add login and signup screens"
```

---

## Task 14: Cloud Run deployability (Dockerfiles)

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `apps/web/Dockerfile`

- [ ] **Step 1: Create the API Dockerfile**

Create `apps/api/Dockerfile`:

```dockerfile
# Build the API from the monorepo root context.
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tryout/shared build \
  && pnpm --filter @tryout/db build \
  && pnpm --filter @tryout/api build
RUN pnpm --filter @tryout/api --prod deploy /out

FROM node:20-slim AS run
WORKDIR /app
COPY --from=build /out ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/main.js"]
```

- [ ] **Step 2: Create the web Dockerfile**

Create `apps/web/Dockerfile`:

```dockerfile
# Build the web app (Next standalone output) from the monorepo root context.
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tryout/shared build && pnpm --filter @tryout/web build

FROM node:20-slim AS run
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
ENV PORT=8080
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
```

> Note: the web Dockerfile assumes `output: 'standalone'` (set in Task 12). If `apps/web/public` does not exist, create an empty `apps/web/public/.gitkeep` so the `COPY` succeeds.

- [ ] **Step 3: Build the API image locally**

Run: `docker build -f apps/api/Dockerfile -t tryout-api .`
Expected: image builds successfully through all stages.

- [ ] **Step 4: Smoke-test the API image against local Postgres**

Run (one line; `host.docker.internal` reaches the host's Postgres):
`docker run --rm -e PORT=8080 -e DATABASE_URL=postgres://tryout:tryout@host.docker.internal:5432/tryout -e JWT_SECRET=dev -p 8080:8080 tryout-api`
In another terminal: `curl -s http://localhost:8080/health`
Expected: `{"status":"ok"}`. Stop the container afterward.

- [ ] **Step 5: Build the web image locally**

Run: `docker build -f apps/web/Dockerfile -t tryout-web .`
Expected: image builds successfully.

- [ ] **Step 6: Commit**

```bash
git add apps/api/Dockerfile apps/web/Dockerfile apps/web/public/.gitkeep
git commit -m "chore: add Cloud Run Dockerfiles for api and web"
```

---

## Task 15: Repo housekeeping (move source docs into place)

**Files:**
- Move: `scenario-01-archive-tasks.md` → `scenarios/scenario-01-archive-tasks.md`
- Create: `templates/.gitkeep`
- Move: `team-sim-spec-v1.md` → `docs/team-sim-spec-v1.md`

Aligns the working tree with the monorepo layout from the spec (§3). The scenario and template directories become their canonical homes; the build spec moves under `docs/`.

- [ ] **Step 1: Move the scenario into `scenarios/`**

```bash
mkdir -p scenarios templates docs
git mv scenario-01-archive-tasks.md scenarios/scenario-01-archive-tasks.md
```

- [ ] **Step 2: Reserve the templates directory**

Create `templates/.gitkeep` (empty file). The `lumi-tasks-api` template source lands here at M1.

- [ ] **Step 3: Move the build spec under docs/**

```bash
git mv team-sim-spec-v1.md docs/team-sim-spec-v1.md
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: move scenario and build spec into monorepo layout"
```

---

## M0 Verification Gate

Run before declaring M0 complete (mirrors spec §8). All must pass:

- [ ] `pnpm install` clean from root.
- [ ] `pnpm -r build` succeeds for every package and app.
- [ ] `docker compose up -d` → both services report `(healthy)`.
- [ ] `pnpm --filter @tryout/db migrate` applies cleanly; `\dt` shows all 9 tables.
- [ ] `pnpm --filter @tryout/api test` passes (PasswordService unit tests).
- [ ] `pnpm --filter @tryout/api test:e2e` passes (signup → login → /auth/me round trip) against real Postgres.
- [ ] `curl http://localhost:3001/health` → `{"status":"ok"}` with a real DB connection.
- [ ] `docker build` succeeds for both `apps/api/Dockerfile` and `apps/web/Dockerfile`, and the API image serves `/health`.
- [ ] Web app: visiting `/` redirects to `/login`; a user can sign up and a token is stored.

**Explicitly out of M0 (do not build here):** agents, GitHub plumbing, scenarios runtime, grading — these are M1–M4, each with its own spec → plan cycle.
