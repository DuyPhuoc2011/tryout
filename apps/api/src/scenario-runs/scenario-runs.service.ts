import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, desc, and } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { ScenarioDefinition } from '@tryout/shared';
import { DRIZZLE } from '../db/db.module';
import { GitHubService } from '../github/github.service';
import { QueueService } from '../queue/queue.service';
import { env } from '../config/env';

@Injectable()
export class ScenarioRunsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly github: GitHubService,
    private readonly queue: QueueService,
  ) {}

  async startRun(userId: string): Promise<{ id: string; repoUrl: string; status: string }> {
    const [scenario] = await this.db
      .select({ id: schema.scenarios.id })
      .from(schema.scenarios)
      .innerJoin(schema.tracks, eq(schema.scenarios.trackId, schema.tracks.id))
      .where(eq(schema.tracks.name, 'backend'))
      .limit(1);

    if (!scenario) {
      throw new NotFoundException('No active scenario found for the backend track.');
    }

    const [run] = await this.db
      .insert(schema.scenarioRuns)
      .values({ userId, scenarioId: scenario.id, status: 'onboarding', startedAt: new Date() })
      .returning();

    const created = await this.github.createRepoFromTemplate(userId);
    const [repoOwner, repoName] = created.fullName.split('/');

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
      scenario: def
        ? { title: def.title, companyContext: def.company_context, ticket: def.ticket }
        : null,
      repo: repo ? { url: repo.url, prNumber: repo.prNumber } : null,
      pmIntro: pmIntro ?? null,
      latestSubmission,
      latestReview,
    };
  }
}
