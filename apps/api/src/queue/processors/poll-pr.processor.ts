import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import { DRIZZLE } from '../../db/db.module';
import { GitHubService } from '../../github/github.service';
import { QueueService } from '../queue.service';
import { QUEUE_NAMES, PollPrJobData } from '../queue.constants';
import { env } from '../../config/env';

// Bounded long-poll. Watches the candidate's PR for each new head commit so that
// fixes pushed after a review flow back through CI → review (retry-to-learn).
// ponytail: bounded by pollMaxAttempts; no webhook. Add a GitHub webhook if poll
// latency or API budget ever bites.
@Processor(QUEUE_NAMES.POLL_PR)
export class PollPrProcessor extends WorkerHost {
  private readonly logger = new Logger(PollPrProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly github: GitHubService,
    private readonly queue: QueueService,
  ) {
    super();
  }

  async process(job: Job<PollPrJobData>): Promise<void> {
    const { scenarioRunId, repoOwner, repoName, attemptCount } = job.data;

    if (attemptCount >= env.pollMaxAttempts) {
      this.logger.warn(`poll-pr max attempts reached for run ${scenarioRunId}`);
      return;
    }

    const prs = await this.github.listOpenPullRequests(repoOwner, repoName);
    const pr = prs[0];

    if (pr) {
      const existing = await this.db
        .select({ id: schema.submissions.id })
        .from(schema.submissions)
        .where(
          and(
            eq(schema.submissions.scenarioRunId, scenarioRunId),
            eq(schema.submissions.headSha, pr.headSha),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        this.logger.log(`New commit ${pr.headSha} on PR #${pr.number} for run ${scenarioRunId}`);
        const [submission] = await this.db
          .insert(schema.submissions)
          .values({
            scenarioRunId,
            prUrl: pr.htmlUrl,
            headSha: pr.headSha,
            ciStatus: 'pending',
          })
          .returning();

        await this.queue.enqueuePollCi(
          {
            submissionId: submission.id,
            repoOwner,
            repoName,
            prNumber: pr.number,
            headSha: pr.headSha,
            attemptCount: 0,
          },
          env.pollCiIntervalMs,
        );
      }
    }

    // Keep watching for the next commit until the attempt ceiling.
    await this.queue.enqueuePollPr(
      { scenarioRunId, repoOwner, repoName, attemptCount: attemptCount + 1 },
      env.pollPrIntervalMs,
    );
  }
}
