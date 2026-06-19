import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { ScenarioMatcherService } from './scenario-matcher.service';
import { ScenarioRunsService } from '../scenario-runs/scenario-runs.service';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { OPENING_GREETING } from './intake.prompts';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
};
const mockRouter = { generate: jest.fn() };
const mockMatcher = { match: jest.fn() };
const mockRuns = { startRun: jest.fn() };

function build(): Promise<IntakeService> {
  return Test.createTestingModule({
    providers: [
      IntakeService,
      { provide: DRIZZLE, useValue: mockDb },
      { provide: LLM_ROUTER, useValue: mockRouter },
      { provide: ScenarioMatcherService, useValue: mockMatcher },
      { provide: ScenarioRunsService, useValue: mockRuns },
    ],
  })
    .compile()
    .then((m) => m.get(IntakeService));
}

describe('IntakeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.values.mockReturnThis();
    mockDb.where.mockReturnThis();
  });

  it('creates a new session with the opening greeting when none is active', async () => {
    mockDb.limit.mockResolvedValueOnce([]); // no active profile
    mockDb.returning.mockResolvedValueOnce([
      { id: 'cp-1', transcript: [{ role: 'recruiter', content: OPENING_GREETING }], confidence: 0 },
    ]);

    const service = await build();
    const session = await service.startOrResume('user-1');

    expect(session.id).toBe('cp-1');
    expect(session.transcript[0]).toEqual({ role: 'recruiter', content: OPENING_GREETING });
    expect(session.readyToPlace).toBe(false);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('resumes the existing active session instead of creating one', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'cp-1',
        transcript: [{ role: 'recruiter', content: 'hi' }, { role: 'candidate', content: 'hey' }],
        experienceLevel: 'junior',
        languages: ['ts'],
        strengths: [],
        gaps: [],
        goals: null,
        confidence: 20,
        scenarioRunId: null,
      },
    ]);

    const service = await build();
    const session = await service.startOrResume('user-1');

    expect(session.id).toBe('cp-1');
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(session.profile.confidence).toBe(20);
  });

  it('throws NotFound loading a session that belongs to another user', async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: 'cp-1', userId: 'someone-else' }]);
    const service = await build();
    await expect(service.getSession('cp-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
