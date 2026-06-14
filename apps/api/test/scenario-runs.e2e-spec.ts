import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GitHubService } from '../src/github/github.service';
import { QueueService } from '../src/queue/queue.service';

const mockGitHubService = {
  createRepoFromTemplate: jest.fn().mockResolvedValue({
    htmlUrl: 'https://github.com/test-owner/lumi-tasks-abc12345-1234567890',
    fullName: 'test-owner/lumi-tasks-abc12345-1234567890',
    repoName: 'lumi-tasks-abc12345-1234567890',
  }),
  listOpenPullRequests: jest.fn().mockResolvedValue([]),
  getPullRequestDiff: jest.fn().mockResolvedValue(''),
  getCheckRuns: jest.fn().mockResolvedValue([]),
};

const mockQueueService = {
  enqueuePollPr: jest.fn().mockResolvedValue(undefined),
  enqueuePollCi: jest.fn().mockResolvedValue(undefined),
};

describe('ScenarioRuns (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  const email = `m1-${Date.now()}@example.com`;
  const password = 'sup3r-secret-pw';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockGitHubService.createRepoFromTemplate.mockResolvedValue({
      htmlUrl: 'https://github.com/test-owner/lumi-tasks-abc12345-1234567890',
      fullName: 'test-owner/lumi-tasks-abc12345-1234567890',
      repoName: 'lumi-tasks-abc12345-1234567890',
    });
    mockQueueService.enqueuePollPr.mockResolvedValue(undefined);
  });

  it('POST /scenario-runs — returns 401 without a token', async () => {
    await request(app.getHttpServer()).post('/scenario-runs').expect(401);
  });

  it('POST /scenario-runs — creates a run and returns repoUrl', async () => {
    const res = await request(app.getHttpServer())
      .post('/scenario-runs')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.repoUrl).toBe(
      'https://github.com/test-owner/lumi-tasks-abc12345-1234567890',
    );
    expect(res.body.status).toBe('onboarding');
    expect(mockGitHubService.createRepoFromTemplate).toHaveBeenCalledTimes(1);
    expect(mockQueueService.enqueuePollPr).toHaveBeenCalledTimes(1);
  });

  it('GET /scenario-runs/:id — returns the run with repo info', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/scenario-runs')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    const runId = createRes.body.id as string;

    const getRes = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(getRes.body.id).toBe(runId);
    expect(getRes.body.status).toBe('onboarding');
    expect(getRes.body.repo.url).toBe(
      'https://github.com/test-owner/lumi-tasks-abc12345-1234567890',
    );
    expect(getRes.body.latestSubmission).toBeNull();
  });

  it('GET /scenario-runs/:id — returns 404 for a non-existent run', async () => {
    await request(app.getHttpServer())
      .get('/scenario-runs/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });
});
