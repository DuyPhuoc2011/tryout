import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { ScenarioRunsModule } from '../scenario-runs/scenario-runs.module';
import { IntakeController } from './intake.controller';
import { IntakeService } from './intake.service';
import { ScenarioMatcherService } from './scenario-matcher.service';

@Module({
  imports: [AuthModule, LlmModule, ScenarioRunsModule],
  controllers: [IntakeController],
  providers: [IntakeService, ScenarioMatcherService],
})
export class IntakeModule {}
