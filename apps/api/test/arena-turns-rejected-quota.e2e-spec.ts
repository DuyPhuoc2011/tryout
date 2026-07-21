import postgres from 'postgres';
import { createDb } from '@tryout/db';
import { TurnsService } from '../src/arena/turns.service';
import { MAX_TURNS_PER_HOUR } from '../src/arena/arena.constants';

/**
 * Proves (or disproves) that TurnsService.submit()'s rate-limit count
 * excludes rejected turns. A mocked-DB unit test cannot demonstrate this: the
 * unit spec hands the service a pre-baked `{ count }` row and never exercises
 * the real WHERE predicate, so a missing status filter is structurally
 * invisible to it (a rejected turn's created_at still lands inside the
 * rolling one-hour window used by the count query — only the predicate on
 * `status` decides whether it's counted). This spec talks to the live
 * Postgres on port 5432 directly, with no HTTP layer and no AppModule, so it
 * does not require arena.module.ts (Task 5, not yet built). Mirrors
 * arena-turns-rate-limit-concurrency.e2e-spec.ts.
 *
 * Strategy: seed ONE environment with MAX_TURNS_PER_HOUR 'rejected' turns
 * created within the last hour — i.e. a buyer who has been fighting broken
 * YAML for a while — then submit ONE valid design. If the rate-limit count
 * wrongly includes rejected turns, this submission is refused with 429 even
 * though the buyer has spent nothing. It must be ACCEPTED instead.
 */
describe('TurnsService rejected-turn rate-limit exclusion (integration)', () => {
  jest.setTimeout(60000);

  const dbUrl = process.env.DATABASE_URL ?? 'postgres://tryout:tryout@localhost:5432/tryout';

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
      VALUES (${`turn-rejected-quota-${runTag}@example.com`}, 'x')
      RETURNING id`;
    userId = user.id as string;

    const [listing] = await sql`
      INSERT INTO scenario_listings
        (slug, title, tagline, story, contents, price_cents, currency, content_repo, status)
      VALUES
        (${`turn-rejected-quota-test-${runTag}`}, 'Turn Rejected Quota Test', 'tagline', 'story', 'contents',
         1000, 'usd', 'turn-rejected-quota-test-repo', 'published')
      RETURNING id`;
    listingId = listing.id as string;

    await sql`
      INSERT INTO purchases (user_id, listing_id, amount_cents, status)
      VALUES (${userId}, ${listingId}, 1000, 'paid')`;

    const envSlug = `env-rejq${runTag}`.slice(0, 32);
    const [environment] = await sql`
      INSERT INTO arena_environments (user_id, listing_id, env_slug, status, ttl_expires_at)
      VALUES (${userId}, ${listingId}, ${envSlug}, 'ready', now() + interval '1 hour')
      RETURNING id`;
    environmentId = environment.id as string;

    // MAX_TURNS_PER_HOUR rejected turns, all within the rate-limit window.
    // None of these represents spent money — a correct rate limit must
    // ignore all of them.
    for (let i = 0; i < MAX_TURNS_PER_HOUR; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sql`
        INSERT INTO arena_turns (environment_id, status, created_at)
        VALUES (${environmentId}, 'rejected', now())`;
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

  it('accepts a valid submission even when MAX_TURNS_PER_HOUR rejected turns already exist in the window', async () => {
    const turn = await service.submit(userId, environmentId, VALID_DESIGN);

    expect(turn.status).toBe('submitted');

    const [{ count: submittedCount }] = await sql`
      SELECT count(*)::int AS count
      FROM arena_turns
      WHERE environment_id = ${environmentId} AND status = 'submitted'`;
    expect(Number(submittedCount)).toBe(1);
  });
});
