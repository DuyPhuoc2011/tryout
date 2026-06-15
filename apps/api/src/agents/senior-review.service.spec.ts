import { Test } from '@nestjs/testing';
import { SeniorReviewService } from './senior-review.service';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { GitHubService } from '../github/github.service';

const scenarioDefinition = {
  title: 'Add the ability to archive tasks',
  company_context: { name: 'Lumi', product: 'p', team: 't', user_role: 'r' },
  ticket: { id: 'LUMI-142', title: 'Archive', body: 'Add archive.' },
  agent_prompts: {
    pm_mai: { system: 'You are Mai.' },
    senior_alex: { system: 'You are Alex, a senior engineer.' },
  },
  ground_truth: {
    solution_notes: 'Soft archive; exclude from default list; add unarchive.',
    red_flags: ['hard delete', 'no unarchive'],
  },
};

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
};

const mockRouter = { generate: jest.fn() };
const mockGitHub = { getPullRequestDiff: jest.fn(), createPullRequestReview: jest.fn() };

const jobData = {
  submissionId: 'sub-1',
  repoOwner: 'test-owner',
  repoName: 'lumi-tasks-abc',
  prNumber: 7,
};

describe('SeniorReviewService', () => {
  let service: SeniorReviewService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SeniorReviewService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: LLM_ROUTER, useValue: mockRouter },
        { provide: GitHubService, useValue: mockGitHub },
      ],
    }).compile();
    service = moduleRef.get(SeniorReviewService);
    mockGitHub.getPullRequestDiff.mockResolvedValue('diff --git a/x b/x');
    mockGitHub.createPullRequestReview.mockResolvedValue(undefined);
  });

  it('forces request_changes on the first submission and posts the review', async () => {
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'sub-1', scenarioRunId: 'run-1', ciStatus: 'failure' }])
      .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }])
      .mockResolvedValueOnce([]); // prior reviews: none → first review
    mockRouter.generate.mockResolvedValue({
      content: JSON.stringify({
        summary: 'Solid start.',
        comments: ['Add an unarchive endpoint.'],
        verdict: 'approve', // model says approve…
      }),
    });
    mockDb.returning.mockResolvedValue([{ id: 'rev-1', verdict: 'request_changes' }]);

    await service.reviewSubmission(jobData);

    // …but first submission is forced to request_changes.
    const reviewArg = mockGitHub.createPullRequestReview.mock.calls[0];
    expect(reviewArg[4]).toBe('REQUEST_CHANGES');
    expect(mockDb.insert).toHaveBeenCalled();
    const insertedValues = mockDb.values.mock.calls.at(-1)[0];
    expect(insertedValues.verdict).toBe('request_changes');
    expect(insertedValues.submissionId).toBe('sub-1');
  });

  it('honors an approve verdict when a prior review already exists', async () => {
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'sub-1', scenarioRunId: 'run-1', ciStatus: 'success' }])
      .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }])
      .mockResolvedValueOnce([{ id: 'rev-old' }]); // a prior review exists
    mockRouter.generate.mockResolvedValue({
      content: JSON.stringify({ summary: 'Good.', comments: [], verdict: 'approve' }),
    });
    mockDb.returning.mockResolvedValue([{ id: 'rev-2', verdict: 'approve' }]);

    await service.reviewSubmission(jobData);

    expect(mockGitHub.createPullRequestReview.mock.calls[0][4]).toBe('APPROVE');
  });

  it('passes the real diff to the model', async () => {
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'sub-1', scenarioRunId: 'run-1', ciStatus: 'failure' }])
      .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }])
      .mockResolvedValueOnce([]);
    mockRouter.generate.mockResolvedValue({
      content: JSON.stringify({ summary: 's', comments: [], verdict: 'request_changes' }),
    });
    mockDb.returning.mockResolvedValue([{ id: 'rev-1' }]);

    await service.reviewSubmission(jobData);

    expect(mockGitHub.getPullRequestDiff).toHaveBeenCalledWith('test-owner', 'lumi-tasks-abc', 7);
    const userMsg = mockRouter.generate.mock.calls[0][0].messages.find(
      (m: any) => m.role === 'user',
    ).content;
    expect(userMsg).toContain('diff --git');
  });
});
