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

// Signature 'valid-signature' passes; anything else throws — mirrors constructEvent.
const mockStripeService = {
  createCheckoutSession: jest.fn().mockResolvedValue({
    id: 'cs_test_1',
    url: 'https://checkout.stripe.com/c/cs_test_1',
  }),
  expireCheckoutSession: jest.fn().mockResolvedValue(undefined),
  constructEvent: jest.fn((payload: Buffer, signature: string) => {
    if (signature !== 'valid-signature') throw new Error('bad signature');
    return JSON.parse(payload.toString());
  }),
};

describe('Marketplace (e2e)', () => {
  let app: INestApplication;
  let sql: ReturnType<typeof postgres>;
  let authToken: string;
  let listingId: string;
  const slug = `e2e-mkt-${Date.now()}`;
  const email = `mkt-${Date.now()}@example.com`;

  beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL!);
    const [row] = await sql`
      INSERT INTO scenario_listings
        (slug, title, tagline, story, contents, price_cents, currency, content_repo, status)
      VALUES
        (${slug}, 'E2E Disk Full', 'e2e tagline', '## story', '- runbook.md',
         2900, 'usd', 'scenario-e2e-disk-full', 'published')
      RETURNING id`;
    listingId = row.id as string;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GitHubService)
      .useValue(mockGitHubService)
      .overrideProvider(StripeService)
      .useValue(mockStripeService)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'sup3r-secret-pw' })
      .expect(201);
    authToken = res.body.token;
  });

  afterAll(async () => {
    await sql`DELETE FROM purchases WHERE listing_id = ${listingId}`;
    await sql`DELETE FROM scenario_listings WHERE id = ${listingId}`;
    await sql.end();
    await app.close();
  });

  it('GET /catalog — public, lists the listing without story or contentRepo', async () => {
    const res = await request(app.getHttpServer()).get('/catalog').expect(200);
    const item = res.body.find((l: { slug: string }) => l.slug === slug);
    expect(item).toBeDefined();
    expect(item.title).toBe('E2E Disk Full');
    expect(item).not.toHaveProperty('contentRepo');
    expect(item).not.toHaveProperty('story');
  });

  it('GET /catalog/:slug — returns the story, never contentRepo', async () => {
    const res = await request(app.getHttpServer()).get(`/catalog/${slug}`).expect(200);
    expect(res.body.story).toBe('## story');
    expect(res.body).not.toHaveProperty('contentRepo');
  });

  it('GET /catalog/:slug — 404 for unknown slug', async () => {
    await request(app.getHttpServer()).get('/catalog/nope-does-not-exist').expect(404);
  });

  it('POST /purchases/checkout — 401 without a token', async () => {
    await request(app.getHttpServer())
      .post('/purchases/checkout')
      .send({ listingId })
      .expect(401);
  });

  it('checkout → webhook → invite_sent: the full happy path', async () => {
    const checkout = await request(app.getHttpServer())
      .post('/purchases/checkout')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ listingId, githubUsername: 'octocat' })
      .expect(201);
    expect(checkout.body.url).toContain('checkout.stripe.com');

    const purchaseId =
      mockStripeService.createCheckoutSession.mock.calls[0][0].purchaseId;

    await request(app.getHttpServer())
      .post('/purchases/webhook')
      .set('stripe-signature', 'valid-signature')
      .send({
        type: 'checkout.session.completed',
        data: { object: { payment_status: 'paid', metadata: { purchaseId } } },
      })
      .expect(201);

    expect(mockGitHubService.addRepoCollaborator).toHaveBeenCalledWith(
      expect.any(String),
      'scenario-e2e-disk-full',
      'octocat',
    );

    const mine = await request(app.getHttpServer())
      .get('/purchases/mine')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].status).toBe('invite_sent');
    expect(mine.body[0].repoUrl).toContain('/scenario-e2e-disk-full');
  });

  it('webhook replay is a no-op (idempotent)', async () => {
    const callsBefore = mockGitHubService.addRepoCollaborator.mock.calls.length;
    const purchaseId =
      mockStripeService.createCheckoutSession.mock.calls[0][0].purchaseId;

    await request(app.getHttpServer())
      .post('/purchases/webhook')
      .set('stripe-signature', 'valid-signature')
      .send({
        type: 'checkout.session.completed',
        data: { object: { payment_status: 'paid', metadata: { purchaseId } } },
      })
      .expect(201);

    expect(mockGitHubService.addRepoCollaborator.mock.calls.length).toBe(callsBefore);

    // The row must still be invite_sent — the replay must not have touched it.
    const mine = await request(app.getHttpServer())
      .get('/purchases/mine')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].status).toBe('invite_sent');
  });

  it('webhook with a bad signature → 400', async () => {
    await request(app.getHttpServer())
      .post('/purchases/webhook')
      .set('stripe-signature', 'forged')
      .send({ type: 'checkout.session.completed', data: { object: {} } })
      .expect(400);
  });

  it('double-buy → 409', async () => {
    await request(app.getHttpServer())
      .post('/purchases/checkout')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ listingId })
      .expect(409);
  });
});
