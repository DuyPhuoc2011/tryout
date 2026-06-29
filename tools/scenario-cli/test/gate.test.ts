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
