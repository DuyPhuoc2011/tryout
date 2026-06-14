import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, PollPrJobData, PollCiJobData } from './queue.constants';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QUEUE_NAMES.POLL_PR) private readonly pollPrQueue: Queue,
    @InjectQueue(QUEUE_NAMES.POLL_CI) private readonly pollCiQueue: Queue,
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
}
