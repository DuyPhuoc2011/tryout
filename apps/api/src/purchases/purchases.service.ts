import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';
import { GitHubService } from '../github/github.service';
import { StripeService } from './stripe.service';
import { env } from '../config/env';

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly stripe: StripeService,
    private readonly github: GitHubService,
  ) {}

  async checkout(
    userId: string,
    listingId: string,
    githubUsername?: string,
  ): Promise<{ url: string }> {
    const [listing] = await this.db
      .select()
      .from(schema.scenarioListings)
      .where(
        and(
          eq(schema.scenarioListings.id, listingId),
          eq(schema.scenarioListings.status, 'published'),
        ),
      )
      .limit(1);
    if (!listing) throw new NotFoundException('Listing not found');

    if (githubUsername) {
      await this.db
        .update(schema.users)
        .set({ githubUsername })
        .where(eq(schema.users.id, userId));
    }
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user?.githubUsername) {
      // Sentinel message: the web BuyButton matches on it to prompt for a username.
      throw new BadRequestException('GITHUB_USERNAME_REQUIRED');
    }

    const [existing] = await this.db
      .select()
      .from(schema.purchases)
      .where(
        and(eq(schema.purchases.userId, userId), eq(schema.purchases.listingId, listingId)),
      )
      .limit(1);
    if (existing && existing.status !== 'pending') {
      throw new ConflictException('Already purchased');
    }

    let purchaseId: string;
    if (existing) {
      purchaseId = existing.id; // abandoned checkout: reuse the pending row
      if (existing.stripeSessionId) {
        // The old session may still be payable — expire it so the buyer can
        // never complete two sessions for one purchase (double charge).
        try {
          await this.stripe.expireCheckoutSession(existing.stripeSessionId);
        } catch (err) {
          // Already expired/completed is fine; fulfilment is status-guarded.
          this.logger.warn(
            `Could not expire stale session ${existing.stripeSessionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else {
      const [created] = await this.db
        .insert(schema.purchases)
        // Concurrent duplicate insert hits the unique(user_id, listing_id)
        // constraint and 500s — accepted at MVP: the loser fails BEFORE any
        // Stripe session exists, so no money risk; the buyer just retries.
        .values({ userId, listingId, amountCents: listing.priceCents })
        .returning();
      purchaseId = created.id;
    }

    const session = await this.stripe.createCheckoutSession({
      purchaseId,
      title: listing.title,
      amountCents: listing.priceCents,
      currency: listing.currency,
      successUrl: `${env.webBaseUrl}/purchase/success`,
      cancelUrl: `${env.webBaseUrl}/purchase/cancelled`,
    });
    await this.db
      .update(schema.purchases)
      .set({ stripeSessionId: session.id, amountCents: listing.priceCents })
      .where(eq(schema.purchases.id, purchaseId));

    return { url: session.url };
  }
}
