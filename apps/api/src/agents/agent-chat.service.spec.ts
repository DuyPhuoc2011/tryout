import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AgentChatService } from './agent-chat.service';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';

const scenarioDefinition = {
  title: 'Add the ability to archive tasks',
  company_context: { name: 'Lumi', product: 'p', team: 't', user_role: 'Backend Engineer' },
  ticket: { id: 'LUMI-142', title: 'Archive', body: 'Add archive.' },
  agent_prompts: {
    pm_mai: { system: 'You are Mai, the PM.' },
    senior_alex: { system: 'You are Alex, a senior engineer.' },
  },
  ground_truth: { solution_notes: 'Soft archive; add unarchive.', red_flags: [] },
};

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
};

const mockRouter = { generate: jest.fn() };

describe('AgentChatService', () => {
  let service: AgentChatService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentChatService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: LLM_ROUTER, useValue: mockRouter },
      ],
    }).compile();
    service = moduleRef.get(AgentChatService);
    // Default: insert chains resolve (the user-message insert is awaited with no .returning()).
    mockDb.values.mockReturnThis();
    mockDb.where.mockReturnThis();
  });

  it('persists the user turn, flips onboarding → in_progress, and returns the agent reply', async () => {
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'run-1', userId: 'user-1', scenarioId: 'scn-1', status: 'onboarding' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }]);
    // history (after the user turn is inserted): one user message for the PM thread.
    mockDb.orderBy.mockResolvedValue([
      { direction: 'user', content: 'Should archived tasks be hidden?' },
    ]);
    mockRouter.generate.mockResolvedValue({ content: 'Good question — yes, hide them by default.' });
    mockDb.returning.mockResolvedValue([
      { id: 'msg-2', agentRole: 'pm', direction: 'agent', content: 'Good question — yes, hide them by default.' },
    ]);

    const reply = await service.sendMessage('run-1', 'user-1', 'pm', 'Should archived tasks be hidden?');

    // Status moved to in_progress.
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ status: 'in_progress' });

    // The model got the PM persona as system + the user turn mapped to role 'user'.
    const callArg = mockRouter.generate.mock.calls[0][0];
    expect(callArg.role).toBe('pm');
    expect(callArg.taskComplexity).toBe('chat');
    expect(callArg.messages[0].role).toBe('system');
    expect(callArg.messages[0].content).toContain('You are Mai, the PM.');
    expect(callArg.messages[1]).toEqual({ role: 'user', content: 'Should archived tasks be hidden?' });

    // Two inserts: the user turn and the agent reply.
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
    expect(reply.content).toBe('Good question — yes, hide them by default.');
  });

  it('does not change status when the run is already in_progress', async () => {
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'run-1', userId: 'user-1', scenarioId: 'scn-1', status: 'in_progress' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }]);
    mockDb.orderBy.mockResolvedValue([{ direction: 'user', content: 'hi' }]);
    mockRouter.generate.mockResolvedValue({ content: 'hello' });
    mockDb.returning.mockResolvedValue([{ id: 'm', agentRole: 'senior', direction: 'agent', content: 'hello' }]);

    await service.sendMessage('run-1', 'user-1', 'senior', 'hi');

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('uses the Senior persona (CHAT mode) for senior messages', async () => {
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'run-1', userId: 'user-1', scenarioId: 'scn-1', status: 'in_progress' }])
      .mockResolvedValueOnce([{ definition: scenarioDefinition }]);
    mockDb.orderBy.mockResolvedValue([{ direction: 'user', content: 'where do I start?' }]);
    mockRouter.generate.mockResolvedValue({ content: 'Look at tasks.service.ts.' });
    mockDb.returning.mockResolvedValue([{ id: 'm', agentRole: 'senior', direction: 'agent', content: 'Look at tasks.service.ts.' }]);

    await service.sendMessage('run-1', 'user-1', 'senior', 'where do I start?');

    const system = mockRouter.generate.mock.calls[0][0].messages[0].content;
    expect(system).toContain('You are Alex, a senior engineer.');
    expect(system).toContain('CHAT mode');
  });

  it('throws NotFound when the run belongs to another user', async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: 'run-1', userId: 'someone-else', status: 'onboarding' }]);

    await expect(
      service.sendMessage('run-1', 'user-1', 'pm', 'hi'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
