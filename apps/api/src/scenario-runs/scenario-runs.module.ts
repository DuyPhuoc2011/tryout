import { Module } from '@nestjs/common';
import { ScenarioRunsController } from './scenario-runs.controller';
import { ScenarioRunsService } from './scenario-runs.service';
import { AuthModule } from '../auth/auth.module';
import { GitHubModule } from '../github/github.module';
import { QueueModule } from '../queue/queue.module';
import { PollPrProcessor } from '../queue/processors/poll-pr.processor';
import { PollCiProcessor } from '../queue/processors/poll-ci.processor';

@Module({
  imports: [AuthModule, GitHubModule, QueueModule],
  controllers: [ScenarioRunsController],
  providers: [ScenarioRunsService, PollPrProcessor, PollCiProcessor],
})
export class ScenarioRunsModule {}
