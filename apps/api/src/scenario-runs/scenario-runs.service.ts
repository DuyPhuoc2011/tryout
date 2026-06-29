import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq, desc, and, asc, gte, count } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { ScenarioDefinition, TeamSeatView } from '@tryout/shared';
import { DRIZZLE } from '../db/db.module';
import { GitHubService } from '../github/github.service';
import { QueueService } from '../queue/queue.service';
import { env } from '../config/env';
import { CreateRunDto } from './dto/create-run.dto';

type TeamRoleRow = typeof schema.teamRoles.$inferSelect;

@Injectable()
export class ScenarioRunsService {
  private readonly logger = new Logger(ScenarioRunsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly github: GitHubService,
    private readonly queue: QueueService,
  ) {}

  async startRun(
    userId: string,
    dto: CreateRunDto,
  ): Promise<{ id: string; repoUrl: string; status: string }> {
    const [scenario] = await this.db
      .select()
      .from(schema.scenarios)
      .where(eq(schema.scenarios.id, dto.scenarioId))
      .limit(1);

    if (!scenario) {
      throw new NotFoundException(`Scenario ${dto.scenarioId} not found.`);
    }
    if (!scenario.available) {
      throw new BadRequestException('This scenario is not available to start yet.');
    }

    await this.enforceDailyRunLimit(userId);

    const def = scenario.definition as ScenarioDefinition;
    const teamKeys = def.team ?? [];
    if (!teamKeys.includes(dto.role)) {
      throw new BadRequestException(`Role "${dto.role}" is not part of this scenario's team.`);
    }
    const [roleRow] = await this.db
      .select()
      .from(schema.teamRoles)
      .where(eq(schema.teamRoles.key, dto.role))
      .limit(1);
    if (!roleRow || !roleRow.selectableByCandidate) {
      throw new BadRequestException(`Role "${dto.role}" cannot be claimed by a candidate.`);
    }

    // Provision the GitHub repo BEFORE persisting the run. If GitHub fails
    // (bad token, rate limit, outage) we surface a clean error and leave no
    // orphan run behind — orphans would otherwise count against the daily cost
    // guard and clutter the candidate's history.
    let created: Awaited<ReturnType<GitHubService['createRepoFromTemplate']>>;
    try {
      created = await this.github.createRepoFromTemplate(userId, def.repo?.template_ref);
    } catch (err) {
      this.logger.error(
        `Failed to provision repo for user ${userId}: ${err instanceof Error ? err.message : err}`,
      );
      throw new BadGatewayException(
        "We couldn't set up your project repository right now. This is on our side, not your code. Please try again in a moment.",
      );
    }
    const [repoOwner, repoName] = created.fullName.split('/');

    const [run] = await this.db
      .insert(schema.scenarioRuns)
      .values({
        userId,
        scenarioId: scenario.id,
        chosenRole: dto.role,
        status: 'onboarding',
        startedAt: new Date(),
      })
      .returning();

    await this.db.insert(schema.repos).values({
      scenarioRunId: run.id,
      url: created.htmlUrl,
      defaultBranch: 'main',
    });

    // The PM writes the welcome/ticket message asynchronously.
    await this.queue.enqueuePmIntro({ scenarioRunId: run.id });

    // Start polling for the user's PR.
    await this.queue.enqueuePollPr(
      { scenarioRunId: run.id, repoOwner, repoName, attemptCount: 0 },
      env.pollPrIntervalMs,
    );

    return { id: run.id, repoUrl: created.htmlUrl, status: run.status };
  }

  // Cost guard. Each run fans out into several LLM calls and a real GitHub repo,
  // so a public free tier needs a ceiling per user. ponytail: rolling 24h count,
  // no per-account billing. Raise DAILY_RUN_LIMIT or add tiers when monetizing.
  private async enforceDailyRunLimit(userId: string): Promise<void> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(schema.scenarioRuns)
      .where(
        and(
          eq(schema.scenarioRuns.userId, userId),
          gte(schema.scenarioRuns.createdAt, since),
        ),
      )
      .limit(1);
    if (value >= env.dailyRunLimit) {
      throw new HttpException(
        `Daily limit reached: you can start ${env.dailyRunLimit} tryouts per day. Try again tomorrow.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async getRun(runId: string, userId: string) {
    const [run] = await this.db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, runId))
      .limit(1);

    if (!run || run.userId !== userId) {
      throw new NotFoundException(`Scenario run ${runId} not found.`);
    }

    const [scenario] = await this.db
      .select({ definition: schema.scenarios.definition })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.id, run.scenarioId))
      .limit(1);
    const def = scenario?.definition as ScenarioDefinition | undefined;
    const team = await this.resolveTeam(def?.team ?? [], run.chosenRole);

    const [repo] = await this.db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.scenarioRunId, runId))
      .limit(1);

    const submissions = await this.db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.scenarioRunId, runId))
      .orderBy(desc(schema.submissions.createdAt));
    const latestSubmission = submissions[0] ?? null;

    const [pmIntro] = await this.db
      .select()
      .from(schema.agentMessages)
      .where(
        and(
          eq(schema.agentMessages.scenarioRunId, runId),
          eq(schema.agentMessages.agentRole, 'pm'),
          eq(schema.agentMessages.direction, 'agent'),
        ),
      )
      .orderBy(desc(schema.agentMessages.createdAt))
      .limit(1);

    let latestReview = null;
    if (latestSubmission) {
      const [review] = await this.db
        .select()
        .from(schema.reviews)
        .where(eq(schema.reviews.submissionId, latestSubmission.id))
        .orderBy(desc(schema.reviews.createdAt))
        .limit(1);
      latestReview = review ?? null;
    }

    return {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      chosenRole: run.chosenRole,
      scenario: def
        ? { title: def.title, companyContext: def.company_context, ticket: def.ticket }
        : null,
      team,
      repo: repo ? { url: repo.url, prNumber: repo.prNumber } : null,
      pmIntro: pmIntro ?? null,
      latestSubmission,
      latestReview,
    };
  }

  /** Resolve a scenario's team-key list into seats, flagging the candidate's seat. */
  private async resolveTeam(
    teamKeys: string[],
    chosenRole: string | null,
  ): Promise<(TeamSeatView & { isYou: boolean })[]> {
    if (teamKeys.length === 0) return [];
    const roles = await this.db
      .select()
      .from(schema.teamRoles)
      .orderBy(asc(schema.teamRoles.sortOrder));
    const byKey = new Map(roles.map((r) => [r.key, r]));
    return teamKeys
      .map((key) => byKey.get(key))
      .filter((r): r is TeamRoleRow => Boolean(r))
      .map((r) => ({
        key: r.key,
        title: r.title,
        description: r.description,
        category: r.category,
        aiName: r.aiName,
        aiInitial: r.aiInitial,
        interactive: r.interactive,
        selectable: r.selectableByCandidate,
        isYou: r.key === chosenRole,
      }));
  }
}
