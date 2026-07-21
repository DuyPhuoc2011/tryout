import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { ArenaController } from './arena.controller';
import { EnvironmentsService } from './environments.service';
import { TurnsService } from './turns.service';

@Module({
  imports: [AuthModule, EntitlementModule],
  controllers: [ArenaController],
  providers: [EnvironmentsService, TurnsService],
})
export class ArenaModule {}
