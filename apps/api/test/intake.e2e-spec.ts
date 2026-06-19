import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GitHubService } from '../src/github/github.service';
import { QueueService } from '../src/queue/queue.service';
import { LLM_ROUTER } from '../src/llm/llm.module';

const mockGitHubService = {
  createRepoFromTemplate: jest.fn().mockResolvedValue({
    htmlUrl: 'https://github.com/test-owner/lumi-tasks-intake',
    fullName: 'test-owner/lumi-tasks-intake',
    repoName: 'lumi-tasks-intake',
  }),
  listOpenPullRequests: jest.fn().mockResolvedValue([]),
  getPullRequestDiff: jest.fn().mockResolvedValue(''),
  getCheckRuns: jest.fn().mockResolvedValue([]),
  createPullRequestReview: jest.fn().mockResolvedValue(undefined),
};

const mockQueueService = {
  enqueuePollPr: jest.fn().mockResolvedValue(undefined),
  enqueuePollCi: jest.fn().mockResolvedValue(undefined),
  enqueuePmIntro: jest.fn().mockResolvedValue(undefined),
  enqueueReview: jest.fn().mockResolvedValue(undefined),
};

// Sam returns high-confidence JSON on a turn; plain text for the match rationale.
const mockRouter = {
  generate: jest.fn().mockResolvedValue({
    content:
      '{"reply":"Got it — you clearly know your way around APIs.","profile":{"experienceLevel":"junior","languages":["typescript"],"strengths":["api design"],"gaps":["testing"],"goals":"get hired","confidence":90}}',
  }),
};

describe('Intake (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let intakeId: string;
  const email = `intake-${Date.now()}@example.com`;
  const password = 'sup3r-secret-pw';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GitHubService)
      .useValue(mockGitHubService)
      .overrideProvider(QueueService)
      .useValue(mockQueueService)
      .overrideProvider(LLM_ROUTER)
      .useValue(mockRouter)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(201);
    authToken = signup.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated intake start', async () => {
    await request(app.getHttpServer()).post('/intake').expect(401);
  });

  it('starts an intake session with Sam opening greeting', async () => {
    const res = await request(app.getHttpServer())
      .post('/intake')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.transcript[0].role).toBe('recruiter');
    expect(res.body.readyToPlace).toBe(false);
    intakeId = res.body.id;
  });

  it('processes a turn, extracts a profile, and signals readyToPlace', async () => {
    const res = await request(app.getHttpServer())
      .post(`/intake/${intakeId}/messages`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ content: 'I built a few REST APIs in NestJS.' })
      .expect(201);
    expect(res.body.profile.strengths).toContain('api design');
    expect(res.body.readyToPlace).toBe(true);
  });

  it('places the candidate into a real run', async () => {
    // Next generate() call is the match rationale (plain text).
    mockRouter.generate.mockResolvedValueOnce({
      content: 'This backend ticket is a great fit — it plays to your API strength and stretches testing.',
    });
    const res = await request(app.getHttpServer())
      .post(`/intake/${intakeId}/place`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    expect(res.body.runId).toBeDefined();
    expect(res.body.role).toBeDefined();
    expect(res.body.rationale).toContain('testing');
    expect(mockGitHubService.createRepoFromTemplate).toHaveBeenCalled();
  });

  it('refuses a second placement on a completed intake', async () => {
    await request(app.getHttpServer())
      .post(`/intake/${intakeId}/place`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);
  });
});
