import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, GradeJobData } from '../queue/queue.constants';
import { GradingService } from './grading.service';

@Processor(QUEUE_NAMES.GRADE)
export class GradeProcessor extends WorkerHost {
  private readonly logger = new Logger(GradeProcessor.name);

  constructor(private readonly grading: GradingService) {
    super();
  }

  async process(job: Job<GradeJobData>): Promise<void> {
    this.logger.log(`Grading run ${job.data.scenarioRunId}`);
    await this.grading.gradeRun(job.data.scenarioRunId);
  }
}
