import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type {
  IntakeMessage,
  IntakePlacementResult,
  IntakeSessionView,
  IntakeTurnResult,
  ProfileSnapshot,
} from '@tryout/shared';
import type { LlmRouter } from '@tryout/llm';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { ScenarioMatcherService } from './scenario-matcher.service';
import { ScenarioRunsService } from '../scenario-runs/scenario-runs.service';
import { OPENING_GREETING, SAM_SYSTEM, RETURNING_HINT, CV_SYSTEM } from './intake.prompts';

const READY_CONFIDENCE = 70;
const TURN_CAP = 12;
const MAX_CV_CHARS = 12000; // ~3-4k tokens; enough for a CV, keeps the call cheap.

/** Minimal slice of an uploaded file we need (multer memory storage). */
export interface UploadedCv {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}
// Stable prefix for the returning-candidate greeting; also used to detect the mode.
const WELCOME_BACK_PREFIX = 'Welcome back! Good to see you again.';

type ProfileRow = typeof schema.candidateProfiles.$inferSelect;

@Injectable()
export class IntakeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_ROUTER) private readonly router: LlmRouter,
    private readonly matcher: ScenarioMatcherService,
    private readonly runs: ScenarioRunsService,
  ) {}

  /**
   * Start a FRESH conversation each time (e.g. on login). We never auto-resume
   * the old transcript here — in-session refresh resumes by id via getSession().
   * Sam still knows the candidate: her learned profile fields are carried over
   * and recapped in the greeting, so the chat is short but informed.
   */
  async startOrResume(userId: string): Promise<IntakeSessionView> {
    const [latest] = await this.db
      .select()
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.userId, userId))
      .orderBy(desc(schema.candidateProfiles.createdAt))
      .limit(1);

    const known = latest && this.hasProfileInfo(latest as ProfileRow);

    // Greeting + seed depend on whether Sam actually knows anything about them.
    const greeting = known
      ? this.returningGreeting(latest as ProfileRow)
      : OPENING_GREETING;
    const transcript = [{ role: 'recruiter' as const, content: greeting }];

    // Reuse the in-progress (unplaced) row if there is one: just reset the
    // transcript to a fresh greeting, keep the learned fields. Avoids a new
    // row per login. A placed latest means a new attempt -> insert a fresh row.
    if (latest && !latest.scenarioRunId) {
      const [reset] = await this.db
        .update(schema.candidateProfiles)
        .set({ transcript, confidence: Math.min(latest.confidence ?? 0, 50) })
        .where(eq(schema.candidateProfiles.id, latest.id))
        .returning();
      return this.toView(reset as ProfileRow);
    }

    const seed = known
      ? {
          experienceLevel: latest.experienceLevel,
          languages: latest.languages,
          strengths: latest.strengths,
          gaps: latest.gaps,
          goals: latest.goals,
          confidence: Math.min(latest.confidence ?? 0, 50),
        }
      : {};

    const [created] = await this.db
      .insert(schema.candidateProfiles)
      .values({ userId, transcript, ...seed })
      .returning();
    return this.toView(created as ProfileRow);
  }

  /** True if Sam has learned anything worth recalling about this candidate. */
  private hasProfileInfo(row: ProfileRow): boolean {
    return (
      (row.confidence ?? 0) > 0 ||
      ((row.languages as string[]) ?? []).length > 0 ||
      ((row.strengths as string[]) ?? []).length > 0 ||
      ((row.gaps as string[]) ?? []).length > 0 ||
      !!row.experienceLevel ||
      !!row.goals
    );
  }

  /** Template welcome-back that recaps what Sam already knows. No LLM call. */
  private returningGreeting(prior: ProfileRow): string {
    const langs = (prior.languages as string[]) ?? [];
    const strengths = (prior.strengths as string[]) ?? [];
    const gaps = (prior.gaps as string[]) ?? [];
    const recap: string[] = [];
    if (langs.length) recap.push(`working mostly with ${langs.join(', ')}`);
    if (strengths.length) recap.push(`strong on ${strengths.join(', ')}`);
    if (gaps.length) recap.push(`looking to level up your ${gaps.join(', ')}`);
    const memory = recap.length ? ` Last time, you were ${recap.join('; ')}.` : '';
    return `${WELCOME_BACK_PREFIX}${memory} Want to pick up from where we left off, or has anything changed since we last talked?`;
  }

  async getSession(id: string, userId: string): Promise<IntakeSessionView> {
    const row = await this.loadOwned(id, userId);
    return this.toView(row);
  }

  /**
   * Whether the candidate can be placed now. LLM-reported confidence is one
   * path, but it's sticky and gets capped for returning users — so a profile
   * that already carries enough signal to match (languages + strengths + gaps)
   * is placeable regardless. Without this, a returning candidate Sam already
   * knows gets trapped re-earning confidence and the "place" button never shows.
   */
  private isPlaceable(profile: ProfileSnapshot, candidateTurns: number): boolean {
    const knowsEnough =
      profile.languages.length > 0 &&
      profile.strengths.length > 0 &&
      profile.gaps.length > 0;
    return (
      profile.confidence >= READY_CONFIDENCE || candidateTurns >= TURN_CAP || knowsEnough
    );
  }

  async sendTurn(id: string, userId: string, content: string): Promise<IntakeTurnResult> {
    const row = await this.loadOwned(id, userId);
    if (row.scenarioRunId) {
      throw new BadRequestException('This intake is already complete.');
    }

    const transcript: IntakeMessage[] = [
      ...(row.transcript as IntakeMessage[]),
      { role: 'candidate', content },
    ];

    const { reply, profile } = await this.askSam(transcript, this.toProfile(row));
    transcript.push({ role: 'recruiter', content: reply });

    const candidateTurns = transcript.filter((m) => m.role === 'candidate').length;
    const readyToPlace = this.isPlaceable(profile, candidateTurns);

    await this.db
      .update(schema.candidateProfiles)
      .set({
        transcript,
        experienceLevel: profile.experienceLevel,
        languages: profile.languages,
        strengths: profile.strengths,
        gaps: profile.gaps,
        goals: profile.goals,
        confidence: profile.confidence,
      })
      .where(eq(schema.candidateProfiles.id, id));

    return { reply, transcript, profile, readyToPlace };
  }

  /** Skip the long Q&A: read a CV, fill the profile in one shot, confirm. */
  async ingestCv(id: string, userId: string, file: UploadedCv): Promise<IntakeTurnResult> {
    const row = await this.loadOwned(id, userId);
    if (row.scenarioRunId) {
      throw new BadRequestException('This intake is already complete.');
    }

    const text = (await this.extractCvText(file)).slice(0, MAX_CV_CHARS);
    if (!text.trim()) {
      throw new BadRequestException('Could not read any text from that file.');
    }

    const { reply, profile } = await this.readCv(text, this.toProfile(row));

    const transcript: IntakeMessage[] = [
      ...(row.transcript as IntakeMessage[]),
      { role: 'candidate', content: `[Uploaded CV: ${file.originalname}]` },
      { role: 'recruiter', content: reply },
    ];

    const candidateTurns = transcript.filter((m) => m.role === 'candidate').length;
    const readyToPlace = this.isPlaceable(profile, candidateTurns);

    await this.db
      .update(schema.candidateProfiles)
      .set({
        transcript,
        experienceLevel: profile.experienceLevel,
        languages: profile.languages,
        strengths: profile.strengths,
        gaps: profile.gaps,
        goals: profile.goals,
        confidence: profile.confidence,
      })
      .where(eq(schema.candidateProfiles.id, id));

    return { reply, transcript, profile, readyToPlace };
  }

  private async extractCvText(file: UploadedCv): Promise<string> {
    const isPdf =
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: file.buffer });
      try {
        const result = await parser.getText();
        return result.text ?? '';
      } finally {
        await parser.destroy();
      }
    }
    // Plain text / markdown.
    return file.buffer.toString('utf8');
  }

  /** One LLM call: CV text -> profile + warm confirmation, reusing the JSON parser. */
  private async readCv(text: string, current: ProfileSnapshot) {
    const result = await this.router.generate({
      role: 'recruiter',
      taskComplexity: 'chat',
      messages: [
        { role: 'system', content: CV_SYSTEM },
        { role: 'user', content: `CV text:\n\n${text}` },
      ],
    });
    return this.parseSam(result.content, current);
  }

  async place(id: string, userId: string): Promise<IntakePlacementResult> {
    const row = await this.loadOwned(id, userId);
    if (row.scenarioRunId) {
      throw new BadRequestException('This intake is already complete.');
    }

    const match = await this.matcher.match(this.toProfile(row));
    const run = await this.runs.startRun(userId, {
      scenarioId: match.scenarioId,
      role: match.role,
    });

    await this.db
      .update(schema.candidateProfiles)
      .set({
        scenarioRunId: run.id,
        matchedScenarioId: match.scenarioId,
        matchedRole: match.role,
        matchRationale: match.rationale,
      })
      .where(eq(schema.candidateProfiles.id, id));

    return { runId: run.id, scenarioId: match.scenarioId, role: match.role, rationale: match.rationale };
  }

  private async loadOwned(id: string, userId: string): Promise<ProfileRow> {
    const [row] = await this.db
      .select()
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.id, id))
      .limit(1);
    if (!row || row.userId !== userId) {
      throw new NotFoundException(`Intake session ${id} not found.`);
    }
    return row as ProfileRow;
  }

  /** One LLM call: Sam replies AND returns a cumulative profile read, as strict JSON. */
  private async askSam(
    transcript: IntakeMessage[],
    current: ProfileSnapshot,
  ): Promise<{ reply: string; profile: ProfileSnapshot }> {
    // Returning sessions open with the welcome-back greeting; nudge Sam to
    // confirm the seeded profile instead of re-interviewing from scratch.
    const returning = transcript[0]?.content?.startsWith(WELCOME_BACK_PREFIX) ?? false;
    const system = returning ? `${SAM_SYSTEM}\n\n${RETURNING_HINT}` : SAM_SYSTEM;

    const messages = [
      { role: 'system' as const, content: system },
      ...transcript.map((m) => ({
        role: (m.role === 'candidate' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const result = await this.router.generate({
      role: 'recruiter',
      taskComplexity: 'chat',
      messages,
    });

    return this.parseSam(result.content, current);
  }

  /** Tolerant parse: fall back to raw text as the reply and keep the prior profile. */
  private parseSam(raw: string, current: ProfileSnapshot): { reply: string; profile: ProfileSnapshot } {
    try {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
      const parsed = JSON.parse(json) as {
        reply?: string;
        profile?: Partial<ProfileSnapshot>;
      };
      return {
        reply: typeof parsed.reply === 'string' ? parsed.reply : raw,
        profile: this.mergeProfile(current, parsed.profile ?? {}),
      };
    } catch {
      return { reply: raw, profile: current };
    }
  }

  private mergeProfile(current: ProfileSnapshot, patch: Partial<ProfileSnapshot>): ProfileSnapshot {
    return {
      experienceLevel:
        typeof patch.experienceLevel === 'string' ? patch.experienceLevel : current.experienceLevel,
      languages: Array.isArray(patch.languages) ? patch.languages : current.languages,
      strengths: Array.isArray(patch.strengths) ? patch.strengths : current.strengths,
      gaps: Array.isArray(patch.gaps) ? patch.gaps : current.gaps,
      goals: typeof patch.goals === 'string' ? patch.goals : current.goals,
      confidence:
        typeof patch.confidence === 'number'
          ? Math.max(0, Math.min(100, patch.confidence))
          : current.confidence,
    };
  }

  private toProfile(row: ProfileRow): ProfileSnapshot {
    return {
      experienceLevel: row.experienceLevel ?? null,
      languages: (row.languages as string[]) ?? [],
      strengths: (row.strengths as string[]) ?? [],
      gaps: (row.gaps as string[]) ?? [],
      goals: row.goals ?? null,
      confidence: row.confidence ?? 0,
    };
  }

  private toView(row: ProfileRow): IntakeSessionView {
    const profile = this.toProfile(row);
    const transcript = (row.transcript as IntakeMessage[]) ?? [];
    const candidateTurns = transcript.filter((m) => m.role === 'candidate').length;
    return {
      id: row.id,
      transcript,
      profile,
      readyToPlace: this.isPlaceable(profile, candidateTurns),
    };
  }
}
