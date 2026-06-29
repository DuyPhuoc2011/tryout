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
