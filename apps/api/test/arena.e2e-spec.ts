import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import postgres from 'postgres';
import { AppModule } from '../src/app.module';
import { GitHubService } from '../src/github/github.service';
import { StripeService } from '../src/purchases/stripe.service';

const mockGitHubService = {
  addRepoCollaborator: jest.fn().mockResolvedValue(undefined),
};

const mockStripeService = {
  createCheckoutSession: jest.fn(),
  expireCheckoutSession: jest.fn(),
  constructEvent: jest.fn(),
};

// A design that passes @tryout/arena parseDesign — mirrors the unit spec.
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

// Same design, one lever out of range (max_instances: 999) — rejected.
const INVALID_DESIGN = VALID_DESIGN.replace('max_instances: 10', 'max_instances: 999');

describe('Arena (e2e)', () => {
  let app: INestApplication;
  let sql: ReturnType<typeof postgres>;

  const runTag = Date.now();
  const listingId = { value: '' };

  // Primary actor: entitled (invite_sent), creates and submits.
  const ownerEmail = `arena-owner-${runTag}@example.com`;
  let ownerToken: string;
  let ownerId: string;
  let ownerEnvId: string;

  // A different buyer with only a pending purchase — never entitled.
  const pendingEmail = `arena-pending-${runTag}@example.com`;
  let pendingToken: string;

  // A stranger with no purchase at all.
  const strangerEmail = `arena-stranger-${runTag}@example.com`;
  let strangerToken: string;

  // A second user who owns an environment the primary actor must never see.
  let otherUserId: string;
  let otherEnvId: string;

  async function signup(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'sup3r-secret-pw' })
      .expect(201);
    return res.body.token;
  }

  async function userIdByEmail(email: string): Promise<string> {
    const [row] = await sql`SELECT id FROM users WHERE email = ${email}`;
    return row.id as string;
  }

  beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL!);

    const [listing] = await sql`
      INSERT INTO scenario_listings
        (slug, title, tagline, story, contents, price_cents, currency, content_repo, status)
      VALUES
        (${`arena-e2e-${runTag}`}, 'Arena E2E', 'tagline', 'story', 'contents',
         2900, 'usd', 'arena-e2e-repo', 'published')
      RETURNING id`;
    listingId.value = listing.id as string;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GitHubService)
      .useValue(mockGitHubService)
      .overrideProvider(StripeService)
      .useValue(mockStripeService)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    ownerToken = await signup(ownerEmail);
    ownerId = await userIdByEmail(ownerEmail);
    pendingToken = await signup(pendingEmail);
    strangerToken = await signup(strangerEmail);

    // Entitle the owner: an invite_sent purchase grants scenario access.
    await sql`
      INSERT INTO purchases (user_id, listing_id, amount_cents, status)
      VALUES (${ownerId}, ${listingId.value}, 2900, 'invite_sent')`;

    // The pending buyer: a pending purchase must NOT entitle.
    const pendingId = await userIdByEmail(pendingEmail);
    await sql`
      INSERT INTO purchases (user_id, listing_id, amount_cents, status)
      VALUES (${pendingId}, ${listingId.value}, 2900, 'pending')`;

    // A second user with their own directly-seeded environment. Seeded via
    // SQL (not the service) so it exists regardless of entitlement — the
    // point is only that it belongs to someone else.
    const [other] = await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${`arena-other-${runTag}@example.com`}, 'x')
      RETURNING id`;
    otherUserId = other.id as string;
    const [otherEnv] = await sql`
      INSERT INTO arena_environments (user_id, listing_id, env_slug, status, ttl_expires_at)
      VALUES (${otherUserId}, ${listingId.value}, ${`env-other${runTag}`.slice(0, 32)},
              'ready', now() + interval '1 hour')
      RETURNING id`;
    otherEnvId = otherEnv.id as string;
  });

  afterAll(async () => {
    await sql`DELETE FROM arena_turns WHERE environment_id IN
      (SELECT id FROM arena_environments WHERE listing_id = ${listingId.value})`;
    await sql`DELETE FROM arena_environments WHERE listing_id = ${listingId.value}`;
    await sql`DELETE FROM purchases WHERE listing_id = ${listingId.value}`;
    await sql`DELETE FROM users WHERE id = ${otherUserId}`;
    await sql`DELETE FROM users WHERE email IN
      (${ownerEmail}, ${pendingEmail}, ${strangerEmail})`;
    await sql`DELETE FROM scenario_listings WHERE id = ${listingId.value}`;
    await sql.end();
    await app.close();
  });

  it('POST /arena/environments/:listingId — 401 without a JWT', async () => {
    await request(app.getHttpServer())
      .post(`/arena/environments/${listingId.value}`)
      .expect(401);
  });

  it('GET /arena/environments/mine — 401 without a JWT', async () => {
    await request(app.getHttpServer()).get('/arena/environments/mine').expect(401);
  });

  it('POST /arena/environments/:environmentId/turns — 401 without a JWT', async () => {
    await request(app.getHttpServer())
      .post(`/arena/environments/${otherEnvId}/turns`)
      .send({ design: VALID_DESIGN })
      .expect(401);
  });

  it('create — 403 for a user with no purchase', async () => {
    await request(app.getHttpServer())
      .post(`/arena/environments/${listingId.value}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
  });

  it('create — 403 for a user whose purchase is pending', async () => {
    await request(app.getHttpServer())
      .post(`/arena/environments/${listingId.value}`)
      .set('Authorization', `Bearer ${pendingToken}`)
      .expect(403);
  });

  it('create — an entitled buyer gets an environment with a valid slug and future TTL', async () => {
    const res = await request(app.getHttpServer())
      .post(`/arena/environments/${listingId.value}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    expect(res.body.envSlug).toMatch(/^env-[a-z0-9]{6,32}$/);
    expect(res.body.status).toBe('pending');
    expect(new Date(res.body.ttlExpiresAt).getTime()).toBeGreaterThan(Date.now());
    ownerEnvId = res.body.id;
  });

  it('create — a second create for the same buyer and listing is 409', async () => {
    await request(app.getHttpServer())
      .post(`/arena/environments/${listingId.value}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(409);
  });

  it('GET mine — returns only the caller\'s environments', async () => {
    const res = await request(app.getHttpServer())
      .get('/arena/environments/mine')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const ids = res.body.map((e: { id: string }) => e.id);
    expect(ids).toContain(ownerEnvId);
    expect(ids).not.toContain(otherEnvId);
  });

  it('submit — a valid design is accepted with rendered tfvars', async () => {
    const res = await request(app.getHttpServer())
      .post(`/arena/environments/${ownerEnvId}/turns`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ design: VALID_DESIGN })
      .expect(201);

    // The service stores 'submitted' (queued), not 'applying' — a not-yet-built
    // runner is what flips submitted -> applying. See turns.service.ts.
    expect(res.body.status).toBe('submitted');
    expect(res.body.tfvars).not.toBeNull();
    expect(res.body.parseErrors).toBeNull();
  });

  it('submit — an out-of-range lever is rejected with parse errors and null tfvars', async () => {
    const res = await request(app.getHttpServer())
      .post(`/arena/environments/${ownerEnvId}/turns`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ design: INVALID_DESIGN })
      .expect(201);

    expect(res.body.status).toBe('rejected');
    expect(res.body.tfvars).toBeNull();
    expect(Array.isArray(res.body.parseErrors)).toBe(true);
    expect(res.body.parseErrors.length).toBeGreaterThan(0);
  });

  it('submit — 404 (not 403) when submitting to another user\'s environment', async () => {
    await request(app.getHttpServer())
      .post(`/arena/environments/${otherEnvId}/turns`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ design: VALID_DESIGN })
      .expect(404);
  });
});
