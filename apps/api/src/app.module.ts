import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { ScenarioRunsModule } from './scenario-runs/scenario-runs.module';
import { ScenariosModule } from './scenarios/scenarios.module';
import { AgentsModule } from './agents/agents.module';
import { GradingModule } from './grading/grading.module';
import { IntakeModule } from './intake/intake.module';

@Module({
  imports: [
    DbModule,
    AuthModule,
    ScenariosModule,
    ScenarioRunsModule,
    AgentsModule,
    GradingModule,
    IntakeModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
