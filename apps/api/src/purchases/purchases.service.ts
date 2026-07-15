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

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event;
    try {
      event = this.stripe.constructEvent(rawBody, signature);
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }
    if (event.type !== 'checkout.session.completed') return;
    const session = event.data.object as { metadata?: { purchaseId?: string } };
    const purchaseId = session.metadata?.purchaseId;
    if (!purchaseId) return;
    await this.fulfil(purchaseId);
  }

  /**
   * pending → paid → invite_sent|invite_failed. The status-guarded UPDATE makes
   * webhook replays no-ops: only the delivery that wins the transition proceeds.
   */
  private async fulfil(purchaseId: string): Promise<void> {
    const [paidRow] = await this.db
      .update(schema.purchases)
      .set({ status: 'paid' })
      .where(and(eq(schema.purchases.id, purchaseId), eq(schema.purchases.status, 'pending')))
      .returning();
    if (!paidRow) return; // replay or unknown id
    await this.invite(paidRow.id, paidRow.userId, paidRow.listingId);
  }

  private async invite(purchaseId: string, userId: string, listingId: string): Promise<void> {
    try {
      const [user] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      const [listing] = await this.db
        .select()
        .from(schema.scenarioListings)
        .where(eq(schema.scenarioListings.id, listingId))
        .limit(1);
      if (!user?.githubUsername || !listing) {
        throw new Error(`purchase ${purchaseId}: missing github username or listing`);
      }
      await this.github.addRepoCollaborator(
        env.githubOwner(),
        listing.contentRepo,
        user.githubUsername,
      );
      await this.db
        .update(schema.purchases)
        .set({ status: 'invite_sent', invitedAt: new Date() })
        .where(eq(schema.purchases.id, purchaseId));
    } catch (err) {
      // Buyer has paid — never throw past this point. Mark for retry and alert
      // via the existing log-based monitoring (message is the alert match key).
      this.logger.error(
        `GITHUB_INVITE_FAILED purchase=${purchaseId}`,
        err instanceof Error ? err.stack : String(err),
      );
      await this.db
        .update(schema.purchases)
        .set({ status: 'invite_failed' })
        .where(eq(schema.purchases.id, purchaseId));
    }
  }
}
