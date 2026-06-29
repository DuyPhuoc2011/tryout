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
