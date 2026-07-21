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

/**
 * Postgres advisory lock key serializing environment-creation transactions.
 *
 * MAX_CONCURRENT_ENVIRONMENTS is enforced by application code (count-check
 * then insert), not by a database constraint — Postgres has no native way to
 * cap a table's live row count. Without serialization that check-then-insert
 * is a TOCTOU race: N concurrent creates can all read the same count, all
 * pass the check, and all insert, overshooting the cap by up to N-1. A
 * single Postgres instance behind a single API pool makes a session-scoped
 * advisory lock (held for the duration of the transaction, released
 * automatically on commit or rollback) sufficient — no distributed locking
 * needed. Value is arbitrary; it only needs to be a stable, process-wide key
 * not reused by any other subsystem's advisory locks.
 */
export const ARENA_CREATE_LOCK_KEY = 88_402_617;
