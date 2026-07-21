/**
 * Quotas exist because every environment and every apply costs real money on
 * infrastructure we own. These are the ceilings referenced in the design spec.
 */

/** Hours an environment lives before the reaper may destroy it. */
export const ENVIRONMENT_TTL_HOURS = 72;

/** Global cap on environments not yet destroyed. Beyond this, creation is refused. */
export const MAX_CONCURRENT_ENVIRONMENTS = 25;

/** Per-buyer cap on turns submitted in a rolling hour. Each turn is an apply. */
export const MAX_TURNS_PER_HOUR = 6;

/** Statuses that still consume infrastructure, and so count against the cap. */
export const LIVE_ENVIRONMENT_STATUSES = [
  'pending',
  'provisioning',
  'ready',
  'degraded',
] as const;
