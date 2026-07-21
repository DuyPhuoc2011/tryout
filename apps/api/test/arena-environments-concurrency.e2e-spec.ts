import postgres from 'postgres';
import { ServiceUnavailableException } from '@nestjs/common';
import { createDb } from '@tryout/db';
import { EnvironmentsService } from '../src/arena/environments.service';
import { EntitlementService } from '../src/entitlement/entitlement.service';
import { MAX_CONCURRENT_ENVIRONMENTS } from '../src/arena/arena.constants';

/**
 * Proves (or disproves) that EnvironmentsService.create() enforces
 * MAX_CONCURRENT_ENVIRONMENTS as a real ceiling under concurrent requests,
 * not just a single-request check. A mocked-DB unit test cannot demonstrate
 * this — it never has two requests actually racing against the same rows in
 * a real transaction/lock manager. This spec talks to the live Postgres on
 * port 5432 directly, with no HTTP layer and no AppModule, so it does not
 * require arena.module.ts (Task 5, not yet built).
 *
 * Strategy: fill the table to within REMAINING_SLOTS of the real cap using
 * rows the racers do not own, then fire RACER_COUNT concurrent creates from
 * RACER_COUNT distinct entitled users. At most REMAINING_SLOTS may succeed;
 * the live row count must never exceed MAX_CONCURRENT_ENVIRONMENTS.
 */
describe('EnvironmentsService concurrency (integration)', () => {
  jest.setTimeout(60000);

  const dbUrl = process.env.DATABASE_URL ?? 'postgres://tryout:tryout@localhost:5432/tryout';
  const RACER_COUNT = 10;
  const REMAINING_SLOTS = 3;

  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof createDb>;
  let service: EnvironmentsService;
  let listingId: string;
  const racerUserIds: string[] = [];
  const fillerUserIds: string[] = [];
  const runTag = Date.now();

  beforeAll(async () => {
    sql = postgres(dbUrl);
    db = createDb(dbUrl);
    const entitlement = new EntitlementService(db);
    service = new EnvironmentsService(db, entitlement);

    const [listing] = await sql`
      INSERT INTO scenario_listings
        (slug, title, tagline, story, contents, price_cents, currency, content_repo, status)
      VALUES
        (${`concurrency-test-${runTag}`}, 'Concurrency Test', 'tagline', 'story', 'contents',
         1000, 'usd', 'concurrency-test-repo', 'published')
      RETURNING id`;
    listingId = listing.id as string;

    // Determine how many live rows already exist globally (should be 0 in a
    // clean dev DB, but never assume) so PREFILL_COUNT lands exactly
    // REMAINING_SLOTS short of the real cap regardless of prior state.
    const [{ count: existingLive }] = await sql`
      SELECT count(*)::int AS count FROM arena_environments WHERE status <> 'destroyed'`;
    const remainingBudget = MAX_CONCURRENT_ENVIRONMENTS - Number(existingLive);
    const prefillCount = remainingBudget - REMAINING_SLOTS;
    if (prefillCount < 0) {
      throw new Error(
        `Test DB already has ${existingLive} live arena_environments rows — ` +
          'not enough headroom under MAX_CONCURRENT_ENVIRONMENTS to run this test safely.',
      );
    }

    for (let i = 0; i < prefillCount; i += 1) {
      const [filler] = await sql`
        INSERT INTO users (email, password_hash)
        VALUES (${`filler-${i}-${runTag}@example.com`}, 'x')
        RETURNING id`;
      fillerUserIds.push(filler.id as string);
      const slug = `env-fill${runTag}${String(i).padStart(3, '0')}`.slice(0, 32);
      await sql`
        INSERT INTO arena_environments (user_id, listing_id, env_slug, status, ttl_expires_at)
        VALUES (${filler.id}, ${listingId}, ${slug}, 'ready', now() + interval '1 hour')`;
    }

    for (let i = 0; i < RACER_COUNT; i += 1) {
      const [user] = await sql`
        INSERT INTO users (email, password_hash)
        VALUES (${`racer-${i}-${runTag}@example.com`}, 'x')
        RETURNING id`;
      racerUserIds.push(user.id as string);
      await sql`
        INSERT INTO purchases (user_id, listing_id, amount_cents, status)
        VALUES (${user.id}, ${listingId}, 1000, 'paid')`;
    }
  });

  afterAll(async () => {
    await sql`DELETE FROM arena_environments WHERE listing_id = ${listingId}`;
    await sql`DELETE FROM purchases WHERE listing_id = ${listingId}`;
    const allUserIds = [...racerUserIds, ...fillerUserIds];
    if (allUserIds.length > 0) {
      await sql`DELETE FROM users WHERE id IN ${sql(allUserIds)}`;
    }
    await sql`DELETE FROM scenario_listings WHERE id = ${listingId}`;
    await sql.end();
  });

  it('never lets live environments exceed MAX_CONCURRENT_ENVIRONMENTS under concurrent creates', async () => {
    const results = await Promise.allSettled(
      racerUserIds.map((uid) => service.create(uid, listingId)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const refusedForCapacity = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof ServiceUnavailableException,
    ).length;

    const [{ count: liveCount }] = await sql`
      SELECT count(*)::int AS count FROM arena_environments WHERE status <> 'destroyed'`;

    // The real assertion: the table itself must never exceed the cap. This is
    // the one a TOCTOU race can violate even when each individual request's
    // own count-check looked fine at read time.
    expect(Number(liveCount)).toBeLessThanOrEqual(MAX_CONCURRENT_ENVIRONMENTS);

    // Exactly REMAINING_SLOTS of the racers should have won the remaining
    // capacity — not more (that would be the race), not fewer (that would be
    // a correctness bug unrelated to concurrency).
    expect(succeeded).toBe(REMAINING_SLOTS);
    expect(succeeded + refusedForCapacity).toBe(RACER_COUNT);
  });
});
