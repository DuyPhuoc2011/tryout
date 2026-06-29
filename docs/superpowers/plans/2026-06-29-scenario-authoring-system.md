# Scenario-Authoring System (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `scenario` CLI + self-contained `scenarios/<id>/` folder convention that validates, gates, publishes, and seeds a scenario from one manifest — and migrates the two agent scenarios into it.

**Architecture:** New workspace package `tools/scenario-cli` (`@tryout/scenario-cli`), run via `tsx`. A scenario folder holds `scenario.json` (manifest), `template/` (student skeleton, published) and `solution/` (reference overlay, gate-only). The CLI's `gate` runs the suite in a temp dir (skeleton RED, reference GREEN, each declared mutation RED) and `release` is fail-closed: gate must pass before `publish` (gh + git) or `seed` (Drizzle upsert) run.

**Tech Stack:** TypeScript + tsx, Zod (manifest schema), Node `fs`/`child_process` (temp-dir runner), `gh` CLI + `git` (publish), `@tryout/db` (seed), `@tryout/shared` (definition types).

**Spec:** `docs/superpowers/specs/2026-06-29-scenario-authoring-system-design.md`

---

## File Structure

```
tools/scenario-cli/
├── package.json            # @tryout/scenario-cli; deps @tryout/db, @tryout/shared, zod; dev tsx, vitest
├── tsconfig.json
├── src/
│   ├── cli.ts              # arg router: validate|gate|publish|seed|release <id>
│   ├── manifest.ts         # Zod schema + ScenarioManifest type + loadManifest(id)
│   ├── paths.ts            # repo-root resolution + scenario folder paths
│   ├── fsutil.ts           # copyDir, overlayDir, applyMutation, mkTemp
│   ├── gate.ts             # runGate(id) -> GateResult
│   ├── seed.ts             # seedScenario(id)
│   ├── publish.ts          # publishScenario(id) via gh + git
│   └── validate.ts         # validateManifest(manifest, folder) -> string[] problems
└── test/
    ├── validate.test.ts
    ├── fsutil.test.ts
    ├── gate.test.ts
    └── fixtures/…           # tiny fixture scenarios
scenarios/agent-foundations/{scenario.json,template/,solution/}
scenarios/agent-tools/{scenario.json,template/,solution/}
```

---

## Task 1: Scaffold the `tools/scenario-cli` package

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `tools/scenario-cli/package.json`
- Create: `tools/scenario-cli/tsconfig.json`
- Create: `tools/scenario-cli/vitest.config.ts`

- [ ] **Step 1: Add `tools/*` to the workspace**

`pnpm-workspace.yaml` becomes:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'tools/*'
```

- [ ] **Step 2: Create the package manifest**

`tools/scenario-cli/package.json`:

```json
{
  "name": "@tryout/scenario-cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "scenario": "src/cli.ts" },
  "scripts": {
    "cli": "tsx src/cli.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@tryout/db": "workspace:*",
    "@tryout/shared": "workspace:*",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.15.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 3: Create tsconfig**

`tools/scenario-cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Create vitest config**

`tools/scenario-cli/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 60_000 },
});
```

- [ ] **Step 5: Install**

Run: `pnpm install`
Expected: `@tryout/scenario-cli` linked into the workspace, no errors. (If `has-flag` missing, `pnpm install --force` per CLAUDE.md.)

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml tools/scenario-cli pnpm-lock.yaml
git commit -m "chore(scenario-cli): scaffold authoring CLI package"
```

---

## Task 2: Manifest schema + loader

**Files:**
- Create: `tools/scenario-cli/src/paths.ts`
- Create: `tools/scenario-cli/src/manifest.ts`

- [ ] **Step 1: Path helpers**

`tools/scenario-cli/src/paths.ts`:

```ts
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// tools/scenario-cli/src/paths.ts -> repo root is three levels up from src.
const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');
export const SCENARIOS_DIR = path.join(REPO_ROOT, 'scenarios');

export function scenarioDir(id: string): string {
  return path.join(SCENARIOS_DIR, id);
}
export function manifestPath(id: string): string {
  return path.join(scenarioDir(id), 'scenario.json');
}
export function templateDir(id: string): string {
  return path.join(scenarioDir(id), 'template');
}
export function solutionDir(id: string): string {
  return path.join(scenarioDir(id), 'solution');
}
```

- [ ] **Step 2: Zod schema + loader**

`tools/scenario-cli/src/manifest.ts`:

```ts
import fs from 'node:fs';
import { z } from 'zod';
import { manifestPath } from './paths.js';

const rubricCriterion = z.object({
  id: z.string(),
  weight: z.number(),
  description: z.string(),
});
const rubricDimension = z.object({
  weight: z.number(),
  criteria: z.array(rubricCriterion).min(1),
});

const mutation = z.object({
  file: z.string(),
  find: z.string().min(1),
  replace: z.string(),
  expect_fail: z.string(),
});

export const manifestSchema = z.object({
  id: z.string().min(1),
  track: z.string().min(1),
  title: z.string().min(1),
  version: z.number().int().positive(),
  projectType: z.enum([
    'backend_monolith',
    'microservices',
    'frontend_web',
    'mobile',
    'desktop',
  ]),
  available: z.boolean(),
  catalog: z.object({
    summary: z.string(),
    difficulty: z.string(),
    tags: z.array(z.string()),
  }),
  team: z.array(z.string()).min(1),
  company_context: z.object({
    name: z.string(),
    product: z.string(),
    team: z.string(),
    user_role: z.string(),
  }),
  repo: z.object({
    template_ref: z.string().min(1),
    default_branch: z.string().default('main'),
    ci: z.string().optional(),
  }),
  ticket: z.object({ id: z.string(), title: z.string(), body: z.string() }),
  clarifications: z.array(z.any()).default([]),
  agent_prompts: z.object({
    pm_mai: z.object({ system: z.string() }),
    senior_alex: z.object({ system: z.string() }),
  }),
  ground_truth: z.object({
    solution_notes: z.string(),
    red_flags: z.array(z.string()),
  }),
  rubric: z.object({ technical: rubricDimension, professional: rubricDimension }),
  gate: z.object({
    runtime: z.string(),
    test_cmd: z.string().min(1),
    mutations: z.array(mutation).min(1),
  }),
});

export type ScenarioManifest = z.infer<typeof manifestSchema>;

/** Load + structurally parse. Throws ZodError on malformed JSON shape. */
export function loadManifest(id: string): ScenarioManifest {
  const raw = fs.readFileSync(manifestPath(id), 'utf8');
  return manifestSchema.parse(JSON.parse(raw));
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @tryout/scenario-cli exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add tools/scenario-cli/src/paths.ts tools/scenario-cli/src/manifest.ts
git commit -m "feat(scenario-cli): manifest zod schema + loader"
```

---

## Task 3: `validate` — semantic checks beyond the schema

**Files:**
- Create: `tools/scenario-cli/src/validate.ts`
- Test: `tools/scenario-cli/test/validate.test.ts`

- [ ] **Step 1: Write the failing test**

`tools/scenario-cli/test/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../src/validate.js';
import type { ScenarioManifest } from '../src/manifest.js';

function base(): ScenarioManifest {
  return {
    id: 'x', track: 't', title: 'T', version: 1, projectType: 'backend_monolith',
    available: true,
    catalog: { summary: 's', difficulty: 'intro', tags: [] },
    team: ['backend_engineer'],
    company_context: { name: 'n', product: 'p', team: 't', user_role: 'r' },
    repo: { template_ref: 'ref', default_branch: 'main' },
    ticket: { id: 'T-1', title: 't', body: 'b' },
    clarifications: [],
    agent_prompts: { pm_mai: { system: 's' }, senior_alex: { system: 's' } },
    ground_truth: { solution_notes: 'n', red_flags: [] },
    rubric: {
      technical: { weight: 0.5, criteria: [{ id: 'a', weight: 1, description: 'd' }] },
      professional: { weight: 0.5, criteria: [{ id: 'b', weight: 1, description: 'd' }] },
    },
    gate: {
      runtime: 'python3.11', test_cmd: 'pytest -q',
      mutations: [{ file: 'f.py', find: 'X', replace: 'Y', expect_fail: 'shape' }],
    },
  };
}

// A fake folder reader: which template files exist, and their contents.
function reader(files: Record<string, string>) {
  return {
    exists: (rel: string) => rel in files,
    read: (rel: string) => files[rel] ?? '',
  };
}

describe('validateManifest', () => {
  it('passes a well-formed manifest', () => {
    const problems = validateManifest(base(), reader({ 'f.py': 'aaa X bbb' }), ['f.py']);
    expect(problems).toEqual([]);
  });

  it('flags rubric weights that do not sum to ~1 per dimension', () => {
    const m = base();
    m.rubric.technical.criteria = [{ id: 'a', weight: 0.4, description: 'd' }];
    const problems = validateManifest(m, reader({ 'f.py': 'X' }), ['f.py']);
    expect(problems.some((p) => /technical.*sum/i.test(p))).toBe(true);
  });

  it('flags a solution file not present in template', () => {
    const problems = validateManifest(base(), reader({ 'f.py': 'X' }), ['agent/missing.py']);
    expect(problems.some((p) => /solution.*missing\.py.*template/i.test(p))).toBe(true);
  });

  it('flags a mutation find-string absent from the template file', () => {
    const problems = validateManifest(base(), reader({ 'f.py': 'no marker here' }), ['f.py']);
    expect(problems.some((p) => /mutation.*find.*f\.py/i.test(p))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @tryout/scenario-cli test -- validate`
Expected: FAIL — `validate.js` not found.

- [ ] **Step 3: Implement**

`tools/scenario-cli/src/validate.ts`:

```ts
import type { ScenarioManifest } from './manifest.js';

export interface TemplateReader {
  exists: (relPath: string) => boolean;
  read: (relPath: string) => string;
}

const TOL = 0.001;

/**
 * Semantic checks the Zod schema can't express. `solutionFiles` are the relative
 * paths present under solution/. Returns ALL problems (empty = valid).
 */
export function validateManifest(
  m: ScenarioManifest,
  template: TemplateReader,
  solutionFiles: string[],
): string[] {
  const problems: string[] = [];

  for (const dim of ['technical', 'professional'] as const) {
    const sum = m.rubric[dim].criteria.reduce((a, c) => a + c.weight, 0);
    if (Math.abs(sum - 1) > TOL) {
      problems.push(`rubric.${dim} criteria weights sum to ${sum}, expected ~1.0`);
    }
  }

  for (const rel of solutionFiles) {
    if (!template.exists(rel)) {
      problems.push(`solution file "${rel}" has no counterpart in template/`);
    }
  }

  for (const mut of m.gate.mutations) {
    if (!template.exists(mut.file)) {
      problems.push(`mutation target "${mut.file}" not found in template/`);
    } else if (!template.read(mut.file).includes(mut.find)) {
      problems.push(`mutation find-string for "${mut.file}" not present in that file`);
    }
  }

  return problems;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @tryout/scenario-cli test -- validate`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/scenario-cli/src/validate.ts tools/scenario-cli/test/validate.test.ts
git commit -m "feat(scenario-cli): semantic manifest validation"
```

---

## Task 4: Filesystem helpers (copy / overlay / mutate / temp)

**Files:**
- Create: `tools/scenario-cli/src/fsutil.ts`
- Test: `tools/scenario-cli/test/fsutil.test.ts`

- [ ] **Step 1: Write the failing test**

`tools/scenario-cli/test/fsutil.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { copyDir, overlayDir, applyMutation, listFiles, mkTemp } from '../src/fsutil.js';

const temps: string[] = [];
function tmp() { const d = mkTemp('fsutil'); temps.push(d); return d; }
afterEach(() => { for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('fsutil', () => {
  it('copyDir + overlayDir merges by path, overlay wins', () => {
    const src = tmp(), ovl = tmp(), dst = tmp();
    fs.mkdirSync(path.join(src, 'a'), { recursive: true });
    fs.writeFileSync(path.join(src, 'a', 'x.txt'), 'stub');
    fs.writeFileSync(path.join(src, 'keep.txt'), 'keep');
    fs.mkdirSync(path.join(ovl, 'a'), { recursive: true });
    fs.writeFileSync(path.join(ovl, 'a', 'x.txt'), 'solved');

    copyDir(src, dst);
    overlayDir(ovl, dst);

    expect(fs.readFileSync(path.join(dst, 'a', 'x.txt'), 'utf8')).toBe('solved');
    expect(fs.readFileSync(path.join(dst, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('applyMutation does a literal replace in a file', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'f.py'), 'hello FIND world');
    applyMutation(dir, { file: 'f.py', find: 'FIND', replace: 'GONE', expect_fail: '' });
    expect(fs.readFileSync(path.join(dir, 'f.py'), 'utf8')).toBe('hello GONE world');
  });

  it('listFiles returns relative paths, excluding a named dir', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'a.txt'), '1');
    fs.mkdirSync(path.join(dir, 'skip'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skip', 'b.txt'), '2');
    const files = listFiles(dir, ['skip']).sort();
    expect(files).toEqual([path.join('sub', 'a.txt')]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @tryout/scenario-cli test -- fsutil`
Expected: FAIL — `fsutil.js` not found.

- [ ] **Step 3: Implement**

`tools/scenario-cli/src/fsutil.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function mkTemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

/** Recursively list files as paths relative to `root`, skipping any top-level dir in `exclude`. */
export function listFiles(root: string, exclude: string[] = []): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (rel === '' && exclude.includes(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(abs, r);
      else out.push(r);
    }
  };
  walk(root, '');
  return out;
}

export function copyDir(src: string, dst: string): void {
  fs.cpSync(src, dst, { recursive: true });
}

/** Copy every file from `overlay` into `dst`, overwriting by relative path. */
export function overlayDir(overlay: string, dst: string): void {
  if (!fs.existsSync(overlay)) return;
  for (const rel of listFiles(overlay)) {
    const target = path.join(dst, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(overlay, rel), target);
  }
}

export function applyMutation(
  dir: string,
  mut: { file: string; find: string; replace: string; expect_fail: string },
): void {
  const target = path.join(dir, mut.file);
  const content = fs.readFileSync(target, 'utf8');
  if (!content.includes(mut.find)) {
    throw new Error(`mutation find-string absent in ${mut.file}`);
  }
  fs.writeFileSync(target, content.split(mut.find).join(mut.replace));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @tryout/scenario-cli test -- fsutil`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/scenario-cli/src/fsutil.ts tools/scenario-cli/test/fsutil.test.ts
git commit -m "feat(scenario-cli): fs helpers (copy/overlay/mutate/list)"
```

---

## Task 5: `gate` — the trust mechanism

**Files:**
- Create: `tools/scenario-cli/src/gate.ts`
- Test: `tools/scenario-cli/test/gate.test.ts`
- Create: `tools/scenario-cli/test/fixtures/ok/{template,solution}`, `tools/scenario-cli/test/fixtures/weak/{template,solution}`

The gate runs a shell `test_cmd` in temp dirs. To keep tests fast and offline, the fixtures use a trivial `test_cmd` that needs no install: a Node assertion script.

- [ ] **Step 1: Create the "ok" fixture (discriminating suite)**

`tools/scenario-cli/test/fixtures/ok/template/run.cjs`:

```js
// Exits 0 only if value.txt contains "SOLVED". Skeleton has "STUB" -> fails.
const fs = require('fs');
const v = fs.readFileSync(__dirname + '/value.txt', 'utf8').trim();
if (v !== 'SOLVED') { console.error('expected SOLVED, got ' + v); process.exit(1); }
console.log('ok');
```

`tools/scenario-cli/test/fixtures/ok/template/value.txt`:

```
STUB
```

`tools/scenario-cli/test/fixtures/ok/solution/value.txt`:

```
SOLVED
```

- [ ] **Step 2: Create the "weak" fixture (suite that passes everything)**

`tools/scenario-cli/test/fixtures/weak/template/run.cjs`:

```js
// Always exits 0 -> a non-discriminating suite. Skeleton "passes" too.
console.log('always ok');
```

`tools/scenario-cli/test/fixtures/weak/template/value.txt`:

```
STUB
```

`tools/scenario-cli/test/fixtures/weak/solution/value.txt`:

```
SOLVED
```

- [ ] **Step 3: Write the failing test**

`tools/scenario-cli/test/gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGate } from '../src/gate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEST_CMD = 'node run.cjs';

describe('runGate', () => {
  it('passes when skeleton fails, solution passes, and the mutation re-breaks it', () => {
    const res = runGate({
      templateDir: path.join(here, 'fixtures/ok/template'),
      solutionDir: path.join(here, 'fixtures/ok/solution'),
      testCmd: TEST_CMD,
      mutations: [{ file: 'value.txt', find: 'SOLVED', replace: 'STUB', expect_fail: 'value' }],
    });
    expect(res.ok).toBe(true);
  });

  it('fails a non-discriminating suite (skeleton passes / mutation does not break)', () => {
    const res = runGate({
      templateDir: path.join(here, 'fixtures/weak/template'),
      solutionDir: path.join(here, 'fixtures/weak/solution'),
      testCmd: TEST_CMD,
      mutations: [{ file: 'value.txt', find: 'SOLVED', replace: 'STUB', expect_fail: 'value' }],
    });
    expect(res.ok).toBe(false);
    expect(res.stages.find((s) => s.name === 'skeleton-red')?.ok).toBe(false);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @tryout/scenario-cli test -- gate`
Expected: FAIL — `gate.js` not found.

- [ ] **Step 5: Implement**

`tools/scenario-cli/src/gate.ts`:

```ts
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { copyDir, overlayDir, applyMutation, mkTemp } from './fsutil.js';

export interface GateInput {
  templateDir: string;
  solutionDir: string;
  testCmd: string;
  mutations: { file: string; find: string; replace: string; expect_fail: string }[];
}
export interface GateStage { name: string; ok: boolean; detail: string; }
export interface GateResult { ok: boolean; stages: GateStage[]; }

/** Run testCmd in `dir`; return true if it exits 0. */
function passes(dir: string, testCmd: string): { ok: boolean; output: string } {
  try {
    const output = execSync(testCmd, { cwd: dir, stdio: 'pipe', shell: true as never }).toString();
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

export function runGate(input: GateInput): GateResult {
  const stages: GateStage[] = [];
  const tmp = mkTemp('gate');
  try {
    // 1. skeleton must FAIL
    const skel = `${tmp}/skeleton`;
    copyDir(input.templateDir, skel);
    const r1 = passes(skel, input.testCmd);
    stages.push({ name: 'skeleton-red', ok: !r1.ok, detail: r1.ok ? 'skeleton passed but should fail' : 'ok' });

    // 2. reference must PASS
    const ref = `${tmp}/reference`;
    copyDir(input.templateDir, ref);
    overlayDir(input.solutionDir, ref);
    const r2 = passes(ref, input.testCmd);
    stages.push({ name: 'reference-green', ok: r2.ok, detail: r2.ok ? 'ok' : r2.output.slice(-800) });

    // 3. each mutation atop reference must FAIL
    input.mutations.forEach((mut, i) => {
      const mdir = `${tmp}/mutation-${i}`;
      copyDir(input.templateDir, mdir);
      overlayDir(input.solutionDir, mdir);
      applyMutation(mdir, mut);
      const r = passes(mdir, input.testCmd);
      stages.push({
        name: `mutation-${i}-red (${mut.expect_fail})`,
        ok: !r.ok,
        detail: r.ok ? 'suite did NOT catch this mutation' : 'ok',
      });
    });

    return { ok: stages.every((s) => s.ok), stages };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @tryout/scenario-cli test -- gate`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add tools/scenario-cli/src/gate.ts tools/scenario-cli/test/gate.test.ts tools/scenario-cli/test/fixtures
git commit -m "feat(scenario-cli): gate runner (skeleton-red, reference-green, mutations-red)"
```

---

## Task 6: `seed` — upsert from manifest

**Files:**
- Create: `tools/scenario-cli/src/seed.ts`

This mirrors the upsert in `packages/db/src/seeds/seed-agent-scenarios.ts` but reads the
manifest. No unit test (it's a thin DB upsert verified by Task 10's manual run); the logic is
a straight port of the existing, already-exercised seed pattern.

- [ ] **Step 1: Implement**

`tools/scenario-cli/src/seed.ts`:

```ts
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@tryout/db';
import { loadManifest } from './manifest.js';

export async function seedScenario(id: string): Promise<void> {
  const m = loadManifest(id);
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgres://tryout:tryout@localhost:5432/tryout',
  );

  // ensure track
  const existingTrack = await db
    .select({ id: schema.tracks.id })
    .from(schema.tracks)
    .where(eq(schema.tracks.name, m.track))
    .limit(1);
  const trackId =
    existingTrack.length > 0
      ? existingTrack[0].id
      : (await db.insert(schema.tracks).values({ name: m.track }).returning())[0].id;

  // definition JSONB = the manifest minus the authoring-only `gate` block
  const { gate: _gate, ...definition } = m;

  const values = {
    trackId,
    title: m.title,
    version: m.version,
    definition,
    status: 'active',
    projectType: m.projectType,
    available: m.available,
  };

  const existing = await db
    .select({ id: schema.scenarios.id })
    .from(schema.scenarios)
    .where(eq(schema.scenarios.title, m.title))
    .limit(1);

  if (existing.length > 0) {
    await db.update(schema.scenarios).set(values).where(eq(schema.scenarios.id, existing[0].id));
    console.log(`seeded (updated) "${m.title}"`);
  } else {
    await db.insert(schema.scenarios).values(values);
    console.log(`seeded (inserted) "${m.title}"`);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @tryout/scenario-cli exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tools/scenario-cli/src/seed.ts
git commit -m "feat(scenario-cli): seed scenario from manifest"
```

---

## Task 7: `publish` — GitHub template repo via gh + git

**Files:**
- Create: `tools/scenario-cli/src/publish.ts`

Publishing pushes the **student** files (`template/` only — `solution/` excluded) to a GitHub
repo named `<GITHUB_OWNER>/<template_ref>` and marks it a template. Uses the already-authed
`gh` CLI + `git` (proven in the slice's C4). No unit test — it performs real GitHub writes;
verified manually in Task 10.

- [ ] **Step 1: Implement**

`tools/scenario-cli/src/publish.ts`:

```ts
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { loadManifest } from './manifest.js';
import { templateDir } from './paths.js';
import { copyDir, mkTemp } from './fsutil.js';

function sh(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, stdio: 'pipe', shell: true as never }).toString();
}

export async function publishScenario(id: string): Promise<void> {
  const m = loadManifest(id);
  const owner = process.env.GITHUB_OWNER;
  if (!owner) throw new Error('GITHUB_OWNER not set');
  const repo = `${owner}/${m.repo.template_ref}`;

  // Build a clean student copy: template/ only.
  const staging = mkTemp(`publish-${m.repo.template_ref}`);
  copyDir(templateDir(id), staging);

  // Init a fresh git repo and commit.
  sh('git init -q', staging);
  sh('git checkout -q -B main', staging);
  sh('git add .', staging);
  sh(`git -c user.email=bot@tryout -c user.name=tryout commit -q -m "scenario template: ${m.title}"`, staging);

  // Create the repo if it doesn't exist yet.
  let exists = true;
  try { sh(`gh repo view ${repo}`); } catch { exists = false; }
  if (!exists) {
    sh(`gh repo create ${repo} --private --disable-wiki`);
  }

  // Push (force — the template content is authoritative from the scenario folder).
  sh(`git remote add origin https://github.com/${repo}.git`, staging);
  sh('git push -q --force origin main', staging);

  // Mark as template (idempotent).
  sh(`gh repo edit ${repo} --template`);

  fs.rmSync(staging, { recursive: true, force: true });
  console.log(`published ${repo} (is_template=true), solution/ excluded`);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @tryout/scenario-cli exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tools/scenario-cli/src/publish.ts
git commit -m "feat(scenario-cli): publish student template repo via gh + git"
```

---

## Task 8: CLI router + `release` orchestration

**Files:**
- Create: `tools/scenario-cli/src/cli.ts`

- [ ] **Step 1: Implement**

`tools/scenario-cli/src/cli.ts`:

```ts
import fs from 'node:fs';
import { loadManifest } from './manifest.js';
import { validateManifest, type TemplateReader } from './validate.js';
import { runGate } from './gate.js';
import { seedScenario } from './seed.js';
import { publishScenario } from './publish.js';
import { templateDir, solutionDir } from './paths.js';
import { listFiles } from './fsutil.js';
import path from 'node:path';

function templateReader(id: string): TemplateReader {
  const root = templateDir(id);
  return {
    exists: (rel) => fs.existsSync(path.join(root, rel)),
    read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
  };
}

function doValidate(id: string): string[] {
  const m = loadManifest(id); // throws on schema errors
  const solFiles = fs.existsSync(solutionDir(id)) ? listFiles(solutionDir(id)) : [];
  return validateManifest(m, templateReader(id), solFiles);
}

function doGate(id: string) {
  const m = loadManifest(id);
  return runGate({
    templateDir: templateDir(id),
    solutionDir: solutionDir(id),
    testCmd: m.gate.test_cmd,
    mutations: m.gate.mutations,
  });
}

async function main() {
  const [cmd, id] = process.argv.slice(2);
  if (!cmd || !id) {
    console.error('usage: scenario <validate|gate|publish|seed|release> <id>');
    process.exit(2);
  }

  const validate = () => {
    const problems = doValidate(id);
    if (problems.length) {
      console.error(`validate FAILED for ${id}:\n` + problems.map((p) => `  - ${p}`).join('\n'));
      process.exit(1);
    }
    console.log(`validate OK: ${id}`);
  };

  const gate = () => {
    const res = doGate(id);
    for (const s of res.stages) console.log(`  [${s.ok ? 'PASS' : 'FAIL'}] ${s.name}${s.ok ? '' : ' — ' + s.detail}`);
    if (!res.ok) { console.error(`gate FAILED for ${id}`); process.exit(1); }
    console.log(`gate OK: ${id}`);
  };

  switch (cmd) {
    case 'validate': validate(); break;
    case 'gate': validate(); gate(); break;
    case 'seed': await seedScenario(id); break;
    case 'publish': await publishScenario(id); break;
    case 'release':
      validate(); gate();           // fail-closed: both exit(1) on failure before we ship
      await publishScenario(id);
      await seedScenario(id);
      console.log(`released ${id}`);
      break;
    default:
      console.error(`unknown command: ${cmd}`);
      process.exit(2);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
```

- [ ] **Step 2: Smoke-test the router help**

Run: `pnpm --filter @tryout/scenario-cli run cli`
Expected: prints usage, exits 2.

- [ ] **Step 3: Commit**

```bash
git add tools/scenario-cli/src/cli.ts
git commit -m "feat(scenario-cli): command router + fail-closed release"
```

---

## Task 9: Migrate `agent-foundations` into the convention

**Files:**
- Create: `scenarios/agent-foundations/scenario.json`
- Create: `scenarios/agent-foundations/template/…` (from `templates/agent-foundations-py`, minus `REFERENCE_SOLUTION.md`)
- Create: `scenarios/agent-foundations/solution/agent/model_call.py` (the reference impl)

- [ ] **Step 1: Copy the template (excluding the reference doc)**

```bash
mkdir -p scenarios/agent-foundations
cp -r templates/agent-foundations-py scenarios/agent-foundations/template
rm -f scenarios/agent-foundations/template/REFERENCE_SOLUTION.md
rm -rf scenarios/agent-foundations/template/*.egg-info scenarios/agent-foundations/template/.pytest_cache
```

- [ ] **Step 2: Create the solution overlay**

`scenarios/agent-foundations/solution/agent/model_call.py` (full reference — overlays the stub):

```python
"""TICKET AGENT-0: implement summarize()."""
from __future__ import annotations

from .llm_client import LlmClient

MODEL = "claude-haiku-4-5"
MAX_TOKENS = 256


class SummarizationError(Exception):
    pass


def summarize(client: LlmClient, text: str) -> str:
    try:
        response = client.create_message(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": f"Summarize in one sentence:\n\n{text}"}],
        )
    except Exception as exc:  # noqa: BLE001
        raise SummarizationError(str(exc)) from exc
    if not getattr(response, "content", None):
        raise SummarizationError("model returned no content")
    return response.content[0].text.strip()
```

- [ ] **Step 3: Write the manifest**

`scenarios/agent-foundations/scenario.json` — the rung-0 definition from
`seed-agent-scenarios.ts` (`RUNG_0`) plus `id`, `available: true`, and the `gate` block. Use
the mutation verified by hand in the slice (drop the document text from the prompt → request-shape
test fails):

```json
{
  "id": "agent-foundations",
  "track": "ai-agents",
  "title": "Wire up the model",
  "version": 1,
  "projectType": "backend_monolith",
  "available": true,
  "catalog": {
    "summary": "Your first AI-agent ticket: make a summarizer call the model correctly and handle its failures. Mocked-LLM tests, a real PR, a senior review.",
    "difficulty": "intro",
    "tags": ["AI agents", "Python", "Anthropic", "LLM"]
  },
  "team": ["product_manager", "senior_engineer", "backend_engineer"],
  "company_context": {
    "name": "Brief",
    "product": "Brief turns long documents into one-line summaries using an AI agent.",
    "team": "You're a new engineer on the agent team. The codebase is a small Python service.",
    "user_role": "AI Engineer (new hire, first ticket)"
  },
  "repo": { "template_ref": "agent-foundations-py", "default_branch": "main", "ci": "github-actions" },
  "ticket": {
    "id": "AGENT-0",
    "title": "Make the summarizer call the model",
    "body": "Implement summarize() in agent/model_call.py so it calls our model and returns a one-line summary. It needs to be solid — think about what happens when the model call fails or comes back empty. The acceptance tests describe the behavior; make them pass and open a PR."
  },
  "clarifications": [],
  "agent_prompts": {
    "pm_mai": { "system": "You are Mai, PM at Brief. Friendly, busy, practical. You assigned AGENT-0 to a new AI engineer. If they ask a clarifying question, answer directly. Do not volunteer implementation detail. Canonical answers when asked: error handling — \"Yes, if the model call throws or returns nothing, raise our SummarizationError, don't leak raw exceptions.\" Output — \"One sentence, trimmed of whitespace.\" Keep replies short and Slack-like." },
    "senior_alex": { "system": "You are Alex, a senior engineer at Brief. Clear, professional, slightly terse async English. CHAT: nudge, point at the right file, don't hand over the solution. PR REVIEW: specific comments tied to the code. Request changes at least once on the first submission. Catch: raw exceptions not wrapped, missing empty-content handling, wrong request shape, no tests. Approve once correct and clean." }
  },
  "ground_truth": {
    "solution_notes": "summarize() calls client.create_message with model claude-haiku-4-5, max_tokens 256, a single user message containing the text; returns response.content[0].text.strip(); wraps any client exception in SummarizationError; raises SummarizationError when content is empty.",
    "red_flags": ["raw exception leaks instead of SummarizationError", "no empty-content handling", "wrong model or message shape", "no PR description"]
  },
  "rubric": {
    "technical": { "weight": 0.5, "criteria": [
      { "id": "acceptance_tests_pass", "weight": 0.5, "description": "CI green — the mocked-LLM acceptance suite passes." },
      { "id": "error_handling", "weight": 0.3, "description": "Client failures and empty content both raise SummarizationError." },
      { "id": "request_shape", "weight": 0.2, "description": "Correct model, max_tokens, and single user message containing the text." }
    ] },
    "professional": { "weight": 0.5, "criteria": [
      { "id": "surfaced_ambiguity", "weight": 0.4, "description": "Asked the PM about error/empty behavior before implementing." },
      { "id": "pr_description", "weight": 0.3, "description": "PR explains what changed and why; states assumptions." },
      { "id": "response_to_review", "weight": 0.3, "description": "Incorporated senior feedback constructively across resubmits." }
    ] }
  },
  "gate": {
    "runtime": "python3.11",
    "test_cmd": "pip install -e \".[dev]\" -q && pytest -q",
    "mutations": [
      { "file": "agent/model_call.py", "find": "Summarize in one sentence:\\n\\n", "replace": "Summarize.", "expect_fail": "request-shape test (text dropped from prompt)" }
    ]
  }
}
```

- [ ] **Step 4: Validate + gate**

Run: `pnpm --filter @tryout/scenario-cli run cli validate agent-foundations`
Expected: `validate OK: agent-foundations`.

Run: `pnpm --filter @tryout/scenario-cli run cli gate agent-foundations`
Expected: all stages PASS (`skeleton-red`, `reference-green`, `mutation-0-red`), then `gate OK`.

> If `pip install` is slow/offline in the gate, that's environmental — the gate shells the
> real `test_cmd`. Ensure Python 3.11+ is on PATH.

- [ ] **Step 5: Commit**

```bash
git add scenarios/agent-foundations
git commit -m "feat(scenarios): migrate agent-foundations into scenario folder"
```

---

## Task 10: Migrate `agent-tools` into the convention

**Files:**
- Create: `scenarios/agent-tools/scenario.json`
- Create: `scenarios/agent-tools/template/…` (from `templates/agent-tools-py`, minus `REFERENCE_SOLUTION.md`)
- Create: `scenarios/agent-tools/solution/agent/tools.py` (reference impl)

- [ ] **Step 1: Copy the template**

```bash
mkdir -p scenarios/agent-tools
cp -r templates/agent-tools-py scenarios/agent-tools/template
rm -f scenarios/agent-tools/template/REFERENCE_SOLUTION.md
rm -rf scenarios/agent-tools/template/*.egg-info scenarios/agent-tools/template/.pytest_cache
```

- [ ] **Step 2: Solution overlay**

`scenarios/agent-tools/solution/agent/tools.py`:

```python
"""TICKET AGENT-1: wire up a tool."""
from __future__ import annotations

from typing import Any


class UnknownToolError(Exception):
    pass


WEATHER_TOOL: dict[str, Any] = {
    "name": "get_weather",
    "description": "Get the current weather for a city.",
    "input_schema": {
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"],
    },
}


def get_weather(city: str) -> str:
    return f"Weather in {city}: sunny, 24C"


def run_tool(name: str, arguments: dict[str, Any]) -> str:
    if name == "get_weather":
        return get_weather(arguments["city"])
    raise UnknownToolError(name)
```

- [ ] **Step 3: Manifest**

`scenarios/agent-tools/scenario.json` — the `RUNG_1` definition from `seed-agent-scenarios.ts`
plus `id`, `available`, and a `gate` block. Mutation: make `run_tool` ignore the name (drop the
`UnknownToolError` branch) → the reject-unknown-tool test fails.

```json
{
  "id": "agent-tools",
  "track": "ai-agents",
  "title": "Give it a tool",
  "version": 1,
  "projectType": "backend_monolith",
  "available": true,
  "catalog": {
    "summary": "Teach the agent to use a tool: define a tool schema, wire function-calling, dispatch the call. Mocked-LLM tests, a real PR, a senior review.",
    "difficulty": "intro",
    "tags": ["AI agents", "Python", "tool use", "function calling"]
  },
  "team": ["product_manager", "senior_engineer", "backend_engineer"],
  "company_context": {
    "name": "Brief",
    "product": "Brief is adding tool use so its agent can fetch live data.",
    "team": "You're on the agent team. The model call already works; now it needs a tool.",
    "user_role": "AI Engineer (second ticket)"
  },
  "repo": { "template_ref": "agent-tools-py", "default_branch": "main", "ci": "github-actions" },
  "ticket": {
    "id": "AGENT-1",
    "title": "Add a get_weather tool",
    "body": "Give the agent a get_weather tool: define its schema, and wire a dispatcher that runs the right tool when the model asks for it (and refuses unknown tools). The acceptance tests describe the contract; make them pass and open a PR."
  },
  "clarifications": [],
  "agent_prompts": {
    "pm_mai": { "system": "You are Mai, PM at Brief. You assigned AGENT-1. Canonical answers when asked: unknown tools — \"If the model names a tool we don't have, raise UnknownToolError, never guess.\" Schema — \"The tool takes one required string, city.\" Keep replies short and Slack-like; no implementation detail." },
    "senior_alex": { "system": "You are Alex, senior engineer at Brief. CHAT: nudge, don't solve. PR REVIEW: request changes at least once on the first submission. Catch: tool schema missing required city, dispatcher that ignores the tool name, no UnknownToolError path, no tests. Approve once correct and clean." }
  },
  "ground_truth": {
    "solution_notes": "WEATHER_TOOL is a schema with name get_weather, a description, and input_schema requiring a string city. run_tool dispatches get_weather by name and raises UnknownToolError otherwise. get_weather returns a string mentioning the city.",
    "red_flags": ["dispatcher ignores the tool name", "no UnknownToolError path", "schema missing required city", "no tests"]
  },
  "rubric": {
    "technical": { "weight": 0.5, "criteria": [
      { "id": "acceptance_tests_pass", "weight": 0.5, "description": "CI green — the mocked-LLM acceptance suite passes." },
      { "id": "dispatch_correctness", "weight": 0.3, "description": "Correct tool dispatched by name; unknown tools rejected." },
      { "id": "schema_shape", "weight": 0.2, "description": "Tool schema requires a string city." }
    ] },
    "professional": { "weight": 0.5, "criteria": [
      { "id": "surfaced_ambiguity", "weight": 0.4, "description": "Asked the PM about unknown-tool behavior before implementing." },
      { "id": "pr_description", "weight": 0.3, "description": "PR explains what changed and why." },
      { "id": "response_to_review", "weight": 0.3, "description": "Incorporated senior feedback across resubmits." }
    ] }
  },
  "gate": {
    "runtime": "python3.11",
    "test_cmd": "pip install -e \".[dev]\" -q && pytest -q",
    "mutations": [
      { "file": "agent/tools.py", "find": "    raise UnknownToolError(name)", "replace": "    return get_weather(arguments[\"city\"])", "expect_fail": "reject-unknown-tool test" }
    ]
  }
}
```

- [ ] **Step 4: Validate + gate**

Run: `pnpm --filter @tryout/scenario-cli run cli validate agent-tools`
Expected: `validate OK`.

Run: `pnpm --filter @tryout/scenario-cli run cli gate agent-tools`
Expected: all stages PASS, `gate OK`.

- [ ] **Step 5: Commit**

```bash
git add scenarios/agent-tools
git commit -m "feat(scenarios): migrate agent-tools into scenario folder"
```

---

## Task 11: Retire the superseded agent seed + verify engine

**Files:**
- Delete: `packages/db/src/seeds/seed-agent-scenarios.ts`
- Modify: `packages/db/package.json` (remove the `seed:agents` script)

- [ ] **Step 1: Remove the old seed + script**

```bash
git rm packages/db/src/seeds/seed-agent-scenarios.ts
```
In `packages/db/package.json`, delete the line:
```json
    "seed:agents": "tsx src/seeds/seed-agent-scenarios.ts",
```

(`seed-scenario-01.ts` and the `templates/agent-*` dirs stay — scenario-01 is unmigrated, and
the live GitHub template repos already exist. The `templates/agent-*` dirs become redundant with
`scenarios/agent-*/template`, but removing them is deferred until scenario-01 is migrated so this
task touches only the agent-seed path.)

- [ ] **Step 2: Engine regression — API suites untouched and green**

Run: `pnpm --filter @tryout/api test`
Expected: all green (P1 didn't touch the API).

- [ ] **Step 3: Commit**

```bash
git add packages/db/package.json
git commit -m "chore(db): retire seed-agent-scenarios (superseded by scenario CLI)"
```

---

## Task 12: Manual release verification (real DB + GitHub)

These steps perform real writes (DB upsert + GitHub push), so they're a documented manual run,
not an automated test. Requires infra up + `GITHUB_TOKEN`/`GITHUB_OWNER` in env.

- [ ] **Step 1: Seed both scenarios via the CLI**

```bash
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout \
  pnpm --filter @tryout/scenario-cli run cli seed agent-foundations
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout \
  pnpm --filter @tryout/scenario-cli run cli seed agent-tools
```
Expected: `seeded (updated) "Wire up the model"` / `"Give it a tool"` (rows already exist from the slice).

- [ ] **Step 2: Verify the DB rows still match**

```bash
docker exec tryout-postgres-1 psql -U tryout -tAc \
  "select title, available, definition->'repo'->>'template_ref' from scenarios where title in ('Wire up the model','Give it a tool');"
```
Expected: both rows, `available=t`, correct `template_ref`.

- [ ] **Step 3: Re-publish one repo via the CLI (idempotent update)**

```bash
GITHUB_OWNER=tryout-dev GITHUB_TOKEN=<pat> \
  pnpm --filter @tryout/scenario-cli run cli publish agent-foundations
```
Expected: `published tryout-dev/agent-foundations-py (is_template=true), solution/ excluded`. Confirm the repo still has no `REFERENCE_SOLUTION.md` and `solution/` is absent:
```bash
gh api repos/tryout-dev/agent-foundations-py/contents/solution 2>&1 | tail -1   # expect 404
```

- [ ] **Step 4: Update STATUS doc**

Note in `docs/STATUS.md` that P1 (scenario-authoring CLI) is live and the 2 agent scenarios are managed through it.

```bash
git add docs/STATUS.md
git commit -m "docs: record scenario-authoring CLI (P1) live"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** folder convention → Tasks 9/10; manifest+schema → Task 2; `validate` → Task 3; `gate` (skeleton-red/reference-green/mutations-red) → Task 5; `seed` → Task 6; `publish` (gh+git, solution/ excluded) → Task 7; `release` fail-closed → Task 8; migrate 2 agent scenarios → Tasks 9/10; retire old seed → Task 11; scenario-01 left as-is → stated in Task 11; testing (validate/fsutil/gate units + negative gate) → Tasks 3/4/5; engine regression → Task 11.
- **Deviation from spec:** publish uses `gh` + `git` (proven in the slice) instead of `@octokit/rest` — simpler, already authed, no token plumbing. CLI lives in `tools/scenario-cli` with a one-line `pnpm-workspace.yaml` addition.
- **Placeholder scan:** none — all code (schema, validate, fsutil, gate, seed, publish, cli, both manifests, both solutions) is given in full.
- **Type consistency:** `ScenarioManifest` (Task 2) consumed by validate/seed/publish/cli; `TemplateReader` defined in Task 3 and constructed in Task 8; `runGate`/`GateInput` defined Task 5 and called Task 8; mutation shape `{file,find,replace,expect_fail}` identical across manifest, fsutil, gate.
