import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GitHubService } from '../src/github/github.service';
import { QueueService } from '../src/queue/queue.service';
import { LLM_ROUTER } from '../src/llm/llm.module';
import { PmService } from '../src/agents/pm.service';
import { SeniorReviewService } from '../src/agents/senior-review.service';
import { DRIZZLE } from '../src/db/db.module';
import { schema } from '@tryout/db';
import { resolveStartRunBody } from './helpers/start-run';

const mockGitHubService = {
  createRepoFromTemplate: jest.fn().mockResolvedValue({
    htmlUrl: 'https://github.com/test-owner/lumi-tasks-v2',
    fullName: 'test-owner/lumi-tasks-v2',
    repoName: 'lumi-tasks-v2',
  }),
  listOpenPullRequests: jest.fn().mockResolvedValue([]),
  getPullRequestDiff: jest.fn().mockResolvedValue('diff --git a/src b/src\n+archive'),
  getCheckRuns: jest.fn().mockResolvedValue([]),
  createPullRequestReview: jest.fn().mockResolvedValue(undefined),
};

const mockQueueService = {
  enqueuePollPr: jest.fn().mockResolvedValue(undefined),
  enqueuePollCi: jest.fn().mockResolvedValue(undefined),
  enqueuePmIntro: jest.fn().mockResolvedValue(undefined),
  enqueueReview: jest.fn().mockResolvedValue(undefined),
};

const mockRouter = {
  generate: jest.fn(),
};

describe('Visible loop (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let pm: PmService;
  let senior: SeniorReviewService;
  const email = `m2-${Date.now()}@example.com`;
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

    pm = app.get(PmService);
    senior = app.get(SeniorReviewService);

    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(201);
    authToken = res.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs the loop: start → PM intro → PR + CI → Senior review', async () => {
    // 1. Start a run.
    const startRes = await request(app.getHttpServer())
      .post('/scenario-runs')
      .set('Authorization', `Bearer ${authToken}`)
      .send(await resolveStartRunBody(app, authToken))
      .expect(201);
    const runId = startRes.body.id as string;
    expect(startRes.body.repoUrl).toBe('https://github.com/test-owner/lumi-tasks-v2');

    // 2. GET returns the ticket from the seeded scenario, no intro yet.
    const beforeIntro = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(beforeIntro.body.scenario.ticket.id).toBe('LUMI-142');
    expect(beforeIntro.body.pmIntro).toBeNull();

    // 3. PM generates the intro (normally the pm-intro job).
    mockRouter.generate.mockResolvedValueOnce({ content: 'Hi! Welcome to Lumi. Take LUMI-142.' });
    await pm.generateIntro(runId);

    const afterIntro = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(afterIntro.body.pmIntro.content).toContain('Welcome to Lumi');

    // 4. Simulate a PR submission landing in the DB (normally poll-pr).
    const db = app.get<any>(DRIZZLE);
    const [submission] = await db
      .insert(schema.submissions)
      .values({
        scenarioRunId: runId,
        prUrl: 'https://github.com/test-owner/lumi-tasks-v2/pull/1',
        ciStatus: 'failure',
      })
      .returning();

    // 5. Senior reviews (normally the review job). Model approves, but first
    //    submission is forced to request_changes.
    mockRouter.generate.mockResolvedValueOnce({
      content: JSON.stringify({
        summary: 'Good first pass.',
        comments: ['Add an unarchive endpoint.'],
        verdict: 'approve',
      }),
    });
    await senior.reviewSubmission({
      submissionId: submission.id,
      repoOwner: 'test-owner',
      repoName: 'lumi-tasks-v2',
      prNumber: 1,
    });

    // 6. A real GitHub review was posted with REQUEST_CHANGES.
    expect(mockGitHubService.createPullRequestReview).toHaveBeenCalledWith(
      'test-owner',
      'lumi-tasks-v2',
      1,
      expect.stringContaining('unarchive'),
      'REQUEST_CHANGES',
    );

    // 7. GET now surfaces the review verdict.
    const afterReview = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(afterReview.body.latestReview.verdict).toBe('request_changes');
    expect(afterReview.body.latestSubmission.prUrl).toContain('/pull/1');
  });
});
