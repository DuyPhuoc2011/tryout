# Scenario 01 — "Archive Tasks" (Backend Track)

A complete, hand-authored scenario for the v1 loop. This is the single scenario Tryout ships with in v1.

It contains everything Claude Code needs: the structured definition, the template repo to scaffold, the hidden grading tests, the ground truth, the rubric, and the agent answer keys.

**Why this scenario is designed the way it is:** the ticket is deliberately under-specified in two ways, and a good engineer surfaces both by asking the PM. Critically, the gaps have *technical* consequences — a fresher who doesn't ask will build something the hidden acceptance tests fail on. The review loop lets them recover technically, but the professional score records that they had to be told. That linkage between "asked a good question" and "shipped complete work" is the whole point of the scenario.

---

## A. Scenario definition (structured)

Authoring format is YAML; compile to the JSONB `Scenario.definition` from the build spec.

```yaml
id: scenario-01-archive-tasks
track: backend
title: "Add the ability to archive tasks"
version: 1
difficulty: intro
estimated_minutes: 60

company_context:
  name: "Lumi"
  product: >
    Lumi is a lightweight personal productivity app. Users create tasks,
    mark them complete, and want to keep their list focused on what's active.
  team: >
    A small product team. You're a new backend engineer. The codebase is a
    NestJS REST API that owns the Tasks resource.
  user_role: "Backend Engineer (new hire, first ticket)"

repo:
  template_ref: "templates/lumi-tasks-api"   # see Section B
  default_branch: "main"
  ci: "github-actions"                        # runs the visible test suite on the PR

ticket:
  id: "LUMI-142"
  title: "Let users archive completed tasks"
  body: >
    Users have asked for a way to archive tasks they're done with so their
    task list stays clean and focused on what's still active.

    Please add an archive endpoint: POST /tasks/:id/archive

    Keep it consistent with how the rest of our Tasks API is built.
  # The ambiguity is intentional. See `clarifications` for what a good
  # engineer should surface, and the PM answer key in Section F.

# What a strong engineer asks about, and the canonical answers.
# Used by the PM (to answer) and the Grader (to score whether they asked).
clarifications:
  - id: exclude-from-default-list
    the_gap: >
      The ticket says the list should "stay clean" but never says archived
      tasks should be hidden from GET /tasks, or how to still retrieve them.
    good_question_signals:
      - "Should archived tasks be excluded from the default GET /tasks?"
      - "How should someone still see their archived tasks if needed?"
    canonical_answer: >
      Yes — exclude archived tasks from GET /tasks by default. But nothing
      should be lost: support GET /tasks?includeArchived=true to include them.
    has_technical_consequence: true

  - id: unarchive-needed
    the_gap: >
      The ticket only mentions archiving. It never says whether users can
      restore an archived task. A complete feature needs un-archive.
    good_question_signals:
      - "Do users need to un-archive / restore a task?"
      - "Is archive reversible?"
    canonical_answer: >
      Yes — users need to restore tasks. Add POST /tasks/:id/unarchive.
    has_technical_consequence: true

  - id: archive-vs-delete
    the_gap: >
      Confirming archive is a soft state, not a deletion.
    good_question_signals:
      - "Archiving shouldn't delete the task, right? It's still retrievable directly?"
    canonical_answer: >
      Correct — archiving is a soft state. The task still exists and is
      retrievable at GET /tasks/:id. It's just hidden from the default list.
    has_technical_consequence: true

injected_events:
  - id: scope-change-priority
    type: scope_change
    enabled: false        # OFF for the very first run; enable in later runs
    trigger: "after first PR is opened"
    pm_message: >
      Quick change from product — can archived tasks also be sorted to the
      bottom when includeArchived=true is used, rather than mixed in? Small
      tweak, but they want active tasks on top.

agents:
  pm:
    persona_ref: "pm-mai"      # Section F
  senior:
    persona_ref: "senior-alex" # Section F

rubric_ref: "rubric-scenario-01"   # Section E

grading:
  hidden_acceptance_suite: "test/archive.acceptance.spec.ts"  # Section C
  # Run against the user's PR branch at grading time. Behavior-based:
  # any reasonable internal implementation passes as long as the HTTP
  # behavior matches.
```

---

## B. Template repo: `lumi-tasks-api`

A small NestJS REST API with the Tasks resource already implemented. The fresher extends it. Persistence is an in-memory store so CI is fast and deterministic — no database setup.

Claude Code should scaffold a standard NestJS project and include the files below. Standard boilerplate that isn't shown (`main.ts`, `app.module.ts` wiring, `tsconfig.json`, `nest-cli.json`, jest config) should follow normal NestJS conventions, with `AppModule` importing `TasksModule`.

### File tree

```
lumi-tasks-api/
├── README.md
├── package.json
├── tsconfig.json
├── nest-cli.json
├── .github/
│   └── workflows/
│       └── ci.yml
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
    └── tasks.e2e-spec.ts        # existing, passing — shows the test pattern
```

> The hidden suite `test/archive.acceptance.spec.ts` (Section C) is **not** committed to the template the user sees. Tryout adds it at grading time.

### `README.md`

```markdown
# Lumi Tasks API

The backend service that owns the **Tasks** resource for Lumi.

## Stack
- NestJS (TypeScript)
- In-memory store (no database — data resets on restart)
- Jest + Supertest for tests

## Run locally
\`\`\`bash
npm ci
npm run start:dev
\`\`\`
API is served at http://localhost:3000.

## Test
\`\`\`bash
npm test
\`\`\`

## Architecture
The Tasks resource follows the standard NestJS layering:
- `tasks.controller.ts` — HTTP routes
- `tasks.service.ts` — business logic + the in-memory store
- `task.entity.ts` — the Task shape
- `dto/` — request validation (class-validator)

## Current API
| Method | Route        | Description            |
|--------|--------------|------------------------|
| GET    | /tasks       | List all tasks         |
| GET    | /tasks/:id   | Get one task           |
| POST   | /tasks       | Create a task          |
| PATCH  | /tasks/:id   | Update a task          |
| DELETE | /tasks/:id   | Delete a task          |

## Conventions
- Validate input with DTOs + `class-validator`.
- Throw `NotFoundException` for missing resources.
- Add/extend tests in `test/` following the existing e2e pattern.
```

### `src/tasks/task.entity.ts`

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

### `src/tasks/dto/create-task.dto.ts`

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

### `src/tasks/dto/update-task.dto.ts`

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

### `src/tasks/tasks.service.ts`

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
    if (!task) {
      throw new NotFoundException(`Task ${id} not found`);
    }
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
    if (index === -1) {
      throw new NotFoundException(`Task ${id} not found`);
    }
    this.tasks.splice(index, 1);
  }
}
```

### `src/tasks/tasks.controller.ts`

```ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  findAll() {
    return this.tasksService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTaskDto) {
    return this.tasksService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    this.tasksService.remove(id);
  }
}
```

### `src/tasks/tasks.module.ts`

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

### `test/tasks.e2e-spec.ts` (existing, passing — the pattern to follow)

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

  afterEach(async () => {
    await app.close();
  });

  it('creates a task', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .send({ title: 'Write tests' })
      .expect(201);

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

### `.github/workflows/ci.yml`

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

### `package.json` (key parts — Claude Code fills standard NestJS deps/scripts)

```json
{
  "name": "lumi-tasks-api",
  "scripts": {
    "start:dev": "nest start --watch",
    "build": "nest build",
    "test": "jest",
    "lint": "eslint \"{src,test}/**/*.ts\""
  },
  "dependencies": {
    "@nestjs/common": "^10",
    "@nestjs/core": "^10",
    "@nestjs/platform-express": "^10",
    "class-validator": "^0.14",
    "class-transformer": "^0.5",
    "reflect-metadata": "^0.2",
    "rxjs": "^7"
  },
  "devDependencies": {
    "@nestjs/testing": "^10",
    "jest": "^29",
    "ts-jest": "^29",
    "supertest": "^6",
    "typescript": "^5"
  }
}
```

> Note: `main.ts` must register the global `ValidationPipe({ whitelist: true })` so DTO validation is active in the running app as well as in tests.

---

## C. Hidden acceptance suite (technical ground truth — NOT shown to the user)

Run this against the user's PR branch at grading time. It is **behavior-based**: it exercises the HTTP API only, so any sensible internal implementation passes (a boolean `archived`, an `archivedAt` timestamp, a status enum — all fine). This is what makes the technical score objective.

### `test/archive.acceptance.spec.ts`

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

const expectOk = (res: any) => {
  if (![200, 201, 204].includes(res.status)) {
    throw new Error(`expected a 2xx status, got ${res.status}`);
  }
};

describe('Archive feature (acceptance)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const createTask = async (title: string) => {
    const res = await request(http()).post('/tasks').send({ title }).expect(201);
    return res.body;
  };

  it('archiving a task removes it from the default list', async () => {
    const task = await createTask('Done thing');
    await request(http()).post(`/tasks/${task.id}/archive`).expect(expectOk);

    const list = await request(http()).get('/tasks').expect(200);
    expect(list.body.find((t: any) => t.id === task.id)).toBeUndefined();
  });

  it('an archived task is still retrievable directly (archive is not delete)', async () => {
    const task = await createTask('Keep me');
    await request(http()).post(`/tasks/${task.id}/archive`).expect(expectOk);
    await request(http()).get(`/tasks/${task.id}`).expect(200);
  });

  it('includeArchived=true returns archived tasks in the list', async () => {
    const task = await createTask('Archived one');
    await request(http()).post(`/tasks/${task.id}/archive`).expect(expectOk);

    const list = await request(http())
      .get('/tasks?includeArchived=true')
      .expect(200);
    expect(list.body.find((t: any) => t.id === task.id)).toBeDefined();
  });

  it('unarchiving a task restores it to the default list', async () => {
    const task = await createTask('Back again');
    await request(http()).post(`/tasks/${task.id}/archive`).expect(expectOk);
    await request(http()).post(`/tasks/${task.id}/unarchive`).expect(expectOk);

    const list = await request(http()).get('/tasks').expect(200);
    expect(list.body.find((t: any) => t.id === task.id)).toBeDefined();
  });

  it('non-archived tasks still appear in the default list', async () => {
    const active = await createTask('Still active');
    const list = await request(http()).get('/tasks').expect(200);
    expect(list.body.find((t: any) => t.id === active.id)).toBeDefined();
  });

  it('archiving a non-existent task returns 404', async () => {
    await request(http()).post('/tasks/nonexistent-id/archive').expect(404);
  });
});
```

**Note the trap, made concrete:** the `unarchive` test and the `includeArchived=true` test both fail for a fresher who built only `POST /tasks/:id/archive` from the literal ticket. Those are exactly the behaviors revealed by asking the two clarifying questions. The Senior's review (Section F) is instructed to catch them so the user can recover technically.

---

## D. Ground-truth solution notes (for the Senior and the Grader)

A complete, well-built solution:

- Adds soft-archive state to the Task (e.g. `archived: boolean` or `archivedAt: Date | null` — naming is free).
- `POST /tasks/:id/archive` sets the task archived; returns the updated task (200) or 204. 404 if not found.
- `POST /tasks/:id/unarchive` clears the archived state; 404 if not found.
- `GET /tasks` excludes archived tasks **by default**.
- `GET /tasks?includeArchived=true` includes them. (Boolean query param parsed sensibly.)
- `GET /tasks/:id` returns the task regardless of archived state.
- Logic lives in the **service**, not the controller (consistent with the existing pattern).
- The user adds tests covering the new behavior, following the existing e2e style.
- Clean PR: a description explaining what changed and why, and noting any assumptions (especially if they did NOT ask and assumed defaults).

Common acceptable variations: action endpoints vs. a `PATCH /tasks/:id` archived flag (if they asked and the PM allowed it — but the ticket specifies the archive endpoint, so the action-endpoint shape is canonical here). Field naming and the exact 200-vs-204 response are not graded.

Red flags: archive implemented as a hard delete; archived tasks leaking into the default list; no un-archive; business logic stuffed into the controller; no new tests; force-pushing over review history.

---

## E. Grading rubric (`rubric-scenario-01`)

Two independent dimensions. Each yields a 0–100 score and written feedback. Overall feedback ties them together. The Grader has the ground truth (Sections C and D) and the full transcript, so scores are anchored, not vibes.

### Technical (50% of overall)

| Criterion | Weight | What "good" looks like |
|---|---|---|
| Acceptance tests pass | 40% | The hidden suite (Section C) passes on the final branch. |
| Correctness & completeness | 25% | Default-list exclusion, includeArchived, un-archive, 404s all handled. |
| Follows codebase conventions | 20% | Logic in the service; DTO/validation patterns respected; idiomatic NestJS. |
| Own tests added | 15% | New tests cover the feature, following the existing e2e pattern. |

Score the technical dimension on the **final** state of the branch (after review iteration), so a user who recovers via review isn't permanently penalized technically.

### Professional (50% of overall)

| Criterion | Weight | What "good" looks like |
|---|---|---|
| Surfaced the ambiguity | 30% | Asked the PM at least one of the two consequential clarifying questions (`exclude-from-default-list`, `unarchive-needed`) **before** or early in implementation. |
| PR description quality | 20% | Explains what changed and why; states assumptions, especially if they didn't ask. |
| Response to review | 25% | Incorporated the Senior's feedback constructively; asked sensible follow-ups; not defensive; didn't silently force-push over history. |
| Communication clarity | 15% | Messages to PM/Senior are clear, specific, and respectful of their time. |
| Help-seeking judgment | 10% | Used the Senior appropriately — neither flailing in silence nor asking to be handed the answer. |

**The signature behavior to reward:** a user who asked the two consequential questions up front, built the complete feature first try, and shipped a clear PR should score high on **both** dimensions. A user who skipped the questions, built archive-only, failed the hidden tests, then fixed it after review should land high-ish on technical (final state) but visibly lower on professional — and the feedback should name that gap kindly and concretely ("You shipped working code, but the missing un-archive surfaced in review rather than up front — a quick question to Mai about restoring tasks would have caught it on day one").

Feedback tone everywhere: specific, actionable, encouraging. This is a learning product.

---

## F. Agent persona configs

System-prompt-level guidance per agent for this scenario. All agents receive the scenario context (company, ticket, ground truth) as shared context. Keep prompts in version control.

### `pm-mai` — Product Manager

```
You are Mai, the Product Manager at Lumi. You are friendly, busy, and
practical. You assigned ticket LUMI-142 to a new backend engineer.

Behavior:
- If the engineer asks a clarifying question, answer it directly using the
  canonical answers below. Reward good questions with a clear, useful answer.
- If they ask something the ticket already covers, answer briefly.
- Do NOT volunteer the answers to the consequential clarifications unless
  asked. The whole point is whether they think to ask. If they never ask and
  start coding, that's fine — let them; it will surface later.
- Stay in scope. You're a PM, not an engineer: don't give implementation
  details (endpoint shapes, code). If pushed on "how," defer to their
  judgment and the existing codebase conventions.
- Keep replies short and natural, like real Slack messages.

Canonical answers (only when asked):
- Excluding archived from the default list: "Yes, hide archived tasks from
  the main list by default. But don't lose them — let people pass
  ?includeArchived=true to see them."
- Un-archive: "Good catch — yes, people need to restore tasks. Add an
  un-archive too."
- Archive vs delete: "Right, archiving doesn't delete anything. The task
  should still be there if you fetch it directly."

If the scope-change event is enabled, send its message after the first PR.
```

### `senior-alex` — Senior Engineer / Reviewer

```
You are Alex, a senior backend engineer at Lumi. You communicate in clear,
professional, slightly terse async English (the engineer may not be a native
speaker — be precise and kind, model good written communication).

Two modes:

1) CHAT (when the engineer asks for help):
   - Help them think; do NOT hand over the solution. Point at the relevant
     file or pattern, ask what they've tried, give a nudge.
   - If they ask "should archived tasks show in the list?" redirect them to
     confirm with Mai — that's a product decision, not yours to invent.

2) PR REVIEW (after they open the PR — review the ACTUAL diff):
   - Leave specific, constructive comments tied to the code.
   - Request changes at least once on the first submission (first PRs rarely
     merge clean). Find something real: a missing test, an edge case, a
     convention issue, or a missing behavior.
   - IMPORTANT — catch incompleteness so they can recover: if the PR is
     missing un-archive, or archived tasks still show in the default list, or
     there's no includeArchived support, call it out clearly and ask them to
     address it. Frame it as something a quick check with Mai would have
     surfaced.
   - If logic is in the controller instead of the service, note the
     convention.
   - Approve once the feature is complete and the conventions are respected.

Keep every message professional and specific. Praise what's genuinely good.
```

---

## G. Wiring notes for Claude Code

- Scaffold `lumi-tasks-api` as a real NestJS project from Section B; fill standard boilerplate (`main.ts` with the global `ValidationPipe`, `app.module.ts` importing `TasksModule`, tsconfig, jest config) per NestJS conventions. The visible test suite (`test/tasks.e2e-spec.ts`) must pass on a clean checkout.
- Store this scenario as the one `Scenario` record (definition from Section A). Keep the hidden suite (Section C), ground truth (Section D), rubric (Section E), and persona prompts (Section F) server-side — never expose them to the user or commit the hidden suite to the user's repo.
- At grading time: copy `test/archive.acceptance.spec.ts` into the user's branch checkout, run the full Jest suite, and feed the pass/fail results plus the diff, the PR description, the review thread, and the full PM/Senior chat into the Grader against the rubric.
- Behavior-based grading means you do **not** need to parse the user's implementation — only the HTTP behavior and the transcript matter.
- Build this scenario end to end before authoring a second one. One excellent scenario first.
