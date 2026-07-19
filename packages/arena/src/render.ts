import type { DesignConfig } from './schema';

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
 * Takes an already-parsed DesignConfig, so it cannot be reached with untrusted
 * input: parseDesign is the only entry point for raw text.
 */
export function renderTfvars(design: DesignConfig, environmentId: string): ArenaTfvars {
  if (!ENVIRONMENT_ID_PATTERN.test(environmentId)) {
    throw new Error(
      `renderTfvars: environmentId must match ${ENVIRONMENT_ID_PATTERN}, got "${environmentId}"`,
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
