import { Test } from '@nestjs/testing';
import { PollPrProcessor } from './poll-pr.processor';
import { GitHubService } from '../../github/github.service';
import { QueueService } from '../queue.service';
import { QUEUE_NAMES } from '../queue.constants';
import { DRIZZLE } from '../../db/db.module';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
};

const mockGitHubService = {
  listOpenPullRequests: jest.fn(),
};

const mockQueueService = {
  enqueuePollPr: jest.fn(),
  enqueuePollCi: jest.fn(),
};

describe('PollPrProcessor', () => {
  let processor: PollPrProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PollPrProcessor,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: GitHubService, useValue: mockGitHubService },
        { provide: QueueService, useValue: mockQueueService },
      ],
    }).compile();
    processor = moduleRef.get(PollPrProcessor);
  });

  it('re-enqueues itself when no PR is found and attempts remain', async () => {
    mockGitHubService.listOpenPullRequests.mockResolvedValue([]);

    const job = {
      data: {
        scenarioRunId: 'run-1',
        repoOwner: 'test-owner',
        repoName: 'lumi-tasks-abc',
        attemptCount: 1,
      },
    } as any;

    await processor.process(job);

    expect(mockQueueService.enqueuePollPr).toHaveBeenCalledWith(
      { scenarioRunId: 'run-1', repoOwner: 'test-owner', repoName: 'lumi-tasks-abc', attemptCount: 2 },
      expect.any(Number),
    );
    expect(mockQueueService.enqueuePollCi).not.toHaveBeenCalled();
  });

  it('stops polling when max attempts reached', async () => {
    mockGitHubService.listOpenPullRequests.mockResolvedValue([]);

    const job = {
      data: {
        scenarioRunId: 'run-1',
        repoOwner: 'test-owner',
        repoName: 'lumi-tasks-abc',
        attemptCount: 120,
      },
    } as any;

    await processor.process(job);

    expect(mockQueueService.enqueuePollPr).not.toHaveBeenCalled();
    expect(mockQueueService.enqueuePollCi).not.toHaveBeenCalled();
  });

  it('creates a Submission and enqueues poll-ci when a PR is found', async () => {
    mockGitHubService.listOpenPullRequests.mockResolvedValue([
      { number: 7, headSha: 'sha-abc', htmlUrl: 'https://github.com/o/r/pull/7', title: 'feat: archive' },
    ]);
    mockDb.returning.mockResolvedValue([{ id: 'sub-1' }]);

    const job = {
      data: {
        scenarioRunId: 'run-1',
        repoOwner: 'test-owner',
        repoName: 'lumi-tasks-abc',
        attemptCount: 1,
      },
    } as any;

    await processor.process(job);

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockQueueService.enqueuePollCi).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: 'sub-1', prNumber: 7, headSha: 'sha-abc' }),
      expect.any(Number),
    );
    expect(mockQueueService.enqueuePollPr).not.toHaveBeenCalled();
  });
});
