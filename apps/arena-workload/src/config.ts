/**
 * Every knob the arena's Terraform module can set, read in one place.
 *
 * The module passes DATABASE_URL, REDIS_URL, WORKERS_IN_PROCESS and (on the
 * split worker service only) WORKER_ONLY. Everything else has a default so the
 * image runs locally with nothing but a database.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

function int(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export interface Config {
  port: number;
  databaseUrl: string;
  /** This process consumes the job queue. */
  runWorker: boolean;
  /** This process serves only /healthz — it is the split-out worker service. */
  workerOnly: boolean;
  workerConcurrency: number;
  pollIntervalMs: number;
}

export function loadConfig(): Config {
  const workerOnly = bool('WORKER_ONLY', false);

  return {
    port: int('PORT', 8080),
    databaseUrl: required('DATABASE_URL'),
    // The worker service always works; the API service works only when the
    // buyer has NOT split the worker tier out. That single flag is the
    // `workers.placement` lever the whole crossover is built on.
    runWorker: workerOnly || bool('WORKERS_IN_PROCESS', true),
    workerOnly,
    workerConcurrency: int('WORKER_CONCURRENCY', 1),
    pollIntervalMs: int('JOB_POLL_MS', 250),
  };
}

// ponytail: REDIS_URL is deliberately ignored.
//
// The arena module wires Redis as a per-instance Cloud Run SIDECAR at
// 127.0.0.1, which the split-out worker service cannot reach and which is cold
// on every scale-out. A queue there would not survive the very lever M0 has to
// measure, so the queue is in Postgres (see queue.ts) and `cache.enabled`
// stays a pure cost lever until something actually reads through it.
//
// Upgrade path: when a scenario needs a real cache hit-rate signal, add a
// read-through cache on GET /api/report and have the module point REDIS_URL at
// a shared Memorystore instance rather than the sidecar.
