import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { CatalogModule } from './catalog/catalog.module';
import { PurchasesModule } from './purchases/purchases.module';
import { TutorModule } from './tutor/tutor.module';
import { ArenaModule } from './arena/arena.module';

@Module({
  imports: [DbModule, AuthModule, CatalogModule, PurchasesModule, TutorModule, ArenaModule],
  controllers: [HealthController],
})
export class AppModule {}
