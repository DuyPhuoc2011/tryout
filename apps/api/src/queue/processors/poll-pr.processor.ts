import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import { DRIZZLE } from '../../db/db.module';
import { GitHubService } from '../../github/github.service';
import { QueueService } from '../queue.service';
import { QUEUE_NAMES, PollPrJobData } from '../queue.constants';
import { env } from '../../config/env';

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

    if (prs.length === 0) {
      await this.queue.enqueuePollPr(
        { scenarioRunId, repoOwner, repoName, attemptCount: attemptCount + 1 },
        env.pollPrIntervalMs,
      );
      return;
    }

    const pr = prs[0];
    this.logger.log(`PR #${pr.number} found for run ${scenarioRunId}`);

    const [submission] = await this.db
      .insert(schema.submissions)
      .values({
        scenarioRunId,
        prUrl: pr.htmlUrl,
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
