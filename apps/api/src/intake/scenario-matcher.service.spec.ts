import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ScenarioMatcherService } from './scenario-matcher.service';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn(),
};
const mockRouter = { generate: jest.fn() };

const profile = {
  experienceLevel: 'junior',
  languages: ['typescript'],
  strengths: ['api design'],
  gaps: ['testing'],
  goals: 'get hired',
  confidence: 80,
};

describe('ScenarioMatcherService', () => {
  let service: ScenarioMatcherService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ScenarioMatcherService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: LLM_ROUTER, useValue: mockRouter },
      ],
    }).compile();
    service = moduleRef.get(ScenarioMatcherService);
  });

  it('returns the available scenario, a selectable role, and an LLM rationale', async () => {
    // 1) available scenario lookup
    mockDb.limit.mockResolvedValueOnce([
      { id: 'scn-1', definition: { title: 'Archive', team: ['backend_engineer', 'pm_mai'] } },
    ]);
    // 2) team roles lookup
    mockDb.orderBy.mockResolvedValueOnce([
      { key: 'pm_mai', selectableByCandidate: false },
      { key: 'backend_engineer', selectableByCandidate: true },
    ]);
    mockRouter.generate.mockResolvedValue({ content: 'This backend ticket stretches your testing.' });

    const result = await service.match(profile);

    expect(result.scenarioId).toBe('scn-1');
    expect(result.role).toBe('backend_engineer');
    expect(result.rationale).toContain('testing');
    expect(mockRouter.generate.mock.calls[0][0].role).toBe('recruiter');
  });

  it('throws when no scenario is available', async () => {
    mockDb.limit.mockResolvedValueOnce([]);
    await expect(service.match(profile)).rejects.toBeInstanceOf(BadRequestException);
  });
});
