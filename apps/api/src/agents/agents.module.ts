import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { GitHubModule } from '../github/github.module';
import { QueueModule } from '../queue/queue.module';
import { PmService } from './pm.service';
import { SeniorReviewService } from './senior-review.service';
import { PmIntroProcessor } from './processors/pm-intro.processor';
import { ReviewProcessor } from './processors/review.processor';

@Module({
  imports: [LlmModule, GitHubModule, QueueModule],
  providers: [PmService, SeniorReviewService, PmIntroProcessor, ReviewProcessor],
  exports: [PmService, SeniorReviewService],
})
export class AgentsModule {}
