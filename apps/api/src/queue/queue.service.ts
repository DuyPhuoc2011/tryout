import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  PollPrJobData,
  PollCiJobData,
  PmIntroJobData,
} from './queue.constants';
import type { ReviewJobData } from '../agents/senior-review.service';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QUEUE_NAMES.POLL_PR) private readonly pollPrQueue: Queue,
    @InjectQueue(QUEUE_NAMES.POLL_CI) private readonly pollCiQueue: Queue,
    @InjectQueue(QUEUE_NAMES.PM_INTRO) private readonly pmIntroQueue: Queue,
    @InjectQueue(QUEUE_NAMES.REVIEW) private readonly reviewQueue: Queue,
  ) {}

  async enqueuePollPr(data: PollPrJobData, delayMs: number): Promise<void> {
    await this.pollPrQueue.add('check', data, {
      delay: delayMs,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async enqueuePollCi(data: PollCiJobData, delayMs: number): Promise<void> {
    await this.pollCiQueue.add('check', data, {
      delay: delayMs,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async enqueuePmIntro(data: PmIntroJobData): Promise<void> {
    await this.pmIntroQueue.add('generate', data, {
      attempts: 2,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async enqueueReview(data: ReviewJobData): Promise<void> {
    await this.reviewQueue.add('review', data, {
      attempts: 2,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}
