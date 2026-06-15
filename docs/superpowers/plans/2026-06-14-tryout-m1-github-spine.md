# Tryout M1 — GitHub Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a template repo on GitHub, instantiate a per-user repo when a user starts a scenario run, then poll GitHub to detect when they open a PR and read its CI status and diff — no agents, no UI polish, just proven plumbing.

**Architecture:** A NestJS `GitHubService` (Octokit wrapper) handles all GitHub API calls. Two BullMQ processors — `poll-pr` and `poll-ci` — run as self-rescheduling jobs in the Redis queue already in the infra. A new `ScenarioRunModule` owns the `POST /scenario-runs` endpoint that wires everything together: creates DB records, calls GitHub, enqueues the polling chain. The existing `@tryout/db` schema already has all necessary tables (ScenarioRun, Repo, Submission); this milestone writes the first real rows into them.

**Tech Stack:** `@octokit/rest` for GitHub API, `@nestjs/bullmq` + `bullmq` for job queue (Redis already running), `tsx` for the one-time DB seed script, GitHub PAT (Personal Access Token) with `repo` scope stored as `GITHUB_TOKEN` env var.

**Source spec:** `docs/team-sim-spec-v1.md` §11 (M1), `scenarios/scenario-01-archive-tasks.md` §B (template repo files), `docs/team-sim-spec-v1.md` §5 (GitHub App decision).

**Conventions:**
- All commands run from repo root (`H:\TRYOUT`) unless a step says otherwise.
- GitHub PAT is used for M1 (simpler setup); the abstraction is thin enough to swap to a GitHub App token at M2+ without touching callers.
- Polling interval: 30 s for PR detection, 60 s for CI status. These are `POLL_PR_INTERVAL_MS` / `POLL_CI_INTERVAL_MS` env vars with defaults.
- The `poll-pr` and `poll-ci` processors self-reschedule (re-enqueue with a delay) when the condition isn't met yet; they stop rescheduling when done.
- Maximum polls before giving up: 120 (1 hour for PR detection at 30 s; 2 hours for CI at 60 s). After that, the job is abandoned silently for M1 (error handling comes later).

---

## Prerequisites (one-time human setup — not automated by this plan)

Before any task in this plan can be tested end to end, a human must:

1. **Create a GitHub account or organisation** that will own the template and per-user repos (e.g. `tryout-dev`). Note the owner name as `GITHUB_OWNER`.

2. **Create a GitHub Personal Access Token** with `repo` scope (full control of private repositories) at `github.com → Settings → Developer settings → Personal access tokens → Fine-grained` or classic. Note it as `GITHUB_TOKEN`.

3. **Push the `lumi-tasks-api` template** to GitHub after Task 1 completes:
   ```bash
   cd templates/lumi-tasks-api
   git init && git add . && git commit -m "chore: initial lumi-tasks-api template"
   git remote add origin https://github.com/<GITHUB_OWNER>/lumi-tasks-api.git
   git push -u origin main
   ```
   Then go to the repo on GitHub → Settings → check **"Template repository"**.

4. **Copy `.env.example` to `.env`** in the repo root and fill in the GitHub values added in Task 2.

5. **Run the DB seed** after Task 3 completes:
   ```bash
   DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/db seed
   ```

---

## File Structure

Files created or modified in this plan, by responsibility:

```
templates/lumi-tasks-api/             ← NEW — the scenario template repo
├── .github/workflows/ci.yml
├── README.md
├── nest-cli.json
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   └── tasks/
│       ├── tasks.module.ts
│       ├── tasks.controller.ts
│       ├── tasks.service.ts
│       ├── task.entity.ts
│       └── dto/
│           ├── create-task.dto.ts
│           └── update-task.dto.ts
└── test/
    └── tasks.e2e-spec.ts

packages/db/
├── package.json                      ← MODIFY — add tsx devDep + seed script
└── src/seeds/
    └── seed-scenario-01.ts           ← NEW — idempotent seed for Track + Scenario

apps/api/
├── package.json                      ← MODIFY — add @octokit/rest, @nestjs/bullmq, bullmq
├── src/
│   ├── config/env.ts                 ← MODIFY — add GitHub + Redis vars
│   ├── app.module.ts                 ← MODIFY — import GitHubModule, QueueModule, ScenarioRunsModule
│   ├── github/
│   │   ├── github.module.ts          ← NEW
│   │   └── github.service.ts         ← NEW — Octokit wrapper
│   ├── queue/
│   │   ├── queue.module.ts           ← NEW — BullMQ connection + queue registration
│   │   ├── queue.constants.ts        ← NEW — queue name constants + job data types
│   │   ├── queue.service.ts          ← NEW — enqueue helpers
│   │   └── processors/
│   │       ├── poll-pr.processor.ts  ← NEW — detect PR, create Submission, trigger poll-ci
│   │       └── poll-ci.processor.ts  ← NEW — update CI status on Submission
│   └── scenario-runs/
│       ├── scenario-runs.module.ts   ← NEW
│       ├── scenario-runs.controller.ts ← NEW — POST /scenario-runs, GET /scenario-runs/:id
│       └── scenario-runs.service.ts  ← NEW — orchestrates DB + GitHub + queue
└── src/github/github.service.spec.ts ← NEW — unit tests (mocked Octokit)

.env.example                          ← MODIFY — add GITHUB_TOKEN, GITHUB_OWNER, etc.
```

---

## Task 1: Scaffold `templates/lumi-tasks-api/`

The NestJS template repo the user will work in. Every file here is committed to the `lumi-tasks-api` GitHub repo and cloned into per-user repos. The hidden acceptance suite (Section C of the scenario) is **NOT** included here.

**Files:**
- Create: `templates/lumi-tasks-api/package.json`
- Create: `templates/lumi-tasks-api/tsconfig.json`
- Create: `templates/lumi-tasks-api/nest-cli.json`
- Create: `templates/lumi-tasks-api/.github/workflows/ci.yml`
- Create: `templates/lumi-tasks-api/README.md`
- Create: `templates/lumi-tasks-api/src/main.ts`
- Create: `templates/lumi-tasks-api/src/app.module.ts`
- Create: `templates/lumi-tasks-api/src/tasks/task.entity.ts`
- Create: `templates/lumi-tasks-api/src/tasks/dto/create-task.dto.ts`
- Create: `templates/lumi-tasks-api/src/tasks/dto/update-task.dto.ts`
- Create: `templates/lumi-tasks-api/src/tasks/tasks.service.ts`
- Create: `templates/lumi-tasks-api/src/tasks/tasks.controller.ts`
- Create: `templates/lumi-tasks-api/src/tasks/tasks.module.ts`
- Create: `templates/lumi-tasks-api/test/tasks.e2e-spec.ts`

- [ ] **Step 1: Create package.json**

Create `templates/lumi-tasks-api/package.json`:

```json
{
  "name": "lumi-tasks-api",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start:dev": "nest start --watch",
    "build": "nest build",
    "test": "jest --config jest.config.json --forceExit",
    "lint": "eslint \"{src,test}/**/*.ts\""
  },
  "dependencies": {
    "@nestjs/common": "^10.4.1",
    "@nestjs/core": "^10.4.1",
    "@nestjs/platform-express": "^10.4.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.4",
    "@nestjs/testing": "^10.4.1",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.4",
    "typescript": "^5.5.4"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": ".",
    "testRegex": ".*\\.e2e-spec\\.ts$",
    "transform": { "^.+\\.ts$": "ts-jest" },
    "testEnvironment": "node",
    "testTimeout": 15000
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `templates/lumi-tasks-api/tsconfig.json`:

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
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./"
  },
  "include": ["src", "test"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create nest-cli.json**

Create `templates/lumi-tasks-api/nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

- [ ] **Step 4: Create CI workflow**

Create `templates/lumi-tasks-api/.github/workflows/ci.yml`:

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
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint --if-present
      - run: npm test
```

- [ ] **Step 5: Create README.md**

Create `templates/lumi-tasks-api/README.md`:

```markdown
# Lumi Tasks API

The backend service that owns the **Tasks** resource for Lumi.

## Stack
- NestJS (TypeScript)
- In-memory store (no database — data resets on restart)
- Jest + Supertest for tests

## Run locally
```bash
npm ci
npm run start:dev
```
API is served at http://localhost:3000.

## Test
```bash
npm test
```

## Architecture
The Tasks resource follows the standard NestJS layering:
- `tasks.controller.ts` — HTTP routes
- `tasks.service.ts` — business logic + the in-memory store
- `task.entity.ts` — the Task shape
- `dto/` — request validation (class-validator)

## Current API
| Method | Route      | Description    |
|--------|------------|----------------|
| GET    | /tasks     | List all tasks |
| GET    | /tasks/:id | Get one task   |
| POST   | /tasks     | Create a task  |
| PATCH  | /tasks/:id | Update a task  |
| DELETE | /tasks/:id | Delete a task  |

## Conventions
- Validate input with DTOs + `class-validator`.
- Throw `NotFoundException` for missing resources.
- Add/extend tests in `test/` following the existing e2e pattern.
```

- [ ] **Step 6: Create src files**

Create `templates/lumi-tasks-api/src/tasks/task.entity.ts`:

```ts
export interface Task {
  id: string;
  title: string;
  description: string | null;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

Create `templates/lumi-tasks-api/src/tasks/dto/create-task.dto.ts`:

```ts
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsOptional()
  description?: string;
}
```

Create `templates/lumi-tasks-api/src/tasks/dto/update-task.dto.ts`:

```ts
import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class UpdateTaskDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  completed?: boolean;
}
```

Create `templates/lumi-tasks-api/src/tasks/tasks.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Task } from './task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  private tasks: Task[] = [];

  findAll(): Task[] {
    return this.tasks;
  }

  findOne(id: string): Task {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    return task;
  }

  create(dto: CreateTaskDto): Task {
    const now = new Date();
    const task: Task = {
      id: randomUUID(),
      title: dto.title,
      description: dto.description ?? null,
      completed: false,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.push(task);
    return task;
  }

  update(id: string, dto: UpdateTaskDto): Task {
    const task = this.findOne(id);
    if (dto.title !== undefined) task.title = dto.title;
    if (dto.description !== undefined) task.description = dto.description;
    if (dto.completed !== undefined) task.completed = dto.completed;
    task.updatedAt = new Date();
    return task;
  }

  remove(id: string): void {
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) throw new NotFoundException(`Task ${id} not found`);
    this.tasks.splice(index, 1);
  }
}
```

Create `templates/lumi-tasks-api/src/tasks/tasks.controller.ts`:

```ts
import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  findAll() { return this.tasksService.findAll(); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.tasksService.findOne(id); }

  @Post()
  create(@Body() dto: CreateTaskDto) { return this.tasksService.create(dto); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) { this.tasksService.remove(id); }
}
```

Create `templates/lumi-tasks-api/src/tasks/tasks.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
```

Create `templates/lumi-tasks-api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TasksModule } from './tasks/tasks.module';

@Module({ imports: [TasksModule] })
export class AppModule {}
```

Create `templates/lumi-tasks-api/src/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.listen(3000);
}

bootstrap();
```

- [ ] **Step 7: Create the e2e test**

Create `templates/lumi-tasks-api/test/tasks.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Tasks (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  it('creates a task', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks').send({ title: 'Write tests' }).expect(201);
    expect(res.body).toMatchObject({ title: 'Write tests', completed: false });
    expect(res.body.id).toBeDefined();
  });

  it('lists created tasks', async () => {
    await request(app.getHttpServer()).post('/tasks').send({ title: 'A' });
    await request(app.getHttpServer()).post('/tasks').send({ title: 'B' });
    const res = await request(app.getHttpServer()).get('/tasks').expect(200);
    expect(res.body.length).toBe(2);
  });

  it('returns 404 for a missing task', async () => {
    await request(app.getHttpServer()).get('/tasks/does-not-exist').expect(404);
  });

  it('rejects a task with no title', async () => {
    await request(app.getHttpServer()).post('/tasks').send({}).expect(400);
  });
});
```

- [ ] **Step 8: Install deps and run the template's tests**

Run from the template directory:

```bash
cd templates/lumi-tasks-api && npm ci && npm test
```

Expected: 4 tests PASS. Then return to repo root:

```bash
cd ../..
```

- [ ] **Step 9: Commit**

```bash
git add templates/lumi-tasks-api
git commit -m "feat(template): scaffold lumi-tasks-api NestJS template repo"
```

---

## Task 2: Extend env config + `.env.example`

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Extend env.ts**

Replace the contents of `apps/api/src/config/env.ts`:

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
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  githubToken: () => required('GITHUB_TOKEN'),
  githubOwner: () => required('GITHUB_OWNER'),
  githubTemplateRepo: process.env.GITHUB_TEMPLATE_REPO ?? 'lumi-tasks-api',
  pollPrIntervalMs: Number(process.env.POLL_PR_INTERVAL_MS ?? 30_000),
  pollCiIntervalMs: Number(process.env.POLL_CI_INTERVAL_MS ?? 60_000),
  pollMaxAttempts: Number(process.env.POLL_MAX_ATTEMPTS ?? 120),
};
```

- [ ] **Step 2: Extend .env.example**

Replace the contents of `.env.example`:

```
# API
PORT=3001
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-only-change-me
JWT_EXPIRES_IN=7d

# Web
NEXT_PUBLIC_API_URL=http://localhost:3001

# GitHub integration (M1+)
# Create a PAT at github.com → Settings → Developer settings → Personal access tokens
# Required scopes: repo (full control of private repositories)
GITHUB_TOKEN=ghp_replace_me
GITHUB_OWNER=your-github-org-or-user
GITHUB_TEMPLATE_REPO=lumi-tasks-api

# Polling intervals (optional — defaults shown)
POLL_PR_INTERVAL_MS=30000
POLL_CI_INTERVAL_MS=60000
POLL_MAX_ATTEMPTS=120
```

- [ ] **Step 3: Build to confirm no type errors**

```bash
pnpm --filter @tryout/api build
```

Expected: compiles with no TS errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/config/env.ts .env.example
git commit -m "feat(config): add GitHub and Redis env vars"
```

---

## Task 3: DB seed — Track + Scenario-01

Seeds the `tracks` and `scenarios` tables idempotently. Run once after migrations. The scenario definition JSONB contains everything agents and the grader will need in later milestones.

**Files:**
- Modify: `packages/db/package.json`
- Create: `packages/db/src/seeds/seed-scenario-01.ts`

- [ ] **Step 1: Add tsx devDep and seed script to packages/db**

Replace `packages/db/package.json`:

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
    "seed": "tsx src/seeds/seed-scenario-01.ts",
    "test": "echo \"no tests\" && exit 0"
  },
  "dependencies": {
    "drizzle-orm": "^0.33.0",
    "postgres": "^3.4.4"
  },
  "devDependencies": {
    "drizzle-kit": "^0.24.2",
    "tsx": "^4.15.0"
  }
}
```

- [ ] **Step 2: Create the seed script**

Create `packages/db/src/seeds/seed-scenario-01.ts`:

```ts
import { eq } from 'drizzle-orm';
import { createDb } from '../client';
import { tracks, scenarios } from '../schema';

const db = createDb(
  process.env.DATABASE_URL ?? 'postgres://tryout:tryout@localhost:5432/tryout',
);

const SCENARIO_DEFINITION = {
  id: 'scenario-01-archive-tasks',
  track: 'backend',
  title: 'Add the ability to archive tasks',
  version: 1,
  difficulty: 'intro',
  estimated_minutes: 60,
  company_context: {
    name: 'Lumi',
    product:
      'Lumi is a lightweight personal productivity app. Users create tasks, mark them complete, and want to keep their list focused on what\'s active.',
    team: 'A small product team. You\'re a new backend engineer. The codebase is a NestJS REST API that owns the Tasks resource.',
    user_role: 'Backend Engineer (new hire, first ticket)',
  },
  repo: {
    template_ref: 'lumi-tasks-api',
    default_branch: 'main',
    ci: 'github-actions',
  },
  ticket: {
    id: 'LUMI-142',
    title: 'Let users archive completed tasks',
    body: 'Users have asked for a way to archive tasks they\'re done with so their task list stays clean and focused on what\'s still active.\n\nPlease add an archive endpoint: POST /tasks/:id/archive\n\nKeep it consistent with how the rest of our Tasks API is built.',
  },
  clarifications: [
    {
      id: 'exclude-from-default-list',
      the_gap: 'The ticket says the list should "stay clean" but never says archived tasks should be hidden from GET /tasks, or how to still retrieve them.',
      good_question_signals: [
        'Should archived tasks be excluded from the default GET /tasks?',
        'How should someone still see their archived tasks if needed?',
      ],
      canonical_answer:
        'Yes — exclude archived tasks from GET /tasks by default. But nothing should be lost: support GET /tasks?includeArchived=true to include them.',
      has_technical_consequence: true,
    },
    {
      id: 'unarchive-needed',
      the_gap: 'The ticket only mentions archiving. It never says whether users can restore an archived task.',
      good_question_signals: [
        'Do users need to un-archive / restore a task?',
        'Is archive reversible?',
      ],
      canonical_answer: 'Yes — users need to restore tasks. Add POST /tasks/:id/unarchive.',
      has_technical_consequence: true,
    },
    {
      id: 'archive-vs-delete',
      the_gap: 'Confirming archive is a soft state, not a deletion.',
      good_question_signals: [
        "Archiving shouldn't delete the task, right? It's still retrievable directly?",
      ],
      canonical_answer:
        "Correct — archiving is a soft state. The task still exists and is retrievable at GET /tasks/:id. It's just hidden from the default list.",
      has_technical_consequence: true,
    },
  ],
  injected_events: [
    {
      id: 'scope-change-priority',
      type: 'scope_change',
      enabled: false,
      trigger: 'after first PR is opened',
      pm_message:
        'Quick change from product — can archived tasks also be sorted to the bottom when includeArchived=true is used, rather than mixed in? Small tweak, but they want active tasks on top.',
    },
  ],
  agents: {
    pm: { persona_ref: 'pm-mai' },
    senior: { persona_ref: 'senior-alex' },
  },
  rubric_ref: 'rubric-scenario-01',
  grading: {
    hidden_acceptance_suite: 'test/archive.acceptance.spec.ts',
  },
  ground_truth: {
    solution_notes:
      'A complete solution adds soft-archive state (archived boolean or archivedAt timestamp), POST /tasks/:id/archive (200/204, 404 if missing), POST /tasks/:id/unarchive (404 if missing), GET /tasks excludes archived by default, GET /tasks?includeArchived=true includes them, GET /tasks/:id always returns the task. Logic lives in the service, not the controller.',
    red_flags: [
      'archive implemented as hard delete',
      'archived tasks leaking into default list',
      'no un-archive endpoint',
      'business logic in the controller',
      'no new tests',
    ],
  },
  agent_prompts: {
    pm_mai: {
      system:
        "You are Mai, the Product Manager at Lumi. You are friendly, busy, and practical. You assigned ticket LUMI-142 to a new backend engineer.\n\nBehavior:\n- If the engineer asks a clarifying question, answer it directly using the canonical answers below. Reward good questions with a clear, useful answer.\n- If they ask something the ticket already covers, answer briefly.\n- Do NOT volunteer the answers to the consequential clarifications unless asked.\n- Stay in scope. You're a PM, not an engineer: don't give implementation details.\n- Keep replies short and natural, like real Slack messages.\n\nCanonical answers (only when asked):\n- Excluding archived from the default list: \"Yes, hide archived tasks from the main list by default. But don't lose them — let people pass ?includeArchived=true to see them.\"\n- Un-archive: \"Good catch — yes, people need to restore tasks. Add an un-archive too.\"\n- Archive vs delete: \"Right, archiving doesn't delete anything. The task should still be there if you fetch it directly.\"",
    },
    senior_alex: {
      system:
        'You are Alex, a senior backend engineer at Lumi. You communicate in clear, professional, slightly terse async English.\n\nTwo modes:\n1) CHAT: Help them think; do NOT hand over the solution. Point at the relevant file or pattern, ask what they\'ve tried, give a nudge. If they ask about list behaviour, redirect them to confirm with Mai.\n2) PR REVIEW: Leave specific, constructive comments tied to the code. Request changes at least once on the first submission. Catch incompleteness (missing un-archive, archived tasks leaking, no includeArchived support) and call it out clearly. Approve once the feature is complete and conventions respected.',
    },
  },
  rubric: {
    technical: {
      weight: 0.5,
      criteria: [
        { id: 'acceptance_tests_pass', weight: 0.4, description: 'Hidden suite passes on the final branch.' },
        { id: 'correctness', weight: 0.25, description: 'Default-list exclusion, includeArchived, un-archive, 404s all handled.' },
        { id: 'conventions', weight: 0.2, description: 'Logic in the service; DTO/validation patterns respected; idiomatic NestJS.' },
        { id: 'own_tests', weight: 0.15, description: 'New tests cover the feature, following the existing e2e pattern.' },
      ],
    },
    professional: {
      weight: 0.5,
      criteria: [
        { id: 'surfaced_ambiguity', weight: 0.3, description: 'Asked the PM at least one consequential clarifying question before implementation.' },
        { id: 'pr_description', weight: 0.2, description: 'Explains what changed and why; states assumptions.' },
        { id: 'response_to_review', weight: 0.25, description: 'Incorporated feedback constructively; not defensive; no silent force-push.' },
        { id: 'communication_clarity', weight: 0.15, description: 'Messages to PM/Senior are clear, specific, and respectful.' },
        { id: 'help_seeking_judgment', weight: 0.1, description: 'Used the Senior appropriately — neither silent nor asked for the answer.' },
      ],
    },
  },
};

async function seed() {
  console.log('Seeding Track: backend...');
  const existingTrack = await db
    .select()
    .from(tracks)
    .where(eq(tracks.name, 'backend'))
    .limit(1);

  let trackId: string;
  if (existingTrack.length > 0) {
    trackId = existingTrack[0].id;
    console.log(`  Track already exists (id=${trackId}), skipping insert.`);
  } else {
    const [track] = await db.insert(tracks).values({ name: 'backend' }).returning();
    trackId = track.id;
    console.log(`  Inserted track id=${trackId}`);
  }

  console.log('Seeding Scenario 01...');
  const existingScenario = await db
    .select()
    .from(scenarios)
    .where(eq(scenarios.title, SCENARIO_DEFINITION.title))
    .limit(1);

  if (existingScenario.length > 0) {
    console.log(`  Scenario already exists (id=${existingScenario[0].id}), skipping insert.`);
  } else {
    const [scenario] = await db
      .insert(scenarios)
      .values({
        trackId,
        title: SCENARIO_DEFINITION.title,
        version: SCENARIO_DEFINITION.version,
        definition: SCENARIO_DEFINITION,
        status: 'active',
      })
      .returning();
    console.log(`  Inserted scenario id=${scenario.id}`);
  }

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Install tsx and verify the package builds**

```bash
pnpm install
pnpm --filter @tryout/db build
```

Expected: install succeeds; build emits `dist/` with no TS errors.

- [ ] **Step 4: Run the seed against local Postgres**

Ensure infra is up (`docker compose ps`), then:

```bash
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/db seed
```

Expected output:
```
Seeding Track: backend...
  Inserted track id=<uuid>
Seeding Scenario 01...
  Inserted scenario id=<uuid>
Seed complete.
```

Run again to verify idempotency:

```bash
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/db seed
```

Expected: both lines say "already exists, skipping insert."

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): add seed script for Track and Scenario-01"
```

---

## Task 4: GitHub module + service (Octokit wrapper)

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/github/github.module.ts`
- Create: `apps/api/src/github/github.service.ts`
- Create: `apps/api/src/github/github.service.spec.ts`

- [ ] **Step 1: Add Octokit dependency**

Edit `apps/api/package.json` — add to `"dependencies"`:

```json
"@octokit/rest": "^20.1.1"
```

Run:

```bash
pnpm install
```

Expected: `@octokit/rest` installed in the API workspace.

- [ ] **Step 2: Write the failing unit tests first**

Create `apps/api/src/github/github.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { GitHubService } from './github.service';

const mockOctokit = {
  rest: {
    repos: {
      createUsingTemplate: jest.fn(),
    },
    pulls: {
      list: jest.fn(),
      get: jest.fn(),
    },
    checks: {
      listForRef: jest.fn(),
    },
  },
};

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => mockOctokit),
}));

describe('GitHubService', () => {
  let service: GitHubService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: GitHubService,
          useFactory: () =>
            new GitHubService('fake-token', 'test-owner', 'lumi-tasks-api'),
        },
      ],
    }).compile();
    service = moduleRef.get(GitHubService);
  });

  describe('createRepoFromTemplate', () => {
    it('calls createUsingTemplate with the correct params and returns the repo URL', async () => {
      mockOctokit.rest.repos.createUsingTemplate.mockResolvedValue({
        data: { html_url: 'https://github.com/test-owner/lumi-tasks-abc123', full_name: 'test-owner/lumi-tasks-abc123' },
      });

      const result = await service.createRepoFromTemplate('user-id-abc123');

      expect(mockOctokit.rest.repos.createUsingTemplate).toHaveBeenCalledWith({
        template_owner: 'test-owner',
        template_repo: 'lumi-tasks-api',
        owner: 'test-owner',
        name: expect.stringContaining('lumi-tasks-'),
        private: true,
        include_all_branches: false,
      });
      expect(result.htmlUrl).toBe('https://github.com/test-owner/lumi-tasks-abc123');
      expect(result.fullName).toBe('test-owner/lumi-tasks-abc123');
    });
  });

  describe('listOpenPullRequests', () => {
    it('returns open pull requests', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [{ number: 1, head: { sha: 'abc' }, html_url: 'https://github.com/test-owner/repo/pull/1', title: 'My PR' }],
      });

      const result = await service.listOpenPullRequests('test-owner', 'my-repo');

      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'my-repo',
        state: 'open',
      });
      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(1);
      expect(result[0].headSha).toBe('abc');
    });
  });

  describe('getPullRequestDiff', () => {
    it('returns the diff string', async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({ data: 'diff --git a/file b/file\n...' });

      const diff = await service.getPullRequestDiff('test-owner', 'my-repo', 1);

      expect(mockOctokit.rest.pulls.get).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'my-repo',
        pull_number: 1,
        mediaType: { format: 'diff' },
      });
      expect(diff).toContain('diff --git');
    });
  });

  describe('getCheckRuns', () => {
    it('returns check run summaries', async () => {
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { id: 1, name: 'CI', status: 'completed', conclusion: 'success' },
          ],
        },
      });

      const result = await service.getCheckRuns('test-owner', 'my-repo', 'abc123');

      expect(mockOctokit.rest.checks.listForRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'my-repo',
        ref: 'abc123',
      });
      expect(result[0].status).toBe('completed');
      expect(result[0].conclusion).toBe('success');
    });
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL (module not found)**

```bash
pnpm --filter @tryout/api test -- github.service
```

Expected: FAIL — cannot find module `./github.service`.

- [ ] **Step 4: Implement GitHubService**

Create `apps/api/src/github/github.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';

export interface CreatedRepo {
  htmlUrl: string;
  fullName: string;
  repoName: string;
}

export interface PullRequestSummary {
  number: number;
  headSha: string;
  htmlUrl: string;
  title: string;
}

export interface CheckRunSummary {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}

@Injectable()
export class GitHubService {
  private readonly octokit: Octokit;

  constructor(
    private readonly token: string,
    private readonly owner: string,
    private readonly templateRepo: string,
  ) {
    this.octokit = new Octokit({ auth: token });
  }

  async createRepoFromTemplate(userId: string): Promise<CreatedRepo> {
    const repoName = `lumi-tasks-${userId.slice(0, 8)}-${Date.now()}`;
    const response = await this.octokit.rest.repos.createUsingTemplate({
      template_owner: this.owner,
      template_repo: this.templateRepo,
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

  async listOpenPullRequests(owner: string, repo: string): Promise<PullRequestSummary[]> {
    const response = await this.octokit.rest.pulls.list({ owner, repo, state: 'open' });
    return response.data.map((pr) => ({
      number: pr.number,
      headSha: pr.head.sha,
      htmlUrl: pr.html_url,
      title: pr.title,
    }));
  }

  async getPullRequestDiff(owner: string, repo: string, prNumber: number): Promise<string> {
    const response = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: 'diff' },
    });
    return response.data as unknown as string;
  }

  async getCheckRuns(owner: string, repo: string, ref: string): Promise<CheckRunSummary[]> {
    const response = await this.octokit.rest.checks.listForRef({ owner, repo, ref });
    return response.data.check_runs.map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion ?? null,
    }));
  }
}
```

Create `apps/api/src/github/github.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { GitHubService } from './github.service';
import { env } from '../config/env';

@Module({
  providers: [
    {
      provide: GitHubService,
      useFactory: () =>
        new GitHubService(env.githubToken(), env.githubOwner(), env.githubTemplateRepo),
    },
  ],
  exports: [GitHubService],
})
export class GitHubModule {}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
pnpm --filter @tryout/api test -- github.service
```

Expected: PASS (4 tests).

- [ ] **Step 6: Build**

```bash
pnpm --filter @tryout/api build
```

Expected: no TS errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/src/github pnpm-lock.yaml
git commit -m "feat(github): add GitHub service with Octokit wrapper"
```

---

## Task 5: BullMQ queue module

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/queue/queue.constants.ts`
- Create: `apps/api/src/queue/queue.module.ts`
- Create: `apps/api/src/queue/queue.service.ts`

- [ ] **Step 1: Add BullMQ dependencies**

Edit `apps/api/package.json` — add to `"dependencies"`:

```json
"@nestjs/bullmq": "^10.2.1",
"bullmq": "^5.12.0"
```

Run:

```bash
pnpm install
```

Expected: `@nestjs/bullmq` and `bullmq` installed.

- [ ] **Step 2: Create queue constants and job data types**

Create `apps/api/src/queue/queue.constants.ts`:

```ts
export const QUEUE_NAMES = {
  POLL_PR: 'poll-pr',
  POLL_CI: 'poll-ci',
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
```

- [ ] **Step 3: Create the queue module**

Create `apps/api/src/queue/queue.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from './queue.constants';
import { QueueService } from './queue.service';
import { env } from '../config/env';

function parseRedisUrl(url: string): { host: string; port: number } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
  };
}

@Module({
  imports: [
    BullModule.forRoot({
      connection: parseRedisUrl(env.redisUrl),
    }),
    BullModule.registerQueue({ name: QUEUE_NAMES.POLL_PR }),
    BullModule.registerQueue({ name: QUEUE_NAMES.POLL_CI }),
  ],
  providers: [QueueService],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
```

- [ ] **Step 4: Create the queue service (enqueue helpers)**

Create `apps/api/src/queue/queue.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, PollPrJobData, PollCiJobData } from './queue.constants';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QUEUE_NAMES.POLL_PR) private readonly pollPrQueue: Queue,
    @InjectQueue(QUEUE_NAMES.POLL_CI) private readonly pollCiQueue: Queue,
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
}
```

- [ ] **Step 5: Build**

```bash
pnpm --filter @tryout/api build
```

Expected: no TS errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/queue pnpm-lock.yaml
git commit -m "feat(queue): add BullMQ queue module with poll-pr and poll-ci queues"
```

---

## Task 6: `poll-pr` processor

Polls GitHub for open PRs on a per-user repo. When a PR is found, creates a `Submission` record in the DB and enqueues a `poll-ci` job. Re-schedules itself when no PR is found yet (up to `POLL_MAX_ATTEMPTS`).

**Files:**
- Create: `apps/api/src/queue/processors/poll-pr.processor.ts`
- Create: `apps/api/src/queue/processors/poll-pr.processor.spec.ts`

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/queue/processors/poll-pr.processor.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PollPrProcessor } from './poll-pr.processor';
import { GitHubService } from '../../github/github.service';
import { QueueService } from '../queue.service';
import { QUEUE_NAMES } from '../queue.constants';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
};

const mockGitHubService = {
  listOpenPullRequests: jest.fn(),
};

const mockQueueService = {
  enqueuePollPr: jest.fn(),
  enqueuePollCi: jest.fn(),
};

describe('PollPrProcessor', () => {
  let processor: PollPrProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PollPrProcessor,
        { provide: 'DRIZZLE', useValue: mockDb },
        { provide: GitHubService, useValue: mockGitHubService },
        { provide: QueueService, useValue: mockQueueService },
      ],
    }).compile();
    processor = moduleRef.get(PollPrProcessor);
  });

  it('re-enqueues itself when no PR is found and attempts remain', async () => {
    mockGitHubService.listOpenPullRequests.mockResolvedValue([]);

    const job = {
      data: {
        scenarioRunId: 'run-1',
        repoOwner: 'test-owner',
        repoName: 'lumi-tasks-abc',
        attemptCount: 1,
      },
    } as any;

    await processor.process(job);

    expect(mockQueueService.enqueuePollPr).toHaveBeenCalledWith(
      { scenarioRunId: 'run-1', repoOwner: 'test-owner', repoName: 'lumi-tasks-abc', attemptCount: 2 },
      expect.any(Number),
    );
    expect(mockQueueService.enqueuePollCi).not.toHaveBeenCalled();
  });

  it('stops polling when max attempts reached', async () => {
    mockGitHubService.listOpenPullRequests.mockResolvedValue([]);

    const job = {
      data: {
        scenarioRunId: 'run-1',
        repoOwner: 'test-owner',
        repoName: 'lumi-tasks-abc',
        attemptCount: 120,
      },
    } as any;

    await processor.process(job);

    expect(mockQueueService.enqueuePollPr).not.toHaveBeenCalled();
    expect(mockQueueService.enqueuePollCi).not.toHaveBeenCalled();
  });

  it('creates a Submission and enqueues poll-ci when a PR is found', async () => {
    mockGitHubService.listOpenPullRequests.mockResolvedValue([
      { number: 7, headSha: 'sha-abc', htmlUrl: 'https://github.com/o/r/pull/7', title: 'feat: archive' },
    ]);
    mockDb.returning.mockResolvedValue([{ id: 'sub-1' }]);

    const job = {
      data: {
        scenarioRunId: 'run-1',
        repoOwner: 'test-owner',
        repoName: 'lumi-tasks-abc',
        attemptCount: 1,
      },
    } as any;

    await processor.process(job);

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockQueueService.enqueuePollCi).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: 'sub-1', prNumber: 7, headSha: 'sha-abc' }),
      expect.any(Number),
    );
    expect(mockQueueService.enqueuePollPr).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @tryout/api test -- poll-pr.processor
```

Expected: FAIL — cannot find module `./poll-pr.processor`.

- [ ] **Step 3: Implement the processor**

Create `apps/api/src/queue/processors/poll-pr.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import { DRIZZLE } from '../../db/db.module';
import { GitHubService } from '../../github/github.service';
import { QueueService } from '../queue.service';
import { QUEUE_NAMES, PollPrJobData } from '../queue.constants';
import { env } from '../../config/env';

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

    if (prs.length === 0) {
      await this.queue.enqueuePollPr(
        { scenarioRunId, repoOwner, repoName, attemptCount: attemptCount + 1 },
        env.pollPrIntervalMs,
      );
      return;
    }

    const pr = prs[0];
    this.logger.log(`PR #${pr.number} found for run ${scenarioRunId}`);

    const [submission] = await this.db
      .insert(schema.submissions)
      .values({
        scenarioRunId,
        prUrl: pr.htmlUrl,
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @tryout/api test -- poll-pr.processor
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/queue/processors/poll-pr.processor.ts apps/api/src/queue/processors/poll-pr.processor.spec.ts
git commit -m "feat(queue): add poll-pr processor"
```

---

## Task 7: `poll-ci` processor

Polls GitHub for CI check run status on a PR's head commit. When CI completes, updates `Submission.ciStatus` and `Submission.ciResults`. Re-schedules itself while CI is still running.

**Files:**
- Create: `apps/api/src/queue/processors/poll-ci.processor.ts`
- Create: `apps/api/src/queue/processors/poll-ci.processor.spec.ts`

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/queue/processors/poll-ci.processor.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PollCiProcessor } from './poll-ci.processor';
import { GitHubService } from '../../github/github.service';
import { QueueService } from '../queue.service';
import { eq } from 'drizzle-orm';

const mockDb = {
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockResolvedValue(undefined),
};

const mockGitHubService = {
  getCheckRuns: jest.fn(),
};

const mockQueueService = {
  enqueuePollCi: jest.fn(),
};

const baseJobData = {
  submissionId: 'sub-1',
  repoOwner: 'test-owner',
  repoName: 'lumi-tasks-abc',
  prNumber: 7,
  headSha: 'sha-abc',
  attemptCount: 0,
};

describe('PollCiProcessor', () => {
  let processor: PollCiProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PollCiProcessor,
        { provide: 'DRIZZLE', useValue: mockDb },
        { provide: GitHubService, useValue: mockGitHubService },
        { provide: QueueService, useValue: mockQueueService },
      ],
    }).compile();
    processor = moduleRef.get(PollCiProcessor);
  });

  it('re-enqueues when check runs are still in progress', async () => {
    mockGitHubService.getCheckRuns.mockResolvedValue([
      { id: 1, name: 'CI', status: 'in_progress', conclusion: null },
    ]);

    await processor.process({ data: { ...baseJobData, attemptCount: 1 } } as any);

    expect(mockQueueService.enqueuePollCi).toHaveBeenCalledWith(
      expect.objectContaining({ attemptCount: 2 }),
      expect.any(Number),
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('re-enqueues when no check runs exist yet', async () => {
    mockGitHubService.getCheckRuns.mockResolvedValue([]);

    await processor.process({ data: baseJobData } as any);

    expect(mockQueueService.enqueuePollCi).toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('updates the Submission when all checks are complete', async () => {
    mockGitHubService.getCheckRuns.mockResolvedValue([
      { id: 1, name: 'CI', status: 'completed', conclusion: 'success' },
    ]);

    await processor.process({ data: baseJobData } as any);

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ ciStatus: 'success' }),
    );
    expect(mockQueueService.enqueuePollCi).not.toHaveBeenCalled();
  });

  it('records failure conclusion correctly', async () => {
    mockGitHubService.getCheckRuns.mockResolvedValue([
      { id: 1, name: 'CI', status: 'completed', conclusion: 'failure' },
    ]);

    await processor.process({ data: baseJobData } as any);

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ ciStatus: 'failure' }),
    );
  });

  it('stops polling when max attempts reached', async () => {
    mockGitHubService.getCheckRuns.mockResolvedValue([
      { id: 1, name: 'CI', status: 'in_progress', conclusion: null },
    ]);

    await processor.process({ data: { ...baseJobData, attemptCount: 120 } } as any);

    expect(mockQueueService.enqueuePollCi).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @tryout/api test -- poll-ci.processor
```

Expected: FAIL — cannot find module `./poll-ci.processor`.

- [ ] **Step 3: Implement the processor**

Create `apps/api/src/queue/processors/poll-ci.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import { DRIZZLE } from '../../db/db.module';
import { GitHubService } from '../../github/github.service';
import { QueueService } from '../queue.service';
import { QUEUE_NAMES, PollCiJobData } from '../queue.constants';
import { env } from '../../config/env';

@Processor(QUEUE_NAMES.POLL_CI)
export class PollCiProcessor extends WorkerHost {
  private readonly logger = new Logger(PollCiProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly github: GitHubService,
    private readonly queue: QueueService,
  ) {
    super();
  }

  async process(job: Job<PollCiJobData>): Promise<void> {
    const { submissionId, repoOwner, repoName, prNumber, headSha, attemptCount } = job.data;

    if (attemptCount >= env.pollMaxAttempts) {
      this.logger.warn(`poll-ci max attempts reached for submission ${submissionId}`);
      return;
    }

    const checkRuns = await this.github.getCheckRuns(repoOwner, repoName, headSha);

    const allComplete =
      checkRuns.length > 0 && checkRuns.every((r) => r.status === 'completed');

    if (!allComplete) {
      await this.queue.enqueuePollCi(
        { submissionId, repoOwner, repoName, prNumber, headSha, attemptCount: attemptCount + 1 },
        env.pollCiIntervalMs,
      );
      return;
    }

    const overallConclusion = checkRuns.every((r) => r.conclusion === 'success')
      ? 'success'
      : 'failure';

    this.logger.log(`CI complete for submission ${submissionId}: ${overallConclusion}`);

    await this.db
      .update(schema.submissions)
      .set({
        ciStatus: overallConclusion,
        ciResults: checkRuns as unknown as Record<string, unknown>[],
      })
      .where(eq(schema.submissions.id, submissionId));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @tryout/api test -- poll-ci.processor
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/queue/processors/poll-ci.processor.ts apps/api/src/queue/processors/poll-ci.processor.spec.ts
git commit -m "feat(queue): add poll-ci processor"
```

---

## Task 8: ScenarioRun module — API endpoints

`POST /scenario-runs` starts a run: finds the active scenario, creates DB records, calls GitHub, kicks off polling. `GET /scenario-runs/:id` returns the run's current state including repo URL and latest submission CI status.

**Files:**
- Create: `apps/api/src/scenario-runs/scenario-runs.module.ts`
- Create: `apps/api/src/scenario-runs/scenario-runs.service.ts`
- Create: `apps/api/src/scenario-runs/scenario-runs.controller.ts`

- [ ] **Step 1: Create the service**

Create `apps/api/src/scenario-runs/scenario-runs.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
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
    // Find the active scenario for the backend track.
    const [scenario] = await this.db
      .select({ id: schema.scenarios.id })
      .from(schema.scenarios)
      .innerJoin(schema.tracks, eq(schema.scenarios.trackId, schema.tracks.id))
      .where(eq(schema.tracks.name, 'backend'))
      .limit(1);

    if (!scenario) {
      throw new NotFoundException('No active scenario found for the backend track.');
    }

    // Create the ScenarioRun record.
    const [run] = await this.db
      .insert(schema.scenarioRuns)
      .values({ userId, scenarioId: scenario.id, status: 'onboarding', startedAt: new Date() })
      .returning();

    // Create the GitHub repo from the template.
    const created = await this.github.createRepoFromTemplate(userId);

    // Parse owner and repo name from the full_name ("owner/repo").
    const [repoOwner, repoName] = created.fullName.split('/');

    // Create the Repo record.
    await this.db.insert(schema.repos).values({
      scenarioRunId: run.id,
      url: created.htmlUrl,
      defaultBranch: 'main',
    });

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

    return {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      repo: repo ? { url: repo.url, prNumber: repo.prNumber } : null,
      latestSubmission: submissions[0] ?? null,
    };
  }
}
```

- [ ] **Step 2: Create the controller**

Create `apps/api/src/scenario-runs/scenario-runs.controller.ts`:

```ts
import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ScenarioRunsService } from './scenario-runs.service';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('scenario-runs')
@UseGuards(JwtAuthGuard)
export class ScenarioRunsController {
  constructor(private readonly service: ScenarioRunsService) {}

  @Post()
  start(@CurrentUser() user: AuthUser) {
    return this.service.startRun(user.sub);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getRun(id, user.sub);
  }
}
```

- [ ] **Step 3: Create the module**

Create `apps/api/src/scenario-runs/scenario-runs.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ScenarioRunsController } from './scenario-runs.controller';
import { ScenarioRunsService } from './scenario-runs.service';
import { GitHubModule } from '../github/github.module';
import { QueueModule } from '../queue/queue.module';
import { PollPrProcessor } from '../queue/processors/poll-pr.processor';
import { PollCiProcessor } from '../queue/processors/poll-ci.processor';

@Module({
  imports: [GitHubModule, QueueModule],
  controllers: [ScenarioRunsController],
  providers: [ScenarioRunsService, PollPrProcessor, PollCiProcessor],
})
export class ScenarioRunsModule {}
```

- [ ] **Step 4: Build**

```bash
pnpm --filter @tryout/api build
```

Expected: no TS errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scenario-runs
git commit -m "feat(scenario-runs): add POST /scenario-runs and GET /scenario-runs/:id"
```

---

## Task 9: Wire everything into AppModule

**Files:**
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Update AppModule to import ScenarioRunsModule**

Replace the contents of `apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { ScenarioRunsModule } from './scenario-runs/scenario-runs.module';

@Module({
  imports: [DbModule, AuthModule, ScenarioRunsModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 2: Build the full project**

```bash
pnpm --filter @tryout/shared --filter @tryout/db --filter @tryout/llm --filter @tryout/api build
```

Expected: all 4 packages compile with no TS errors.

- [ ] **Step 3: Run all unit tests**

```bash
pnpm --filter @tryout/api test
```

Expected: PASS — PasswordService (3) + GitHubService (4) + PollPrProcessor (3) + PollCiProcessor (5) = 15 tests total.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app.module.ts
git commit -m "feat(api): wire ScenarioRunsModule into AppModule"
```

---

## Task 10: E2E smoke test for `POST /scenario-runs`

Tests the full endpoint with a mocked GitHub service so no real GitHub token is needed in CI. Verifies DB records are created and the queue job is enqueued.

**Files:**
- Create: `apps/api/test/scenario-runs.e2e-spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `apps/api/test/scenario-runs.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GitHubService } from '../src/github/github.service';
import { QueueService } from '../src/queue/queue.service';

const mockGitHubService = {
  createRepoFromTemplate: jest.fn().mockResolvedValue({
    htmlUrl: 'https://github.com/test-owner/lumi-tasks-abc12345-1234567890',
    fullName: 'test-owner/lumi-tasks-abc12345-1234567890',
    repoName: 'lumi-tasks-abc12345-1234567890',
  }),
  listOpenPullRequests: jest.fn().mockResolvedValue([]),
  getPullRequestDiff: jest.fn().mockResolvedValue(''),
  getCheckRuns: jest.fn().mockResolvedValue([]),
};

const mockQueueService = {
  enqueuePollPr: jest.fn().mockResolvedValue(undefined),
  enqueuePollCi: jest.fn().mockResolvedValue(undefined),
};

describe('ScenarioRuns (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  const email = `m1-${Date.now()}@example.com`;
  const password = 'sup3r-secret-pw';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GitHubService)
      .useValue(mockGitHubService)
      .overrideProvider(QueueService)
      .useValue(mockQueueService)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    // Sign up and get a token.
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(201);
    authToken = res.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGitHubService.createRepoFromTemplate.mockResolvedValue({
      htmlUrl: 'https://github.com/test-owner/lumi-tasks-abc12345-1234567890',
      fullName: 'test-owner/lumi-tasks-abc12345-1234567890',
      repoName: 'lumi-tasks-abc12345-1234567890',
    });
    mockQueueService.enqueuePollPr.mockResolvedValue(undefined);
  });

  it('POST /scenario-runs — returns 401 without a token', async () => {
    await request(app.getHttpServer()).post('/scenario-runs').expect(401);
  });

  it('POST /scenario-runs — creates a run and returns repoUrl', async () => {
    const res = await request(app.getHttpServer())
      .post('/scenario-runs')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.repoUrl).toBe(
      'https://github.com/test-owner/lumi-tasks-abc12345-1234567890',
    );
    expect(res.body.status).toBe('onboarding');
    expect(mockGitHubService.createRepoFromTemplate).toHaveBeenCalledTimes(1);
    expect(mockQueueService.enqueuePollPr).toHaveBeenCalledTimes(1);
  });

  it('GET /scenario-runs/:id — returns the run with repo info', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/scenario-runs')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    const runId = createRes.body.id as string;

    const getRes = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(getRes.body.id).toBe(runId);
    expect(getRes.body.status).toBe('onboarding');
    expect(getRes.body.repo.url).toBe(
      'https://github.com/test-owner/lumi-tasks-abc12345-1234567890',
    );
    expect(getRes.body.latestSubmission).toBeNull();
  });

  it('GET /scenario-runs/:id — returns 404 for a non-existent run', async () => {
    await request(app.getHttpServer())
      .get('/scenario-runs/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });
});
```

- [ ] **Step 2: Run the e2e suite**

Ensure infra is up and migration + seed have been applied. Run:

```bash
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout JWT_SECRET=dev pnpm --filter @tryout/api test:e2e
```

Expected: all e2e tests PASS (auth e2e: 7 + scenario-runs e2e: 4 = 11 tests total).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/scenario-runs.e2e-spec.ts
git commit -m "test(api): add scenario-runs e2e with mocked GitHub and queue"
```

---

## M1 Verification Gate

Run before declaring M1 complete. All must pass:

- [ ] `pnpm -r --workspace-concurrency=1 build` — all 6 workspace packages compile.
- [ ] `pnpm --filter @tryout/api test` — 15 unit tests pass (PasswordService 3, GitHubService 4, PollPrProcessor 3, PollCiProcessor 5).
- [ ] `pnpm --filter @tryout/api test:e2e` — 11 e2e tests pass (auth 7 + scenario-runs 4), against real Postgres with mocked GitHub.
- [ ] `cd templates/lumi-tasks-api && npm ci && npm test` — 4 template tests pass.
- [ ] `DATABASE_URL=... pnpm --filter @tryout/db seed` runs idempotently (twice, same result).
- [ ] **Manual end-to-end (requires real GitHub PAT in `.env`):**
  - API running: `PORT=3001 DATABASE_URL=... JWT_SECRET=dev GITHUB_TOKEN=... GITHUB_OWNER=... node apps/api/dist/main.js`
  - Sign up: `curl -X POST http://localhost:3001/auth/signup -H 'Content-Type: application/json' -d '{"email":"test@example.com","password":"testpass123"}'`
  - Start run: `curl -X POST http://localhost:3001/scenario-runs -H "Authorization: Bearer <token>"`
  - Confirm the returned `repoUrl` is a real GitHub repo you can open in a browser.
  - Open a PR on that repo; within ~60 s, `GET /scenario-runs/:id` should show `latestSubmission` with a `prUrl`.

**Out of M1 (do not build here):** agents, chat UI, scenario run status transitions beyond "onboarding", error recovery, web UI changes.
