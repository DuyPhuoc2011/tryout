import postgres from 'postgres';

export type Sql = postgres.Sql<Record<string, never>>;

export function connect(databaseUrl: string): Sql {
  // Small pool on purpose: an arena environment runs on a shared Postgres VM
  // with a per-role CONNECTION LIMIT set by db_tier, and a fleet of Cloud Run
  // instances each opening a large pool is how that lever gets hit. Saturation
  // should come from the buyer's instance-count choices, not from a pool size
  // they cannot see.
  return postgres(databaseUrl, { max: 4, idle_timeout: 20, connect_timeout: 10 });
}

/**
 * Create the workload's tables if they are absent.
 *
 * ponytail: DDL at boot instead of a migration tool. An arena environment is
 * created by `terraform apply`, lives for a TTL measured in hours, and is
 * destroyed — there is no second version of this schema to migrate from. If
 * this workload ever outlives one environment, that is the moment to give it
 * real migrations.
 */
export async function bootstrap(sql: Sql): Promise<void> {
  await sql`
    create table if not exists workload_jobs (
      id           bigserial primary key,
      duration_ms  integer     not null,
      cpu_ratio    real        not null default 0.2,
      status       text        not null default 'queued',
      worker_id    text,
      enqueued_at  timestamptz not null default now(),
      started_at   timestamptz,
      finished_at  timestamptz
    )
  `;

  // Partial index: the claim query only ever looks at queued rows, and a
  // finished environment accumulates thousands of done rows it must not scan.
  await sql`
    create index if not exists workload_jobs_queued_idx
      on workload_jobs (id) where status = 'queued'
  `;
}
