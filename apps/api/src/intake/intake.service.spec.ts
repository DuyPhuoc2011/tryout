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

  it('creates a new session with the opening greeting for a brand-new user', async () => {
    mockDb.limit.mockResolvedValueOnce([]); // no prior profile at all
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

  it('seeds a NEW session from a previously PLACED profile with a welcome-back greeting', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'cp-old',
        experienceLevel: 'junior',
        languages: ['TypeScript'],
        strengths: ['API design'],
        gaps: ['testing'],
        goals: 'become a senior engineer',
        confidence: 80,
        scenarioRunId: 'run-old', // placed -> new attempt, insert a fresh row
      },
    ]);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'cp-2', transcript: [{ role: 'recruiter', content: 'Welcome back! Good to see you again.' }], confidence: 50 },
    ]);

    const service = await build();
    const session = await service.startOrResume('user-1');

    expect(session.id).toBe('cp-2');
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        experienceLevel: 'junior',
        languages: ['TypeScript'],
        strengths: ['API design'],
        confidence: 50,
        transcript: [
          expect.objectContaining({
            role: 'recruiter',
            content: expect.stringContaining('Welcome back'),
          }),
        ],
      }),
    );
  });

  it('resets the in-progress row to a fresh welcome-back, keeping learned fields', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'cp-1',
        transcript: [
          { role: 'recruiter', content: 'hi' },
          { role: 'candidate', content: 'I use TypeScript' },
          { role: 'recruiter', content: 'nice' },
        ],
        experienceLevel: 'junior',
        languages: ['TypeScript'],
        strengths: [],
        gaps: [],
        goals: null,
        confidence: 20,
        scenarioRunId: null, // in-progress -> reuse + reset transcript
      },
    ]);
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'cp-1',
        transcript: [{ role: 'recruiter', content: 'Welcome back! Good to see you again. Last time...' }],
        languages: ['TypeScript'],
        confidence: 20,
      },
    ]);

    const service = await build();
    const session = await service.startOrResume('user-1');

    expect(session.id).toBe('cp-1');
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
    // Fresh transcript (single welcome-back message), confidence capped.
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        confidence: 20,
        transcript: [
          expect.objectContaining({ content: expect.stringContaining('Welcome back') }),
        ],
      }),
    );
    expect(session.transcript).toHaveLength(1);
  });

  it('marks a returning candidate placeable from a known profile despite low confidence', async () => {
    // The welcome-back path caps confidence at 50 and resets the transcript to
    // 0 turns, so a known candidate would otherwise be stuck below the gate.
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'cp-1',
        userId: 'user-1',
        transcript: [
          { role: 'recruiter', content: 'Welcome back! Good to see you again. Last time...' },
        ],
        experienceLevel: 'junior',
        languages: ['Node.js', 'TypeScript'],
        strengths: ['backend development', 'databases'],
        gaps: ['debugging', 'DevOps/SRE'],
        goals: 'level up debugging',
        confidence: 30,
        scenarioRunId: null,
      },
    ]);

    const service = await build();
    const session = await service.getSession('cp-1', 'user-1');

    // Knows enough to match (languages + strengths + gaps) -> placeable now,
    // so the "Show me where I fit" button appears immediately.
    expect(session.readyToPlace).toBe(true);
    expect(session.profile.confidence).toBe(30);
  });

  it('throws NotFound loading a session that belongs to another user', async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: 'cp-1', userId: 'someone-else' }]);
    const service = await build();
    await expect(service.getSession('cp-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('parses Sam JSON, merges the profile, and flips readyToPlace on high confidence', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'cp-1',
        userId: 'user-1',
        transcript: [{ role: 'recruiter', content: 'hi' }],
        experienceLevel: null,
        languages: [],
        strengths: [],
        gaps: [],
        goals: null,
        confidence: 10,
        scenarioRunId: null,
      },
    ]);
    mockRouter.generate.mockResolvedValueOnce({
      content:
        '{"reply":"Great, sounds like you know APIs well.","profile":{"experienceLevel":"junior","languages":["typescript"],"strengths":["api design"],"gaps":["testing"],"goals":"get hired","confidence":85}}',
    });

    const service = await build();
    const result = await service.sendTurn('cp-1', 'user-1', 'I built a few REST APIs in Nest.');

    expect(result.reply).toContain('APIs');
    expect(result.profile.strengths).toEqual(['api design']);
    expect(result.profile.confidence).toBe(85);
    expect(result.readyToPlace).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('injects the returning-candidate hint into the system prompt for welcome-back sessions', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'cp-1',
        userId: 'user-1',
        transcript: [
          { role: 'recruiter', content: 'Welcome back! Good to see you again. Last time, you were strong on APIs.' },
        ],
        experienceLevel: 'junior',
        languages: ['ts'],
        strengths: ['api design'],
        gaps: [],
        goals: null,
        confidence: 50,
        scenarioRunId: null,
      },
    ]);
    mockRouter.generate.mockResolvedValueOnce({ content: '{"reply":"Still strong on APIs?","profile":{}}' });

    const service = await build();
    await service.sendTurn('cp-1', 'user-1', 'Yep, still APIs.');

    const sentMessages = mockRouter.generate.mock.calls[0][0].messages;
    expect(sentMessages[0].role).toBe('system');
    expect(sentMessages[0].content).toContain('RETURNING candidate');
  });

  it('falls back to raw text and keeps the prior profile when Sam output is not JSON', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'cp-1',
        userId: 'user-1',
        transcript: [{ role: 'recruiter', content: 'hi' }],
        experienceLevel: 'mid',
        languages: ['go'],
        strengths: ['concurrency'],
        gaps: [],
        goals: null,
        confidence: 30,
        scenarioRunId: null,
      },
    ]);
    mockRouter.generate.mockResolvedValueOnce({ content: 'Tell me more about that.' });

    const service = await build();
    const result = await service.sendTurn('cp-1', 'user-1', 'I worked on a scheduler.');

    expect(result.reply).toBe('Tell me more about that.');
    expect(result.profile.experienceLevel).toBe('mid');
    expect(result.profile.languages).toEqual(['go']);
    expect(result.readyToPlace).toBe(false);
  });

  it('ingests a CV: extracts the profile in one shot and confirms', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'cp-1',
        userId: 'user-1',
        transcript: [{ role: 'recruiter', content: 'hi' }],
        experienceLevel: null,
        languages: [],
        strengths: [],
        gaps: [],
        goals: null,
        confidence: 0,
        scenarioRunId: null,
      },
    ]);
    mockRouter.generate.mockResolvedValueOnce({
      content:
        '{"reply":"Thanks, I reviewed your CV. Strong Go and Kubernetes background.","profile":{"experienceLevel":"senior","languages":["Go"],"strengths":["Kubernetes"],"gaps":["frontend"],"goals":"SRE lead","confidence":85}}',
    });

    const service = await build();
    const result = await service.ingestCv('cp-1', 'user-1', {
      buffer: Buffer.from('Senior platform engineer. Go, Kubernetes, Terraform. 5 years.', 'utf8'),
      mimetype: 'text/plain',
      originalname: 'cv.txt',
      size: 60,
    });

    expect(result.reply).toContain('reviewed your CV');
    expect(result.profile.languages).toEqual(['Go']);
    expect(result.profile.confidence).toBe(85);
    expect(result.readyToPlace).toBe(true); // 85 >= READY_CONFIDENCE
    expect(result.transcript.some((m) => m.content.includes('[Uploaded CV: cv.txt]'))).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('places the candidate: matches, starts a run, and links the profile', async () => {
    mockDb.limit.mockResolvedValueOnce([
      { id: 'cp-1', userId: 'user-1', languages: [], strengths: [], gaps: [], confidence: 80, scenarioRunId: null },
    ]);
    mockMatcher.match.mockResolvedValueOnce({
      scenarioId: 'scn-1',
      role: 'backend_engineer',
      rationale: 'Fits your API strength.',
    });
    mockRuns.startRun.mockResolvedValueOnce({ id: 'run-1', repoUrl: 'u', status: 'onboarding' });

    const service = await build();
    const result = await service.place('cp-1', 'user-1');

    expect(mockRuns.startRun).toHaveBeenCalledWith('user-1', {
      scenarioId: 'scn-1',
      role: 'backend_engineer',
    });
    expect(result.runId).toBe('run-1');
    expect(result.rationale).toContain('API');
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioRunId: 'run-1', matchedRole: 'backend_engineer' }),
    );
  });
});
