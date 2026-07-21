import postgres from 'postgres';
import { createDb } from '@tryout/db';
import { TurnsService } from '../src/arena/turns.service';
import { MAX_TURNS_PER_HOUR } from '../src/arena/arena.constants';

/**
 * Proves (or disproves) that TurnsService.submit() enforces MAX_TURNS_PER_HOUR
 * as a real ceiling under concurrent requests, not just a single-request
 * check. A mocked-DB unit test cannot demonstrate this — it never has two
 * requests actually racing against the same rows in a real
 * transaction/lock manager. This spec talks to the live Postgres on port
 * 5432 directly, with no HTTP layer and no AppModule, so it does not require
 * arena.module.ts (Task 5, not yet built). Mirrors
 * arena-environments-concurrency.e2e-spec.ts.
 *
 * Strategy: prefill the turns table for ONE environment with
 * (MAX_TURNS_PER_HOUR - REMAINING_SLOTS) turns already "applying" within the
 * last hour, then fire RACER_COUNT concurrent submit() calls for that SAME
 * environment (same buyer double-clicking / retrying is the real-world
 * shape of this race). At most REMAINING_SLOTS may succeed; the accepted
 * (applying) turn count for the environment must never exceed
 * MAX_TURNS_PER_HOUR.
 */
describe('TurnsService rate-limit concurrency (integration)', () => {
  jest.setTimeout(60000);

  const dbUrl = process.env.DATABASE_URL ?? 'postgres://tryout:tryout@localhost:5432/tryout';
  const RACER_COUNT = 10;
  const REMAINING_SLOTS = 3;

  const VALID_DESIGN = [
    'schema_version: 1',
    'api:',
    '  platform: cloudrun',
    '  min_instances: 1',
    '  max_instances: 10',
    '  concurrency: 80',
    '  cpu: 1',
    '  memory: 1Gi',
    'workers:',
    '  placement: separate_service',
    '  min_instances: 1',
    'cache:',
    '  enabled: true',
    '  tier: basic-1gb',
    'db:',
    '  tier: small',
  ].join('\n');

  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof createDb>;
  let service: TurnsService;
  let userId: string;
  let listingId: string;
  let environmentId: string;
  const runTag = Date.now();

  beforeAll(async () => {
    sql = postgres(dbUrl);
    db = createDb(dbUrl);
    service = new TurnsService(db);

    const [user] = await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${`turn-racer-${runTag}@example.com`}, 'x')
      RETURNING id`;
    userId = user.id as string;

    const [listing] = await sql`
      INSERT INTO scenario_listings
        (slug, title, tagline, story, contents, price_cents, currency, content_repo, status)
      VALUES
        (${`turn-rate-limit-test-${runTag}`}, 'Turn Rate Limit Test', 'tagline', 'story', 'contents',
         1000, 'usd', 'turn-rate-limit-test-repo', 'published')
      RETURNING id`;
    listingId = listing.id as string;

    await sql`
      INSERT INTO purchases (user_id, listing_id, amount_cents, status)
      VALUES (${userId}, ${listingId}, 1000, 'paid')`;

    const envSlug = `env-turnrl${runTag}`.slice(0, 32);
    const [environment] = await sql`
      INSERT INTO arena_environments (user_id, listing_id, env_slug, status, ttl_expires_at)
      VALUES (${userId}, ${listingId}, ${envSlug}, 'ready', now() + interval '1 hour')
      RETURNING id`;
    environmentId = environment.id as string;

    const prefillCount = MAX_TURNS_PER_HOUR - REMAINING_SLOTS;
    if (prefillCount < 0) {
      throw new Error('REMAINING_SLOTS exceeds MAX_TURNS_PER_HOUR — fix the test constants.');
    }
    for (let i = 0; i < prefillCount; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sql`
        INSERT INTO arena_turns (environment_id, status, created_at)
        VALUES (${environmentId}, 'applying', now())`;
    }
  });

  afterAll(async () => {
    await sql`DELETE FROM arena_turns WHERE environment_id = ${environmentId}`;
    await sql`DELETE FROM arena_environments WHERE id = ${environmentId}`;
    await sql`DELETE FROM purchases WHERE listing_id = ${listingId}`;
    await sql`DELETE FROM scenario_listings WHERE id = ${listingId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    await sql.end();
  });

  it('never lets accepted turns for one environment exceed MAX_TURNS_PER_HOUR under concurrent submits', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: RACER_COUNT }, () => service.submit(userId, environmentId, VALID_DESIGN)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const refusedForRateLimit = results.filter(
      (r) =>
        r.status === 'rejected' &&
        r.reason instanceof Error &&
        /rate limit/i.test((r.reason as Error).message),
    ).length;

    const [{ count: applyingCount }] = await sql`
      SELECT count(*)::int AS count
      FROM arena_turns
      WHERE environment_id = ${environmentId} AND status = 'applying'`;

    // The real assertion: accepted turns for this environment must never
    // exceed the cap. This is the one a TOCTOU race can violate even when
    // each individual request's own count-check looked fine at read time.
    expect(Number(applyingCount)).toBeLessThanOrEqual(MAX_TURNS_PER_HOUR);

    // Exactly REMAINING_SLOTS of the racers should have won the remaining
    // capacity — not more (that would be the race), not fewer (that would be
    // a correctness bug unrelated to concurrency).
    expect(succeeded).toBe(REMAINING_SLOTS);
    expect(succeeded + refusedForRateLimit).toBe(RACER_COUNT);
  });
});
