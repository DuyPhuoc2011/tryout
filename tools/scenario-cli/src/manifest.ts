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
