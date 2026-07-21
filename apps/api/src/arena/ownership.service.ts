import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';

/** Purchase statuses that grant scenario access. */
const ENTITLED_STATUSES = new Set(['paid', 'invite_sent', 'invite_failed']);

@Injectable()
export class OwnershipService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Throw unless the user holds an entitling purchase for the listing.
   *
   * `invite_failed` entitles deliberately: the GitHub invite failing is our
   * fault, not the buyer's, and they have already paid.
   */
  async assertOwnsListing(userId: string, listingId: string): Promise<void> {
    const [purchase] = await this.db
      .select({ id: schema.purchases.id, status: schema.purchases.status })
      .from(schema.purchases)
      .where(
        and(
          eq(schema.purchases.userId, userId),
          eq(schema.purchases.listingId, listingId),
        ),
      )
      .limit(1);

    if (!purchase || !ENTITLED_STATUSES.has(purchase.status)) {
      // Deliberately identical for "no purchase" and "unentitled purchase":
      // the response must not reveal which listings a stranger has bought.
      throw new ForbiddenException('You do not own this scenario');
    }
  }
}
