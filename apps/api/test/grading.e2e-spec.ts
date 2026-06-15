import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GitHubService } from '../src/github/github.service';
import { QueueService } from '../src/queue/queue.service';
import { LLM_ROUTER } from '../src/llm/llm.module';
import { GradingService } from '../src/grading/grading.service';
import { DRIZZLE } from '../src/db/db.module';
import { schema } from '@tryout/db';

const mockGitHubService = {
  createRepoFromTemplate: jest.fn().mockResolvedValue({
    htmlUrl: 'https://github.com/test-owner/lumi-tasks-m4',
    fullName: 'test-owner/lumi-tasks-m4',
    repoName: 'lumi-tasks-m4',
  }),
  listOpenPullRequests: jest.fn().mockResolvedValue([]),
  getPullRequestDiff: jest.fn().mockResolvedValue('diff --git a/x b/x\n+archive'),
  getCheckRuns: jest.fn().mockResolvedValue([]),
  createPullRequestReview: jest.fn().mockResolvedValue(undefined),
};

const mockQueueService = {
  enqueuePollPr: jest.fn().mockResolvedValue(undefined),
  enqueuePollCi: jest.fn().mockResolvedValue(undefined),
  enqueuePmIntro: jest.fn().mockResolvedValue(undefined),
  enqueueReview: jest.fn().mockResolvedValue(undefined),
  enqueueGrade: jest.fn().mockResolvedValue(undefined),
};

const mockRouter = { generate: jest.fn() };

describe('Grading (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let runId: string;
  let grading: GradingService;
  let db: any;
  const email = `m4-${Date.now()}@example.com`;
  const password = 'sup3r-secret-pw';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
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

    grading = app.get(GradingService);
    db = app.get(DRIZZLE);

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(201);
    authToken = signup.body.token;

    const start = await request(app.getHttpServer())
      .post('/scenario-runs')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    runId = start.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unauthenticated grade request', async () => {
    await request(app.getHttpServer()).post(`/scenario-runs/${runId}/grade`).expect(401);
  });

  it('refuses to grade a run with no submission', async () => {
    await request(app.getHttpServer())
      .post(`/scenario-runs/${runId}/grade`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);
  });

  it('404s for a scorecard that does not exist yet', async () => {
    await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}/scorecard`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });

  it('grades a run and returns the scorecard', async () => {
    // A PR submission lands (normally via poll-pr, which is mocked here).
    await db.insert(schema.submissions).values({
      scenarioRunId: runId,
      prUrl: 'https://github.com/test-owner/lumi-tasks-m4/pull/1',
      ciStatus: 'success',
    });

    // Request grading: flips status to grading + enqueues (mocked).
    const reqRes = await request(app.getHttpServer())
      .post(`/scenario-runs/${runId}/grade`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    expect(reqRes.body.status).toBe('grading');

    // Run the Grader directly (stands in for the GradeProcessor worker).
    mockRouter.generate.mockResolvedValueOnce({
      content: JSON.stringify({
        technicalScore: 78,
        technicalFeedback: 'Works; missing one edge case.',
        professionalScore: 88,
        professionalFeedback: 'Good clarifying question to the PM.',
        overallFeedback: 'Strong submission overall.',
      }),
    });
    await grading.gradeRun(runId);

    // The scorecard reads back.
    const cardRes = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}/scorecard`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(cardRes.body.technicalScore).toBe(78);
    expect(cardRes.body.professionalScore).toBe(88);
    expect(cardRes.body.overallFeedback).toBe('Strong submission overall.');

    // The run is now complete.
    const runRes = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(runRes.body.status).toBe('complete');
  });
});
