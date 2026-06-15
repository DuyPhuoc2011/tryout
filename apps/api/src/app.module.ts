import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { ScenarioRunsModule } from './scenario-runs/scenario-runs.module';
import { AgentsModule } from './agents/agents.module';
import { GradingModule } from './grading/grading.module';

@Module({
  imports: [DbModule, AuthModule, ScenarioRunsModule, AgentsModule, GradingModule],
  controllers: [HealthController],
})
export class AppModule {}
