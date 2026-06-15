import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, PmIntroJobData } from '../../queue/queue.constants';
import { PmService } from '../pm.service';

@Processor(QUEUE_NAMES.PM_INTRO)
export class PmIntroProcessor extends WorkerHost {
  private readonly logger = new Logger(PmIntroProcessor.name);

  constructor(private readonly pm: PmService) {
    super();
  }

  async process(job: Job<PmIntroJobData>): Promise<void> {
    this.logger.log(`Generating PM intro for run ${job.data.scenarioRunId}`);
    await this.pm.generateIntro(job.data.scenarioRunId);
  }
}
