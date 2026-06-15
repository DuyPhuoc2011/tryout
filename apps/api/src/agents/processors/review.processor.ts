import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { SeniorReviewService, type ReviewJobData } from '../senior-review.service';

@Processor(QUEUE_NAMES.REVIEW)
export class ReviewProcessor extends WorkerHost {
  private readonly logger = new Logger(ReviewProcessor.name);

  constructor(private readonly senior: SeniorReviewService) {
    super();
  }

  async process(job: Job<ReviewJobData>): Promise<void> {
    this.logger.log(`Reviewing submission ${job.data.submissionId}`);
    await this.senior.reviewSubmission(job.data);
  }
}
