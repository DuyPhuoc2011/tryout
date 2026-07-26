import { Module } from '@nestjs/common';
import { TutorController } from './tutor.controller';
import { TutorService } from './tutor.service';
import { TutorAgentClient } from './tutor-agent.client';
import { AuthModule } from '../auth/auth.module';
import { EntitlementModule } from '../entitlement/entitlement.module';

@Module({
  imports: [AuthModule, EntitlementModule],
  controllers: [TutorController],
  providers: [TutorService, TutorAgentClient],
})
export class TutorModule {}
