import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GitHubService } from '../src/github/github.service';
import { QueueService } from '../src/queue/queue.service';
import { LLM_ROUTER } from '../src/llm/llm.module';
import { resolveStartRunBody } from './helpers/start-run';

const mockGitHubService = {
  createRepoFromTemplate: jest.fn().mockResolvedValue({
    htmlUrl: 'https://github.com/test-owner/lumi-tasks-m3',
    fullName: 'test-owner/lumi-tasks-m3',
    repoName: 'lumi-tasks-m3',
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

const mockRouter = { generate: jest.fn() };

describe('Conversations (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let runId: string;
  const email = `m3-${Date.now()}@example.com`;
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

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(201);
    authToken = signup.body.token;

    const start = await request(app.getHttpServer())
      .post('/scenario-runs')
      .set('Authorization', `Bearer ${authToken}`)
      .send(await resolveStartRunBody(app, authToken))
      .expect(201);
    runId = start.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated message posts', async () => {
    await request(app.getHttpServer())
      .post(`/scenario-runs/${runId}/messages`)
      .send({ agentRole: 'pm', content: 'hi' })
      .expect(401);
  });

  it('rejects an invalid agentRole', async () => {
    await request(app.getHttpServer())
      .post(`/scenario-runs/${runId}/messages`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ agentRole: 'ceo', content: 'hi' })
      .expect(400);
  });

  it('sends a PM message and gets a persisted agent reply', async () => {
    mockRouter.generate.mockResolvedValueOnce({
      content: 'Good question — hide archived tasks by default.',
    });

    const res = await request(app.getHttpServer())
      .post(`/scenario-runs/${runId}/messages`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ agentRole: 'pm', content: 'Should archived tasks be hidden from the list?' })
      .expect(201);

    expect(res.body.agentRole).toBe('pm');
    expect(res.body.direction).toBe('agent');
    expect(res.body.content).toContain('hide archived tasks');
  });

  it('returns the full transcript in order', async () => {
    const res = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}/messages`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    // The PM exchange above: one user turn then one agent turn.
    const pmMessages = res.body.filter((m: any) => m.agentRole === 'pm');
    expect(pmMessages.length).toBeGreaterThanOrEqual(2);
    expect(pmMessages[0].direction).toBe('user');
    expect(pmMessages[1].direction).toBe('agent');
  });

  it('moved the run to in_progress after the first message', async () => {
    const res = await request(app.getHttpServer())
      .get(`/scenario-runs/${runId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(res.body.status).toBe('in_progress');
  });
});
