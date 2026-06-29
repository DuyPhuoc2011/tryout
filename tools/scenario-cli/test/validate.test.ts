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
