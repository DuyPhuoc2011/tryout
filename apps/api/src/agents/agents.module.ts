import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { GitHubModule } from '../github/github.module';
import { QueueModule } from '../queue/queue.module';
import { PmService } from './pm.service';
import { SeniorReviewService } from './senior-review.service';
import { AgentChatService } from './agent-chat.service';
import { AgentChatController } from './agent-chat.controller';
import { PmIntroProcessor } from './processors/pm-intro.processor';
import { ReviewProcessor } from './processors/review.processor';

@Module({
  imports: [AuthModule, LlmModule, GitHubModule, QueueModule],
  controllers: [AgentChatController],
  providers: [
    PmService,
    SeniorReviewService,
    AgentChatService,
    PmIntroProcessor,
    ReviewProcessor,
  ],
  exports: [PmService, SeniorReviewService, AgentChatService],
})
export class AgentsModule {}
