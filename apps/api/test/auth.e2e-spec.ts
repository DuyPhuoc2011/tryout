import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  // Unique email per run so the test is repeatable without DB cleanup.
  const email = `m0-${Date.now()}@example.com`;
  const password = 'sup3r-secret-pw';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects signup with a short password (400)', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'short' })
      .expect(400);
  });

  let token: string;

  it('signs up a new user and returns a token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(201);

    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(email);
    token = res.body.token;
  });

  it('rejects duplicate signup without enumerating (409)', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(409);
  });

  it('logs in with correct credentials (200)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects login with wrong password (401)', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'nope-nope-nope' })
      .expect(401);
  });

  it('rejects /auth/me without a token (401)', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('returns the current user with a valid token (200)', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.email).toBe(email);
  });
});
