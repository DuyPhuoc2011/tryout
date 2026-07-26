/**
 * Self-check for the claim path. Run against a live Postgres:
 *
 *   DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout pnpm --filter @tryout/arena-workload check
 *
 * ponytail: one script, no test framework. The only logic here that can be
 * wrong in a way that matters is the SKIP LOCKED claim handing one job to two
 * workers, and that assertion needs a real database — a mock cannot make it.
 */
import assert from 'node:assert/strict';
import { bootstrap, connect } from './db';
import { claim, complete, enqueue, stats } from './queue';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const sql = connect(url);
  await bootstrap(sql);
  await sql`delete from workload_jobs`;

  // Enqueue clamps to sane bounds.
  const { id } = await enqueue(sql, 1234, 0.5);
  const [stored] = await sql<{ duration_ms: number; cpu_ratio: number; status: string }[]>`
    select duration_ms, cpu_ratio, status from workload_jobs where id = ${id}
  `;
  assert.equal(stored.duration_ms, 1234);
  assert.equal(stored.status, 'queued');

  // A claim marks the job running and stamps started_at.
  const claimed = await claim(sql, 'worker-a');
  assert.ok(claimed, 'expected to claim the queued job');
  assert.equal(claimed.id, id);
  assert.ok(claimed.started_at instanceof Date);

  // The queue is now empty, so a second worker gets nothing rather than the
  // same job twice.
  assert.equal(await claim(sql, 'worker-b'), null);

  await complete(sql, claimed.id);
  const [done] = await sql<{ status: string }[]>`
    select status from workload_jobs where id = ${id}
  `;
  assert.equal(done.status, 'done');

  // Two concurrent claimers over two queued jobs must take one each: this is
  // the assertion the whole worker tier rests on.
  await enqueue(sql, 5, 0);
  await enqueue(sql, 5, 0);
  const [first, second] = await Promise.all([claim(sql, 'w1'), claim(sql, 'w2')]);
  assert.ok(first && second, 'both workers should have claimed a job');
  assert.notEqual(first.id, second.id, 'the same job was claimed twice');

  const summary = await stats(sql);
  assert.equal(Number(summary.running), 2);
  assert.equal(Number(summary.done), 1);

  await sql`delete from workload_jobs`;
  await sql.end({ timeout: 5 });
  console.log('queue self-check passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
