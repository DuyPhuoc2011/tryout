import { randomUUID } from 'node:crypto';
import type { Sql } from './db';
import { claim, complete } from './queue';

const SLICE_MS = 100;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Spend `durationMs` of wall clock, of which roughly `cpuRatio` is real CPU.
 *
 * A job that only slept would cost almost no vCPU-seconds, and vCPU-seconds are
 * exactly what the pricing model converts to money — a sleeping workload would
 * make every configuration look free and the crossover would vanish into
 * rounding. Burning a share of each slice keeps measured usage honest.
 *
 * ponytail: a busy-loop, not real work. It is indistinguishable from real work
 * to Cloud Run's billing and to the CPU throttle, which is all M0 measures. If
 * a scenario ever needs realistic memory or IO pressure, this is the seam.
 */
async function burn(durationMs: number, cpuRatio: number): Promise<void> {
  const deadline = Date.now() + durationMs;
  const busyMs = SLICE_MS * cpuRatio;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const slice = Math.min(SLICE_MS, remaining);
    const busy = Math.min(busyMs, slice);

    const spinUntil = Date.now() + busy;
    while (Date.now() < spinUntil) {
      /* deliberate spin */
    }

    const idle = slice - busy;
    if (idle > 0) await sleep(idle);
  }
}

/**
 * One polling consumer. Runs in the API process when the buyer keeps workers
 * in-process, and in the split-out worker service when they do not.
 */
export function startWorker(
  sql: Sql,
  opts: { pollIntervalMs: number; concurrency: number },
): () => void {
  let running = true;
  const workerId = `${process.env.K_REVISION ?? 'local'}-${randomUUID().slice(0, 8)}`;

  async function loop(): Promise<void> {
    while (running) {
      try {
        const job = await claim(sql, workerId);
        if (!job) {
          await sleep(opts.pollIntervalMs);
          continue;
        }
        await burn(job.duration_ms, job.cpu_ratio);
        await complete(sql, job.id);
      } catch (error) {
        // Keep polling. A worker that exits on a transient database error
        // silently turns a saturation incident into a stalled queue, and the
        // stalled queue is what the buyer is being measured on.
        console.error('worker loop error', error);
        await sleep(opts.pollIntervalMs);
      }
    }
  }

  for (let i = 0; i < opts.concurrency; i += 1) {
    void loop();
  }

  return () => {
    running = false;
  };
}
