import type { DesignConfig } from './schema';
import { sanitizeText } from './text-safety';

/**
 * Variables for the first-party Terraform module that builds a buyer
 * environment. Every field is a primitive: the module is fixed code that was
 * written and reviewed here, and buyer input only ever selects values within it.
 *
 * Nothing in this type can express a container image, a provisioner, a command,
 * or a provider — that is the point.
 */
export interface ArenaTfvars {
  environment_id: string;
  api_min_instances: number;
  api_max_instances: number;
  api_concurrency: number;
  api_cpu: number;
  api_memory: string;
  worker_service_enabled: boolean;
  worker_min_instances: number;
  worker_max_instances: number;
  cache_enabled: boolean;
  cache_tier: string;
  db_tier: string;
}

/** Environment ids become GCP resource names, so they must be strict slugs. */
const ENVIRONMENT_ID_PATTERN = /^env-[a-z0-9]{6,32}$/;

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
