import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import { DRIZZLE } from '../../db/db.module';
import { GitHubService } from '../../github/github.service';
import { QueueService } from '../queue.service';
import { QUEUE_NAMES, PollCiJobData } from '../queue.constants';
import { env } from '../../config/env';

@Processor(QUEUE_NAMES.POLL_CI)
export class PollCiProcessor extends WorkerHost {
  private readonly logger = new Logger(PollCiProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly github: GitHubService,
    private readonly queue: QueueService,
  ) {
    super();
  }

  async process(job: Job<PollCiJobData>): Promise<void> {
    const { submissionId, repoOwner, repoName, prNumber, headSha, attemptCount } = job.data;

    if (attemptCount >= env.pollMaxAttempts) {
      this.logger.warn(`poll-ci max attempts reached for submission ${submissionId}`);
      return;
    }

    const checkRuns = await this.github.getCheckRuns(repoOwner, repoName, headSha);

    const allComplete =
      checkRuns.length > 0 && checkRuns.every((r) => r.status === 'completed');

    if (!allComplete) {
      await this.queue.enqueuePollCi(
        { submissionId, repoOwner, repoName, prNumber, headSha, attemptCount: attemptCount + 1 },
        env.pollCiIntervalMs,
      );
      return;
    }

    const overallConclusion = checkRuns.every((r) => r.conclusion === 'success')
      ? 'success'
      : 'failure';

    this.logger.log(`CI complete for submission ${submissionId}: ${overallConclusion}`);

    await this.db
      .update(schema.submissions)
      .set({
        ciStatus: overallConclusion,
        ciResults: checkRuns as unknown as Record<string, unknown>[],
      })
      .where(eq(schema.submissions.id, submissionId));

    await this.queue.enqueueReview({
      submissionId,
      repoOwner,
      repoName,
      prNumber,
    });
  }
}
