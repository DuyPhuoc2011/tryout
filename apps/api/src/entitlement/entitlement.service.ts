import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';

/**
 * Purchase statuses that grant scenario access.
 *
 * Typed against the real Drizzle enum (not a bare string[]) so a typo here
 * is a compile error, not a silently-wrong allow-list. See
 * `packages/db/src/schema.ts` -> `purchaseStatusEnum`.
 *
 * `invite_failed` entitles deliberately: the GitHub invite failing is our
 * fault, not the buyer's, and they have already paid.
 */
const ENTITLED_STATUSES: (typeof schema.purchaseStatusEnum.enumValues)[number][] = [
  'paid',
  'invite_sent',
  'invite_failed',
];

/**
 * Single source of truth for "does this user own this scenario". Both the
 * tutor and the arena spend real resources (LLM calls, GCP infra) on a
 * user's behalf, so they must agree on this rule — not maintain two
 * independently-drifting copies of it.
 */
@Injectable()
export class EntitlementService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Throw unless the user holds an entitling purchase for the listing. */
  async assertOwnsListing(userId: string, listingId: string): Promise<void> {
    const [purchase] = await this.db
      .select({ id: schema.purchases.id })
      .from(schema.purchases)
      .where(
        and(
          eq(schema.purchases.userId, userId),
          eq(schema.purchases.listingId, listingId),
          inArray(schema.purchases.status, ENTITLED_STATUSES),
        ),
      )
      .limit(1);

    if (!purchase) {
      // Deliberately identical for "no purchase" and "unentitled purchase":
      // the response must not reveal which listings a stranger has bought.
      throw new ForbiddenException('You do not own this scenario');
    }
  }
}
