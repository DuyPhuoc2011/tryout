import type { Sql } from './db';

export interface Job {
  id: string;
  duration_ms: number;
  cpu_ratio: number;
  enqueued_at: Date;
  started_at: Date;
}

/** Ceiling on a single job, above the 20-minute jobs P2 is specified to contain. */
const MAX_DURATION_MS = 45 * 60 * 1000;

export async function enqueue(
  sql: Sql,
  durationMs: number,
  cpuRatio: number,
): Promise<{ id: string }> {
  const duration = Math.min(Math.max(Math.floor(durationMs), 1), MAX_DURATION_MS);
  const ratio = Math.min(Math.max(cpuRatio, 0), 1);

  const [row] = await sql<{ id: string }[]>`
    insert into workload_jobs (duration_ms, cpu_ratio)
    values (${duration}, ${ratio})
    returning id
  `;
  return row;
}

/**
 * Take one queued job, or nothing.
 *
 * `FOR UPDATE SKIP LOCKED` inside the subselect is what lets every instance of
 * the worker tier poll the same table without either blocking on each other or
 * handing the same job to two workers. It is the same claim pattern the arena
 * runner uses, for the same reason.
 *
 * The queue is Postgres rather than Redis because the split-out worker service
 * has no route to the API's Redis sidecar — see the note in config.ts.
 */
export async function claim(sql: Sql, workerId: string): Promise<Job | null> {
  const [job] = await sql<Job[]>`
    update workload_jobs
       set status = 'running', started_at = now(), worker_id = ${workerId}
     where id = (
       select id from workload_jobs
        where status = 'queued'
        order by id
          for update skip locked
        limit 1
     )
     returning id, duration_ms, cpu_ratio, enqueued_at, started_at
  `;
  return job ?? null;
}

export async function complete(sql: Sql, id: string): Promise<void> {
  await sql`
    update workload_jobs
       set status = 'done', finished_at = now()
     where id = ${id} and status = 'running'
  `;
}

/**
 * The measurement surface for M0 steps 3 and 4.
 *
 * job-start p95 is the number the crossover turns on: it is where a scaled-to-
 * zero worker tier, a throttled idle instance, and a saturated pool all show
 * up, and none of them are visible in API latency.
 */
export async function stats(sql: Sql): Promise<Record<string, unknown>> {
  const [row] = await sql<Record<string, unknown>[]>`
    select
      count(*) filter (where status = 'queued')  as queued,
      count(*) filter (where status = 'running') as running,
      count(*) filter (where status = 'done')    as done,
      coalesce(extract(epoch from percentile_cont(0.95) within group (
        order by started_at - enqueued_at
      )) * 1000, 0) as job_start_p95_ms,
      coalesce(extract(epoch from percentile_cont(0.95) within group (
        order by finished_at - started_at
      )) * 1000, 0) as job_duration_p95_ms,
      coalesce(extract(epoch from max(now() - enqueued_at) filter (
        where status = 'queued'
      )), 0) as oldest_queued_age_s
    from workload_jobs
  `;
  return row;
}
