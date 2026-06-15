import { Test } from '@nestjs/testing';
import { PollCiProcessor } from './poll-ci.processor';
import { GitHubService } from '../../github/github.service';
import { QueueService } from '../queue.service';
import { DRIZZLE } from '../../db/db.module';

const mockDb = {
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockResolvedValue(undefined),
};

const mockGitHubService = {
  getCheckRuns: jest.fn(),
};

const mockQueueService = {
  enqueuePollCi: jest.fn(),
  enqueueReview: jest.fn(),
};

const baseJobData = {
  submissionId: 'sub-1',
  repoOwner: 'test-owner',
  repoName: 'lumi-tasks-abc',
  prNumber: 7,
  headSha: 'sha-abc',
  attemptCount: 0,
};

describe('PollCiProcessor', () => {
  let processor: PollCiProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PollCiProcessor,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: GitHubService, useValue: mockGitHubService },
        { provide: QueueService, useValue: mockQueueService },
      ],
    }).compile();
    processor = moduleRef.get(PollCiProcessor);
  });

  it('re-enqueues when check runs are still in progress', async () => {
    mockGitHubService.getCheckRuns.mockResolvedValue([
      { id: 1, name: 'CI', status: 'in_progress', conclusion: null },
    ]);

    await processor.process({ data: { ...baseJobData, attemptCount: 1 } } as any);

    expect(mockQueueService.enqueuePollCi).toHaveBeenCalledWith(
      expect.objectContaining({ attemptCount: 2 }),
      expect.any(Number),
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('re-enqueues when no check runs exist yet', async () => {
    mockGitHubService.getCheckRuns.mockResolvedValue([]);

    await processor.process({ data: baseJobData } as any);

    expect(mockQueueService.enqueuePollCi).toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('updates the Submission when all checks are complete', async () => {
    mockGitHubService.getCheckRuns.mockResolvedValue([
      { id: 1, name: 'CI', status: 'completed', conclusion: 'success' },
    ]);

    await processor.process({ data: baseJobData } as any);

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ ciStatus: 'success' }),
    );
    expect(mockQueueService.enqueuePollCi).not.toHaveBeenCalled();
    expect(mockQueueService.enqueueReview).toHaveBeenCalledWith({
      submissionId: 'sub-1',
      repoOwner: 'test-owner',
      repoName: 'lumi-tasks-abc',
      prNumber: 7,
    });
  });

  it('records failure conclusion correctly', async () => {
    mockGitHubService.getCheckRuns.mockResolvedValue([
      { id: 1, name: 'CI', status: 'completed', conclusion: 'failure' },
    ]);

    await processor.process({ data: baseJobData } as any);

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ ciStatus: 'failure' }),
    );
  });

  it('stops polling when max attempts reached', async () => {
    mockGitHubService.getCheckRuns.mockResolvedValue([
      { id: 1, name: 'CI', status: 'in_progress', conclusion: null },
    ]);

    await processor.process({ data: { ...baseJobData, attemptCount: 120 } } as any);

    expect(mockQueueService.enqueuePollCi).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
