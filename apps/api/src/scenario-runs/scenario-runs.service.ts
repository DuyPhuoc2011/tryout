import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
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

    return {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      repo: repo ? { url: repo.url, prNumber: repo.prNumber } : null,
      latestSubmission: submissions[0] ?? null,
    };
  }
}
