import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, asc, desc } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { ScenarioDefinition } from '@tryout/shared';
import type { LlmRouter } from '@tryout/llm';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { GitHubService } from '../github/github.service';
import { QueueService } from '../queue/queue.service';

interface ParsedScorecard {
  technicalScore: number;
  technicalFeedback: string;
  professionalScore: number;
  professionalFeedback: string;
  overallFeedback: string;
}

const MAX_DIFF_CHARS = 12_000;

@Injectable()
export class GradingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_ROUTER) private readonly router: LlmRouter,
    private readonly github: GitHubService,
    private readonly queue: QueueService,
  ) {}

  async requestGrade(runId: string, userId: string): Promise<{ status: string }> {
    await this.loadOwnedRun(runId, userId);

    const submissions = await this.db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.scenarioRunId, runId))
      .orderBy(desc(schema.submissions.createdAt));
    if (submissions.length === 0) {
      throw new BadRequestException('Cannot grade a run with no pull request submission yet.');
    }

    await this.db
      .update(schema.scenarioRuns)
      .set({ status: 'grading' })
      .where(eq(schema.scenarioRuns.id, runId));

    await this.queue.enqueueGrade({ scenarioRunId: runId });
    return { status: 'grading' };
  }

  async getScorecard(runId: string, userId: string) {
    await this.loadOwnedRun(runId, userId);
    const [scorecard] = await this.db
      .select()
      .from(schema.scorecards)
      .where(eq(schema.scorecards.scenarioRunId, runId))
      .orderBy(desc(schema.scorecards.createdAt))
      .limit(1);
    if (!scorecard) throw new NotFoundException('No scorecard yet for this run.');
    return scorecard;
  }

  async gradeRun(scenarioRunId: string): Promise<void> {
    const [run] = await this.db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, scenarioRunId))
      .limit(1);
    if (!run) throw new NotFoundException(`Scenario run ${scenarioRunId} not found.`);

    const [scenario] = await this.db
      .select({ definition: schema.scenarios.definition })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.id, run.scenarioId))
      .limit(1);
    if (!scenario) throw new NotFoundException('Scenario not found.');
    const def = scenario.definition as ScenarioDefinition;

    const submissions = await this.db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.scenarioRunId, scenarioRunId))
      .orderBy(desc(schema.submissions.createdAt));
    const latest = submissions[0];
    if (!latest) throw new BadRequestException('No submission to grade.');

    const messages = await this.db
      .select()
      .from(schema.agentMessages)
      .where(eq(schema.agentMessages.scenarioRunId, scenarioRunId))
      .orderBy(asc(schema.agentMessages.createdAt));

    const reviews = await this.db
      .select({
        verdict: schema.reviews.verdict,
        comments: schema.reviews.comments,
      })
      .from(schema.reviews)
      .innerJoin(schema.submissions, eq(schema.reviews.submissionId, schema.submissions.id))
      .where(eq(schema.submissions.scenarioRunId, scenarioRunId))
      .orderBy(asc(schema.reviews.createdAt));

    const { owner, repo, prNumber } = this.parsePrUrl(latest.prUrl);
    const rawDiff = await this.github.getPullRequestDiff(owner, repo, prNumber);
    const diff = rawDiff.slice(0, MAX_DIFF_CHARS);

    const system = this.buildSystem(def);
    const user = this.buildUserContext(def, messages, reviews, latest.ciStatus, diff);

    const result = await this.router.generate({
      role: 'grader',
      taskComplexity: 'grade',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const parsed = this.parseScorecard(result.content);

    await this.db.insert(schema.scorecards).values({
      scenarioRunId,
      technicalScore: parsed.technicalScore,
      technicalFeedback: parsed.technicalFeedback,
      professionalScore: parsed.professionalScore,
      professionalFeedback: parsed.professionalFeedback,
      overallFeedback: parsed.overallFeedback,
    });

    await this.db
      .update(schema.scenarioRuns)
      .set({ status: 'complete' })
      .where(eq(schema.scenarioRuns.id, scenarioRunId));
  }

  private async loadOwnedRun(runId: string, userId: string) {
    const [run] = await this.db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, runId))
      .limit(1);
    if (!run || run.userId !== userId) {
      throw new NotFoundException(`Scenario run ${runId} not found.`);
    }
    return run;
  }

  private parsePrUrl(prUrl: string): { owner: string; repo: string; prNumber: number } {
    const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) throw new BadRequestException(`Cannot parse PR URL: ${prUrl}`);
    return { owner: m[1], repo: m[2], prNumber: Number(m[3]) };
  }

  private buildSystem(def: ScenarioDefinition): string {
    const tech = def.rubric.technical.criteria
      .map((c) => `- ${c.id} (weight ${c.weight}): ${c.description}`)
      .join('\n');
    const prof = def.rubric.professional.criteria
      .map((c) => `- ${c.id} (weight ${c.weight}): ${c.description}`)
      .join('\n');
    return [
      'You are the Grader for a software-engineering simulation. You have the ground truth, so your judgments are anchored, not vibes. Your written feedback is specific, actionable, and kind — this is a learning product, never demoralizing.',
      '',
      `Ground-truth solution notes: ${def.ground_truth.solution_notes}`,
      `Red flags to penalize if present: ${def.ground_truth.red_flags.join('; ')}`,
      '',
      `Technical dimension (overall weight ${def.rubric.technical.weight}):`,
      tech,
      `Professional dimension (overall weight ${def.rubric.professional.weight}):`,
      prof,
      '',
      'Score each dimension 0–100. Respond ONLY with JSON, no prose around it, matching exactly:',
      '{"technicalScore": number, "technicalFeedback": string, "professionalScore": number, "professionalFeedback": string, "overallFeedback": string}',
    ].join('\n');
  }

  private buildUserContext(
    def: ScenarioDefinition,
    messages: { agentRole: string; direction: string; content: string }[],
    reviews: { verdict: string; comments: unknown }[],
    ciStatus: string | null,
    diff: string,
  ): string {
    const transcript = messages.length
      ? messages.map((m) => `[${m.agentRole}/${m.direction}] ${m.content}`).join('\n')
      : '(no messages — the engineer never spoke to the PM or Senior)';
    const reviewThread = reviews.length
      ? reviews
          .map((r) => `[senior verdict: ${r.verdict}] ${JSON.stringify(r.comments)}`)
          .join('\n')
      : '(no reviews)';
    return [
      `Ticket ${def.ticket.id}: ${def.ticket.title}`,
      def.ticket.body,
      '',
      `CI status on the final submission: ${ciStatus ?? 'unknown'}`,
      '',
      '--- Conversation transcript ---',
      transcript,
      '',
      '--- Senior review thread ---',
      reviewThread,
      '',
      '--- PR diff ---',
      diff,
    ].join('\n');
  }

  private parseScorecard(content: string): ParsedScorecard {
    const fallback: ParsedScorecard = {
      technicalScore: 0,
      technicalFeedback: '',
      professionalScore: 0,
      professionalFeedback: '',
      overallFeedback: content.trim(),
    };
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1) return fallback;
    try {
      const o = JSON.parse(content.slice(start, end + 1));
      return {
        technicalScore: this.clampScore(o.technicalScore),
        technicalFeedback: String(o.technicalFeedback ?? ''),
        professionalScore: this.clampScore(o.professionalScore),
        professionalFeedback: String(o.professionalFeedback ?? ''),
        overallFeedback: String(o.overallFeedback ?? ''),
      };
    } catch {
      return fallback;
    }
  }

  private clampScore(value: unknown): number {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }
}
