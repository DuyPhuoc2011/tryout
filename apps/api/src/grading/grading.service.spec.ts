import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GradingService } from './grading.service';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { GitHubService } from '../github/github.service';
import { QueueService } from '../queue/queue.service';

const scenarioDefinition = {
  title: 'Add the ability to archive tasks',
  company_context: { name: 'Lumi', product: 'p', team: 't', user_role: 'Backend Engineer' },
  ticket: { id: 'LUMI-142', title: 'Archive', body: 'Add archive.' },
  agent_prompts: {
    pm_mai: { system: 'You are Mai.' },
    senior_alex: { system: 'You are Alex.' },
  },
  ground_truth: { solution_notes: 'Soft archive; add unarchive.', red_flags: ['hard delete'] },
  rubric: {
    technical: {
      weight: 0.5,
      criteria: [{ id: 'correctness', weight: 0.5, description: 'Feature works.' }],
    },
    professional: {
      weight: 0.5,
      criteria: [{ id: 'surfaced_ambiguity', weight: 0.5, description: 'Asked a clarifying question.' }],
    },
  },
};

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
};

const mockRouter = { generate: jest.fn() };
const mockGitHub = { getPullRequestDiff: jest.fn() };
const mockQueue = { enqueueGrade: jest.fn() };

describe('GradingService', () => {
  let service: GradingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GradingService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: LLM_ROUTER, useValue: mockRouter },
        { provide: GitHubService, useValue: mockGitHub },
        { provide: QueueService, useValue: mockQueue },
      ],
    }).compile();
    service = moduleRef.get(GradingService);
    mockDb.values.mockReturnThis();
    mockDb.where.mockReturnThis();
  });

  describe('requestGrade', () => {
    it('rejects when the run has no submission', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 'run-1', userId: 'user-1', status: 'in_progress' }]);
      mockDb.orderBy.mockResolvedValueOnce([]); // no submissions

      await expect(service.requestGrade('run-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(mockQueue.enqueueGrade).not.toHaveBeenCalled();
    });

    it('flips status to grading and enqueues when a submission exists', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 'run-1', userId: 'user-1', status: 'in_progress' }]);
      mockDb.orderBy.mockResolvedValueOnce([{ id: 'sub-1', prUrl: 'x' }]);

      const res = await service.requestGrade('run-1', 'user-1');

      expect(mockDb.set).toHaveBeenCalledWith({ status: 'grading' });
      expect(mockQueue.enqueueGrade).toHaveBeenCalledWith({ scenarioRunId: 'run-1' });
      expect(res.status).toBe('grading');
    });

    it('throws NotFound when the run belongs to another user', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 'run-1', userId: 'someone-else', status: 'in_progress' }]);
      await expect(service.requestGrade('run-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('gradeRun', () => {
    it('grades the run: persists a scorecard and completes the run', async () => {
      // run, scenario (two .limit loads)
      mockDb.limit
        .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1', status: 'grading' }])
        .mockResolvedValueOnce([{ definition: scenarioDefinition }]);
      // submissions, messages, reviews (three .orderBy loads, in this order)
      mockDb.orderBy
        .mockResolvedValueOnce([
          { id: 'sub-1', prUrl: 'https://github.com/test-owner/lumi-tasks-x/pull/3', ciStatus: 'success' },
        ])
        .mockResolvedValueOnce([
          { agentRole: 'pm', direction: 'user', content: 'Should archived be hidden?' },
          { agentRole: 'pm', direction: 'agent', content: 'Yes, hide them by default.' },
        ])
        .mockResolvedValueOnce([
          { verdict: 'request_changes', comments: { summary: 'Add unarchive', comments: [] } },
        ]);
      mockGitHub.getPullRequestDiff.mockResolvedValue('diff --git a/x b/x');
      mockRouter.generate.mockResolvedValue({
        content: JSON.stringify({
          technicalScore: 82,
          technicalFeedback: 'Solid; missing an edge case.',
          professionalScore: 90,
          professionalFeedback: 'Asked a great clarifying question.',
          overallFeedback: 'Strong first ticket.',
        }),
      });

      await service.gradeRun('run-1');

      // Grader was called as the grader at grade complexity.
      const callArg = mockRouter.generate.mock.calls[0][0];
      expect(callArg.role).toBe('grader');
      expect(callArg.taskComplexity).toBe('grade');
      // The diff was fetched from the parsed PR URL.
      expect(mockGitHub.getPullRequestDiff).toHaveBeenCalledWith('test-owner', 'lumi-tasks-x', 3);
      // The scorecard was inserted with parsed scores.
      const inserted = mockDb.values.mock.calls.at(-1)[0];
      expect(inserted.scenarioRunId).toBe('run-1');
      expect(inserted.technicalScore).toBe(82);
      expect(inserted.professionalScore).toBe(90);
      expect(inserted.overallFeedback).toBe('Strong first ticket.');
      // The run was completed.
      expect(mockDb.set).toHaveBeenCalledWith({ status: 'complete' });
    });

    it('clamps out-of-range scores to 0–100', async () => {
      mockDb.limit
        .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1', status: 'grading' }])
        .mockResolvedValueOnce([{ definition: scenarioDefinition }]);
      mockDb.orderBy
        .mockResolvedValueOnce([{ id: 'sub-1', prUrl: 'https://github.com/o/r/pull/1', ciStatus: 'failure' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockGitHub.getPullRequestDiff.mockResolvedValue('diff');
      mockRouter.generate.mockResolvedValue({
        content: JSON.stringify({
          technicalScore: 130,
          technicalFeedback: 't',
          professionalScore: -20,
          professionalFeedback: 'p',
          overallFeedback: 'o',
        }),
      });

      await service.gradeRun('run-1');

      const inserted = mockDb.values.mock.calls.at(-1)[0];
      expect(inserted.technicalScore).toBe(100);
      expect(inserted.professionalScore).toBe(0);
    });
  });
});
