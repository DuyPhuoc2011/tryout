import { z } from 'zod';
import type { ParseError } from './parse';
import type { DesignConfig } from './schema';
import { sanitizeText } from './text-safety';

/** Environment ids become GCP resource names, so they must be strict slugs. */
const ENVIRONMENT_ID_PATTERN = /^env-[a-z0-9]{6,32}$/;

/**
 * Variables for the first-party Terraform module that builds a buyer
 * environment. Every field is a primitive: the module is fixed code that was
 * written and reviewed here, and buyer input only ever selects values within it.
 *
 * Nothing in this schema can express a container image, a provisioner, a
 * command, or a provider — that is the point.
 *
 * A runtime schema rather than a bare interface because these variables make a
 * round trip through a jsonb column before the runner feeds them to Terraform,
 * and a TypeScript interface is erased by then. Bounds mirror `designSchema`,
 * since every value here is derived from one there.
 */
export const arenaTfvarsSchema = z
  .object({
    environment_id: z.string().regex(ENVIRONMENT_ID_PATTERN),
    api_min_instances: z.number().int().min(0).max(5),
    api_max_instances: z.number().int().min(1).max(20),
    api_concurrency: z.number().int().min(1).max(250),
    api_cpu: z.union([z.literal(0.5), z.literal(1), z.literal(2)]),
    api_memory: z.enum(['512Mi', '1Gi', '2Gi']),
    worker_service_enabled: z.boolean(),
    worker_min_instances: z.number().int().min(0).max(3),
    worker_max_instances: z.number().int().min(1).max(20),
    cache_enabled: z.boolean(),
    cache_tier: z.enum(['basic-1gb', 'standard-1gb']),
    db_tier: z.enum(['micro', 'small', 'medium']),
  })
  .strict();

export type ArenaTfvars = z.infer<typeof arenaTfvarsSchema>;

export type TfvarsResult =
  | { ok: true; tfvars: ArenaTfvars }
  | { ok: false; errors: ParseError[] };

/**
 * Validate a stored `ArenaTfvars` before it reaches Terraform.
 *
 * `renderTfvars` already guarantees the shape at write time, so in a correct
 * system this always succeeds. It exists for the read side: the runner loads
 * these variables from `arena_turns.tfvars`, and a jsonb column is not a type.
 * A future migration, a manual UPDATE, or a restored backup could put anything
 * there, and the value is about to become arguments to a command that creates
 * billable infrastructure. Strict object, so an unknown key is a hard failure
 * rather than a silently ignored one.
 *
 * Never throws; errors are sanitized because they are stored and later shown
 * to a buyer.
 */
export function parseTfvars(value: unknown): TfvarsResult {
  const result = arenaTfvarsSchema.safeParse(value);

  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => ({
        path: sanitizeText(issue.path.length > 0 ? issue.path.join('.') : 'document'),
        message: sanitizeText(issue.message),
      })),
    };
  }

  return { ok: true, tfvars: result.data };
}

/**
 * Convert a validated design into Terraform variables.
 *
 * `design` is trust-bounded: it is an already-parsed `DesignConfig`, and
 * `parseDesign` is the only entry point that produces one from raw text, so
 * this function cannot be reached with untrusted design input. `environmentId`
 * carries no such guarantee — it is a second, independent parameter that will
 * most likely arrive from a route parameter once a caller exists. It is
 * validated against a strict slug pattern below, and sanitized before being
 * echoed into the error message: regex rejection alone does not make a value
 * safe to render back to a caller.
 */
export function renderTfvars(design: DesignConfig, environmentId: string): ArenaTfvars {
  if (!ENVIRONMENT_ID_PATTERN.test(environmentId)) {
    throw new Error(
      `renderTfvars: environmentId must match ${ENVIRONMENT_ID_PATTERN.source}, got "${sanitizeText(environmentId)}"`,
    );
  }

  const workersAreSeparate = design.workers.placement === 'separate_service';

  return {
    environment_id: environmentId,
    api_min_instances: design.api.min_instances,
    api_max_instances: design.api.max_instances,
    api_concurrency: design.api.concurrency,
    api_cpu: design.api.cpu,
    api_memory: design.api.memory,
    worker_service_enabled: workersAreSeparate,
    worker_min_instances: workersAreSeparate ? design.workers.min_instances : 0,
    // The worker service shares the API's ceiling; a separate lever would be
    // one more thing to tune without teaching anything the others do not.
    worker_max_instances: design.api.max_instances,
    cache_enabled: design.cache.enabled,
    cache_tier: design.cache.tier,
    db_tier: design.db.tier,
  };
}
