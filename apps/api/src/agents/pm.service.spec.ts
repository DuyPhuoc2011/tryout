import { Test } from '@nestjs/testing';
import { PmService } from './pm.service';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';

const scenarioDefinition = {
  title: 'Add the ability to archive tasks',
  company_context: {
    name: 'Lumi',
    product: 'A productivity app.',
    team: 'Small team.',
    user_role: 'Backend Engineer',
  },
  ticket: { id: 'LUMI-142', title: 'Archive tasks', body: 'Add archive.' },
  agent_prompts: {
    pm_mai: { system: 'You are Mai, the PM.' },
    senior_alex: { system: 'You are Alex.' },
  },
  ground_truth: { solution_notes: '', red_flags: [] },
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

const mockRouter = { generate: jest.fn() };

describe('PmService', () => {
  let service: PmService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PmService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: LLM_ROUTER, useValue: mockRouter },
      ],
    }).compile();
    service = moduleRef.get(PmService);
  });

  it('generates an intro and persists it as a pm agent message', async () => {
    // First select().limit() → the run; second → the scenario; third → candidate profile (none).
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }])
      .mockResolvedValueOnce([]);
    mockRouter.generate.mockResolvedValue({ content: 'Hey, welcome to Lumi!' });
    mockDb.returning.mockResolvedValue([
      { id: 'msg-1', content: 'Hey, welcome to Lumi!', agentRole: 'pm', direction: 'agent' },
    ]);

    const result = await service.generateIntro('run-1');

    // The model was asked as the PM, with the persona + ticket in the system prompt.
    const callArg = mockRouter.generate.mock.calls[0][0];
    expect(callArg.role).toBe('pm');
    expect(callArg.taskComplexity).toBe('chat');
    const systemText = callArg.messages.find((m: any) => m.role === 'system').content;
    expect(systemText).toContain('You are Mai, the PM.');
    expect(systemText).toContain('LUMI-142');

    // The message was inserted and returned.
    expect(mockDb.insert).toHaveBeenCalled();
    expect(result.content).toBe('Hey, welcome to Lumi!');
  });

  it('includes the recruiter notes in the PM system prompt when a profile exists', async () => {
    // run lookup, scenario lookup, then candidate-profile lookup
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scn-1' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }])
      .mockResolvedValueOnce([{ strengths: ['api design'], gaps: ['testing'], goals: 'get hired' }]);
    mockRouter.generate.mockResolvedValue({ content: 'Welcome aboard!' });
    mockDb.returning.mockResolvedValue([
      { id: 'm', agentRole: 'pm', direction: 'agent', content: 'Welcome aboard!' },
    ]);

    await service.generateIntro('run-1');

    const system = mockRouter.generate.mock.calls[0][0].messages[0].content;
    expect(system).toContain('testing');
    expect(system).toContain('get hired');
  });
});
