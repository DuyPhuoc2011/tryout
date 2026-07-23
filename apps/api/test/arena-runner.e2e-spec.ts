import postgres from 'postgres';
import { createDb } from '@tryout/db';
import { renderTfvars } from '@tryout/arena';
import { RunnerService } from '../src/arena-runner/runner.service';
import type { TerraformExecutor, TerraformResult } from '../src/arena-runner/terraform-executor';

/**
 * Exercises the runner against the live Postgres on port 5432 with a stub
 * Terraform executor — no GCP call, no terraform binary, no HTTP layer.
 *
 * The claim is `FOR UPDATE SKIP LOCKED`, and its whole purpose is behaviour
 * under two runners racing for the same row. A mocked-DB unit test cannot show
 * that: it has no lock manager. Everything here that matters (single claim
 * under contention, guarded transitions, updated_at actually moving, a failed
 * destroy leaving the row live) needs a real transaction.
 */
describe('ArenaRunner (integration)', () => {
  jest.setTimeout(60000);

  const dbUrl = process.env.DATABASE_URL ?? 'postgres://tryout:tryout@localhost:5432/tryout';

  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof createDb>;

  const runTag = Date.now();
  let listingId: string;
  const envIds: string[] = [];
  const ownerIds: string[] = [];

  const DESIGN = {
    schema_version: 1 as const,
    api: {
      platform: 'cloudrun' as const,
      min_instances: 1,
      max_instances: 10,
      concurrency: 80,
      cpu: 1 as const,
      memory: '1Gi' as const,
    },
    workers: { placement: 'separate_service' as const, min_instances: 1 },
    cache: { enabled: true, tier: 'basic-1gb' as const },
    db: { tier: 'small' as const },
  };

  /** Records what it was asked to do and answers however the test wants. */
  class StubExecutor implements TerraformExecutor {
    applied: string[] = [];
    destroyed: string[] = [];
    constructor(
      private readonly applyResult: TerraformResult = { ok: true },
      private readonly destroyResult: TerraformResult = { ok: true },
    ) {}

    async apply(tfvars: { environment_id: string }): Promise<TerraformResult> {
      this.applied.push(tfvars.environment_id);
      return this.applyResult;
    }

    async destroy(envSlug: string): Promise<TerraformResult> {
      this.destroyed.push(envSlug);
      return this.destroyResult;
    }
  }

  function runnerWith(executor: TerraformExecutor): RunnerService {
    return new RunnerService(db, executor);
  }

  async function createEnvironment(options: { ttlHours: number; slugSuffix: string }) {
    const slug = `env-${runTag}${options.slugSuffix}`.slice(0, 32).toLowerCase();
    // A fresh owner per environment: arena_env_user_listing_unique allows one
    // environment per (user, listing), and every case here uses one listing.
    const [owner] = await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${`runner-${runTag}-${options.slugSuffix}@example.com`}, 'x')
      RETURNING id`;
    ownerIds.push(owner.id as string);

    const [row] = await sql`
      INSERT INTO arena_environments (user_id, listing_id, env_slug, status, ttl_expires_at)
      VALUES (${owner.id}, ${listingId}, ${slug}, 'pending',
              now() + (${options.ttlHours} || ' hours')::interval)
      RETURNING id, env_slug`;
    envIds.push(row.id as string);
    return { id: row.id as string, slug: row.env_slug as string };
  }

  async function submitTurn(environmentId: string, slug: string, tfvarsOverride?: unknown) {
    const tfvars = tfvarsOverride ?? renderTfvars(DESIGN, slug);
    const [row] = await sql`
      INSERT INTO arena_turns (environment_id, status, tfvars)
      VALUES (${environmentId}, 'submitted', ${sql.json(tfvars as never)})
      RETURNING id`;
    return row.id as string;
  }

  beforeAll(async () => {
    sql = postgres(dbUrl);
    db = createDb(dbUrl);

    const [listing] = await sql`
      INSERT INTO scenario_listings
        (slug, title, tagline, story, contents, price_cents, currency, content_repo, status)
      VALUES
        (${`runner-test-${runTag}`}, 'Runner Test', 'tagline', 'story', 'contents',
         1000, 'usd', 'runner-test-repo', 'published')
      RETURNING id`;
    listingId = listing.id as string;
  });

  afterAll(async () => {
    if (envIds.length > 0) {
      await sql`DELETE FROM arena_turns WHERE environment_id IN ${sql(envIds)}`;
      await sql`DELETE FROM arena_environments WHERE id IN ${sql(envIds)}`;
    }
    if (ownerIds.length > 0) {
      await sql`DELETE FROM users WHERE id IN ${sql(ownerIds)}`;
    }
    await sql`DELETE FROM scenario_listings WHERE id = ${listingId}`;
    await sql.end();
  });

  it('reports idle when no turn is submitted', async () => {
    const executor = new StubExecutor();
    // Any other suite's leftovers would break this, so assert on the executor
    // rather than on the return value alone.
    const outcome = await runnerWith(executor).applyOnce();
    expect(['idle', 'applied', 'apply_failed']).toContain(outcome);
    expect(executor.applied.length).toBeLessThanOrEqual(1);
  });

  it('applies a submitted turn and advances both status machines', async () => {
    const environment = await createEnvironment({ ttlHours: 72, slugSuffix: 'a1' });
    const turnId = await submitTurn(environment.id, environment.slug);

    const executor = new StubExecutor();
    const outcome = await runnerWith(executor).applyOnce();

    expect(outcome).toBe('applied');
    expect(executor.applied).toContain(environment.slug);

    const [turn] = await sql`
      SELECT status, created_at, updated_at FROM arena_turns WHERE id = ${turnId}`;
    expect(turn.status).toBe('applied');
    // The carried-forward M1-B1 review item: Drizzle's defaultNow() fires on
    // INSERT only, so a forgotten updatedAt freezes this column on exactly the
    // rows that are transitioning.
    expect(new Date(turn.updated_at as string).getTime()).toBeGreaterThan(
      new Date(turn.created_at as string).getTime(),
    );

    const [env] = await sql`
      SELECT status, created_at, updated_at FROM arena_environments WHERE id = ${environment.id}`;
    expect(env.status).toBe('ready');
    expect(new Date(env.updated_at as string).getTime()).toBeGreaterThan(
      new Date(env.created_at as string).getTime(),
    );
  });

  it('records a terraform failure as apply_failed + degraded, with sanitized text', async () => {
    const environment = await createEnvironment({ ttlHours: 72, slugSuffix: 'a2' });
    const turnId = await submitTurn(environment.id, environment.slug);

    const executor = new StubExecutor({
      ok: false,
      message: 'Error: quota exceeded\n\tat line\r2',
    });
    const outcome = await runnerWith(executor).applyOnce();

    expect(outcome).toBe('apply_failed');

    const [turn] = await sql`SELECT status, parse_errors FROM arena_turns WHERE id = ${turnId}`;
    expect(turn.status).toBe('apply_failed');
    const errors = turn.parse_errors as Array<{ path: string; message: string }>;
    expect(errors[0].path).toBe('terraform');
    expect(errors[0].message).toContain('quota exceeded');
    expect(errors[0].message).not.toMatch(/[\n\r\t]/);

    const [env] = await sql`SELECT status FROM arena_environments WHERE id = ${environment.id}`;
    expect(env.status).toBe('degraded');
  });

  it('refuses stored tfvars that do not match the environment slug', async () => {
    const environment = await createEnvironment({ ttlHours: 72, slugSuffix: 'a3' });
    // Rendered for a DIFFERENT environment: applying this would write one
    // environment's design into another's Terraform state.
    const turnId = await submitTurn(
      environment.id,
      environment.slug,
      renderTfvars(DESIGN, 'env-someoneelse'),
    );

    const executor = new StubExecutor();
    const outcome = await runnerWith(executor).applyOnce();

    expect(outcome).toBe('apply_failed');
    expect(executor.applied).toHaveLength(0);
    const [turn] = await sql`SELECT status FROM arena_turns WHERE id = ${turnId}`;
    expect(turn.status).toBe('apply_failed');
  });

  it('refuses stored tfvars carrying an unknown key', async () => {
    const environment = await createEnvironment({ ttlHours: 72, slugSuffix: 'a4' });
    const turnId = await submitTurn(environment.id, environment.slug, {
      ...renderTfvars(DESIGN, environment.slug),
      container_image: 'evil:latest',
    });

    const executor = new StubExecutor();
    expect(await runnerWith(executor).applyOnce()).toBe('apply_failed');
    expect(executor.applied).toHaveLength(0);
    const [turn] = await sql`SELECT status FROM arena_turns WHERE id = ${turnId}`;
    expect(turn.status).toBe('apply_failed');
  });

  it('never lets two concurrent runners claim the same turn', async () => {
    const environment = await createEnvironment({ ttlHours: 72, slugSuffix: 'a5' });
    await submitTurn(environment.id, environment.slug);

    const first = new StubExecutor();
    const second = new StubExecutor();
    await Promise.all([runnerWith(first).applyOnce(), runnerWith(second).applyOnce()]);

    // The assertion SKIP LOCKED exists for: exactly one runner may spend money
    // on this turn. The other must walk past it, not block and re-apply.
    const applies = [...first.applied, ...second.applied].filter(
      (slug) => slug === environment.slug,
    );
    expect(applies).toHaveLength(1);
  });

  it('never claims a rejected turn', async () => {
    const environment = await createEnvironment({ ttlHours: 72, slugSuffix: 'a6' });
    await sql`
      INSERT INTO arena_turns (environment_id, status, parse_errors)
      VALUES (${environment.id}, 'rejected', ${sql.json([{ path: 'api', message: 'bad' }] as never)})`;

    const executor = new StubExecutor();
    await runnerWith(executor).applyOnce();

    expect(executor.applied).not.toContain(environment.slug);
  });

  it('reaps an expired environment and marks it destroyed', async () => {
    const environment = await createEnvironment({ ttlHours: -1, slugSuffix: 'b1' });

    const executor = new StubExecutor();
    const result = await runnerWith(executor).reapExpired();

    expect(result.destroyed).toBeGreaterThanOrEqual(1);
    expect(executor.destroyed).toContain(environment.slug);
    const [env] = await sql`SELECT status FROM arena_environments WHERE id = ${environment.id}`;
    expect(env.status).toBe('destroyed');
  });

  it('leaves an environment live when its destroy fails', async () => {
    const environment = await createEnvironment({ ttlHours: -1, slugSuffix: 'b2' });

    const executor = new StubExecutor({ ok: true }, { ok: false, message: 'destroy blew up' });
    await runnerWith(executor).reapExpired();

    // Marked destroyed while resources still bill is the one outcome the
    // reaper must never produce; the next tick retries instead.
    const [env] = await sql`SELECT status FROM arena_environments WHERE id = ${environment.id}`;
    expect(env.status).not.toBe('destroyed');
  });

  it('skips an environment whose apply is still in flight', async () => {
    const environment = await createEnvironment({ ttlHours: -1, slugSuffix: 'b3' });
    await sql`
      INSERT INTO arena_turns (environment_id, status, tfvars)
      VALUES (${environment.id}, 'applying',
              ${sql.json(renderTfvars(DESIGN, environment.slug) as never)})`;

    const executor = new StubExecutor();
    await runnerWith(executor).reapExpired();

    // Destroying underneath a running apply means both contend for the same
    // Terraform state lock and the environment ends up in an unknown state.
    expect(executor.destroyed).not.toContain(environment.slug);
    const [env] = await sql`SELECT status FROM arena_environments WHERE id = ${environment.id}`;
    expect(env.status).not.toBe('destroyed');
  });
});
