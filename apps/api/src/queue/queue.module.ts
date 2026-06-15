import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from './queue.constants';
import { QueueService } from './queue.service';
import { env } from '../config/env';

function parseRedisUrl(url: string): { host: string; port: number } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
  };
}

@Module({
  imports: [
    BullModule.forRoot({
      connection: parseRedisUrl(env.redisUrl),
    }),
    BullModule.registerQueue({ name: QUEUE_NAMES.POLL_PR }),
    BullModule.registerQueue({ name: QUEUE_NAMES.POLL_CI }),
    BullModule.registerQueue({ name: QUEUE_NAMES.PM_INTRO }),
    BullModule.registerQueue({ name: QUEUE_NAMES.REVIEW }),
  ],
  providers: [QueueService],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
