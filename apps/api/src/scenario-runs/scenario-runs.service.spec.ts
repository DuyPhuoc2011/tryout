import { Test } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ScenarioRunsService } from './scenario-runs.service';
import { DRIZZLE } from '../db/db.module';
import { GitHubService } from '../github/github.service';
import { QueueService } from '../queue/queue.service';
import { env } from '../config/env';

const availableScenario = {
  id: 'scn-1',
  available: true,
  definition: { title: 't', team: ['backend_engineer'] },
};

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
};

const mockGitHub = { createRepoFromTemplate: jest.fn() };
const mockQueue = {
  enqueuePmIntro: jest.fn().mockResolvedValue(undefined),
  enqueuePollPr: jest.fn().mockResolvedValue(undefined),
};

describe('ScenarioRunsService — daily run limit (cost guard)', () => {
  let service: ScenarioRunsService;
  const originalLimit = env.dailyRunLimit;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ScenarioRunsService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: GitHubService, useValue: mockGitHub },
        { provide: QueueService, useValue: mockQueue },
      ],
    }).compile();
    service = moduleRef.get(ScenarioRunsService);
    (env as { dailyRunLimit: number }).dailyRunLimit = 3;
  });

  afterAll(() => {
    (env as { dailyRunLimit: number }).dailyRunLimit = originalLimit;
  });

  it('throws 429 when the user is at the daily run limit', async () => {
    mockDb.limit
      .mockResolvedValueOnce([availableScenario]) // scenario lookup
      .mockResolvedValueOnce([{ value: 3 }]); // 24h run count == limit

    try {
      await service.startRun('user-1', { scenarioId: 'scn-1', role: 'backend_engineer' });
      fail('expected the cost guard to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
    // Guard fires before any spend: no repo created, no PM intro queued.
    expect(mockGitHub.createRepoFromTemplate).not.toHaveBeenCalled();
    expect(mockQueue.enqueuePmIntro).not.toHaveBeenCalled();
  });

  it('allows the run when under the limit', async () => {
    mockDb.limit
      .mockResolvedValueOnce([availableScenario]) // scenario lookup
      .mockResolvedValueOnce([{ value: 2 }]) // 24h run count < limit
      .mockResolvedValueOnce([{ key: 'backend_engineer', selectableByCandidate: true }]); // role
    mockDb.returning.mockResolvedValueOnce([{ id: 'run-1', status: 'onboarding' }]);
    mockGitHub.createRepoFromTemplate.mockResolvedValueOnce({
      fullName: 'owner/repo',
      htmlUrl: 'https://github.com/owner/repo',
    });

    const res = await service.startRun('user-1', {
      scenarioId: 'scn-1',
      role: 'backend_engineer',
    });

    expect(res.id).toBe('run-1');
    expect(mockGitHub.createRepoFromTemplate).toHaveBeenCalledTimes(1);
    expect(mockQueue.enqueuePmIntro).toHaveBeenCalledTimes(1);
  });
});
