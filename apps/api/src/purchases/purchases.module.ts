import { Module } from '@nestjs/common';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { StripeService } from './stripe.service';
import { AuthModule } from '../auth/auth.module';
import { GitHubModule } from '../github/github.module';
import { env } from '../config/env';

@Module({
  imports: [AuthModule, GitHubModule],
  controllers: [PurchasesController],
  providers: [
    PurchasesService,
    {
      provide: StripeService,
      useFactory: () => new StripeService(env.stripeSecretKey(), env.stripeWebhookSecret()),
    },
  ],
})
export class PurchasesModule {}
