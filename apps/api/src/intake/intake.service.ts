import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, isNull, desc } from 'drizzle-orm';
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
import { OPENING_GREETING, SAM_SYSTEM } from './intake.prompts';

const READY_CONFIDENCE = 70;
const TURN_CAP = 12;

type ProfileRow = typeof schema.candidateProfiles.$inferSelect;

@Injectable()
export class IntakeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_ROUTER) private readonly router: LlmRouter,
    private readonly matcher: ScenarioMatcherService,
    private readonly runs: ScenarioRunsService,
  ) {}

  async startOrResume(userId: string): Promise<IntakeSessionView> {
    const [active] = await this.db
      .select()
      .from(schema.candidateProfiles)
      .where(
        and(
          eq(schema.candidateProfiles.userId, userId),
          isNull(schema.candidateProfiles.scenarioRunId),
        ),
      )
      .orderBy(desc(schema.candidateProfiles.createdAt))
      .limit(1);

    if (active) return this.toView(active as ProfileRow);

    const [created] = await this.db
      .insert(schema.candidateProfiles)
      .values({
        userId,
        transcript: [{ role: 'recruiter', content: OPENING_GREETING }],
      })
      .returning();
    return this.toView(created as ProfileRow);
  }

  async getSession(id: string, userId: string): Promise<IntakeSessionView> {
    const row = await this.loadOwned(id, userId);
    return this.toView(row);
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
    const readyToPlace = profile.confidence >= READY_CONFIDENCE || candidateTurns >= TURN_CAP;

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
    const messages = [
      { role: 'system' as const, content: SAM_SYSTEM },
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
      readyToPlace: profile.confidence >= READY_CONFIDENCE || candidateTurns >= TURN_CAP,
    };
  }
}
