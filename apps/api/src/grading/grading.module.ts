import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { GitHubModule } from '../github/github.module';
import { QueueModule } from '../queue/queue.module';
import { GradingService } from './grading.service';
import { GradingController } from './grading.controller';
import { GradeProcessor } from './grade.processor';

@Module({
  imports: [AuthModule, LlmModule, GitHubModule, QueueModule],
  controllers: [GradingController],
  providers: [GradingService, GradeProcessor],
  exports: [GradingService],
})
export class GradingModule {}
