import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GitHubService } from '../src/github/github.service';
import { QueueService } from '../src/queue/queue.service';

const mockGitHubService = {
  createRepoFromTemplate: jest.fn().mockResolvedValue({
    htmlUrl: 'https://github.com/test-owner/lumi-tasks-scenarios',
    fullName: 'test-owner/lumi-tasks-scenarios',
    repoName: 'lumi-tasks-scenarios',
  }),
  listOpenPullRequests: jest.fn().mockResolvedValue([]),
  getPullRequestDiff: jest.fn().mockResolvedValue(''),
  getCheckRuns: jest.fn().mockResolvedValue([]),
};

const mockQueueService = {
  enqueuePollPr: jest.fn().mockResolvedValue(undefined),
  enqueuePollCi: jest.fn().mockResolvedValue(undefined),
  enqueuePmIntro: jest.fn().mockResolvedValue(undefined),
  enqueueReview: jest.fn().mockResolvedValue(undefined),
};

describe('Scenarios catalog (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  const email = `catalog-${Date.now()}@example.com`;
  const password = 'sup3r-secret-pw';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GitHubService)
      .useValue(mockGitHubService)
      .overrideProvider(QueueService)
      .useValue(mockQueueService)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(201);
    authToken = res.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /scenarios — requires auth', async () => {
    await request(app.getHttpServer()).get('/scenarios').expect(401);
  });

  it('GET /scenarios — returns catalog items with availability', async () => {
    const res = await request(app.getHttpServer())
      .get('/scenarios')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    const item = res.body[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('title');
    expect(item).toHaveProperty('projectType');
    expect(item).toHaveProperty('summary');
    expect(item).toHaveProperty('difficulty');
    expect(item).toHaveProperty('tags');
    expect(item).toHaveProperty('available');

    // Available scenarios sort ahead of unavailable ones.
    const firstUnavailableIdx = res.body.findIndex(
      (s: { available: boolean }) => !s.available,
    );
    if (firstUnavailableIdx >= 0) {
      const after = res.body.slice(firstUnavailableIdx);
      expect(after.every((s: { available: boolean }) => !s.available)).toBe(true);
    }
  });

  it('GET /scenarios/:id — returns the resolved team and selectable roles', async () => {
    const list = await request(app.getHttpServer())
      .get('/scenarios')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const available = list.body.find((s: { available: boolean }) => s.available);
    expect(available).toBeDefined();

    const detail = await request(app.getHttpServer())
      .get(`/scenarios/${available.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(Array.isArray(detail.body.team)).toBe(true);
    expect(detail.body.team.length).toBeGreaterThan(0);
    expect(Array.isArray(detail.body.selectableRoles)).toBe(true);
    expect(detail.body.selectableRoles.length).toBeGreaterThan(0);

    // Every selectable role appears as a selectable seat in the team.
    for (const key of detail.body.selectableRoles) {
      const seat = detail.body.team.find((s: { key: string }) => s.key === key);
      expect(seat).toBeDefined();
      expect(seat.selectable).toBe(true);
    }
  });

  it('GET /scenarios/:id — 404 for an unknown id', async () => {
    await request(app.getHttpServer())
      .get('/scenarios/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });
});
