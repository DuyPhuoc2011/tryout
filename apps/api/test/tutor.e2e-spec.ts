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
  const slug = `e2e-tutor-${Date.now()}`;
  const email = `tutor-${Date.now()}@example.com`;

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
  });

  afterAll(async () => {
    await sql`DELETE FROM tutor_messages WHERE listing_id = ${listingId}`;
    await sql`DELETE FROM tutor_threads WHERE listing_id = ${listingId}`;
    await sql`DELETE FROM purchases WHERE listing_id = ${listingId}`;
    await sql`DELETE FROM scenario_listings WHERE id = ${listingId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
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

  it('401 without a token', async () => {
    await request(app.getHttpServer())
      .get(`/tutor/${listingId}/messages`)
      .expect(401);
  });
});
