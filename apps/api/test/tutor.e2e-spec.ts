import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import postgres from 'postgres';
import { AppModule } from '../src/app.module';
import { StripeService } from '../src/purchases/stripe.service';
import { TutorAgentClient } from '../src/tutor/tutor-agent.client';

const mockStripe = {
  createCheckoutSession: jest.fn(),
  expireCheckoutSession: jest.fn(),
  constructEvent: jest.fn(),
};

const mockAgent = {
  turn: jest.fn().mockResolvedValue({
    reply: 'Start by checking df -h.',
    phase: 'detect',
  }),
};

describe('Tutor (e2e)', () => {
  let app: INestApplication;
  let sql: ReturnType<typeof postgres>;
  let token: string;
  let listingId: string;
  let userId: string;
  // Second listing with NULL tutor_brief — drives the 422 path.
  let noBriefListingId: string;
  // Fresh user isolated for the 429 cost-guard test.
  let limitToken: string;
  let limitUserId: string;
  const slug = `e2e-tutor-${Date.now()}`;
  const noBriefSlug = `e2e-tutor-nobrief-${Date.now()}`;
  const email = `tutor-${Date.now()}@example.com`;
  const limitEmail = `tutor-limit-${Date.now()}@example.com`;

  beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL!);
    const [listing] = await sql`
      INSERT INTO scenario_listings
        (slug, title, tagline, story, contents, price_cents, currency, content_repo, tutor_brief, status)
      VALUES
        (${slug}, 'E2E Tutor', 't', 's', 'c', 2900, 'usd', 'repo-x',
         'FAULT: disk fills. Guide one phase at a time.', 'published')
      RETURNING id`;
    listingId = listing.id as string;

    const [noBrief] = await sql`
      INSERT INTO scenario_listings
        (slug, title, tagline, story, contents, price_cents, currency, content_repo, tutor_brief, status)
      VALUES
        (${noBriefSlug}, 'E2E Tutor No Brief', 't', 's', 'c', 2900, 'usd', 'repo-y',
         NULL, 'published')
      RETURNING id`;
    noBriefListingId = noBrief.id as string;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StripeService)
      .useValue(mockStripe)
      .overrideProvider(TutorAgentClient)
      .useValue(mockAgent)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'sup3r-secret-pw' })
      .expect(201);
    token = res.body.token;
    const [u] = await sql`SELECT id FROM users WHERE email = ${email}`;
    userId = u.id as string;

    const limitRes = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: limitEmail, password: 'sup3r-secret-pw' })
      .expect(201);
    limitToken = limitRes.body.token;
    const [lu] = await sql`SELECT id FROM users WHERE email = ${limitEmail}`;
    limitUserId = lu.id as string;
  });

  afterAll(async () => {
    await sql`DELETE FROM tutor_messages WHERE user_id IN (${userId}, ${limitUserId})`;
    await sql`DELETE FROM tutor_threads WHERE user_id IN (${userId}, ${limitUserId})`;
    await sql`DELETE FROM purchases WHERE listing_id IN (${listingId}, ${noBriefListingId})`;
    await sql`DELETE FROM scenario_listings WHERE id IN (${listingId}, ${noBriefListingId})`;
    await sql`DELETE FROM users WHERE id IN (${userId}, ${limitUserId})`;
    await sql.end();
    await app.close();
  });

  it('403 when the user does not own the scenario', async () => {
    await request(app.getHttpServer())
      .post(`/tutor/${listingId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'help' })
      .expect(403);
  });

  it('owner round-trip: post then resume returns both turns + phase', async () => {
    await sql`
      INSERT INTO purchases (user_id, listing_id, amount_cents, status)
      VALUES (${userId}, ${listingId}, 2900, 'invite_sent')`;

    const post = await request(app.getHttpServer())
      .post(`/tutor/${listingId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'where do I start?' })
      .expect(201);
    expect(post.body.reply).toBe('Start by checking df -h.');
    expect(post.body.phase).toBe('detect');

    const get = await request(app.getHttpServer())
      .get(`/tutor/${listingId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(get.body.phase).toBe('detect');
    expect(get.body.messages).toHaveLength(2);
    expect(get.body.messages[0].role).toBe('user');
    expect(get.body.messages[1].role).toBe('assistant');
  });

  it('422 when the scenario has no tutor brief', async () => {
    await sql`
      INSERT INTO purchases (user_id, listing_id, amount_cents, status)
      VALUES (${userId}, ${noBriefListingId}, 2900, 'invite_sent')`;

    await request(app.getHttpServer())
      .post(`/tutor/${noBriefListingId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'help' })
      .expect(422);
  });

  it('429 when the daily message limit is reached', async () => {
    await sql`
      INSERT INTO purchases (user_id, listing_id, amount_cents, status)
      VALUES (${limitUserId}, ${listingId}, 2900, 'invite_sent')`;

    // TUTOR_DAILY_MESSAGE_LIMIT is 3 in the e2e env. Seed 3 user messages so the
    // guard (counts user+role, any listing) trips on the next post.
    for (let i = 0; i < 3; i++) {
      await sql`
        INSERT INTO tutor_messages (user_id, listing_id, role, content)
        VALUES (${limitUserId}, ${listingId}, 'user', ${'msg ' + i})`;
    }

    await request(app.getHttpServer())
      .post(`/tutor/${listingId}/messages`)
      .set('Authorization', `Bearer ${limitToken}`)
      .send({ content: 'one more please' })
      .expect(429);
  });

  it('401 without a token', async () => {
    await request(app.getHttpServer())
      .get(`/tutor/${listingId}/messages`)
      .expect(401);
  });
});
