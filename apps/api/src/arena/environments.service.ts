import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, count, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';
import { EntitlementService } from '../entitlement/entitlement.service';
import {
  ENVIRONMENT_TTL_HOURS,
  LIVE_ENVIRONMENT_STATUSES,
  MAX_CONCURRENT_ENVIRONMENTS,
} from './arena.constants';

/**
 * Slug alphabet and length chosen to satisfy /^env-[a-z0-9]{6,32}$/ — enforced
 * both by renderTfvars in @tryout/arena and by a CHECK constraint on the table.
 */
const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_BODY_LENGTH = 12;

function generateEnvSlug(): string {
  const bytes = randomBytes(SLUG_BODY_LENGTH);
  let body = '';
  for (let i = 0; i < SLUG_BODY_LENGTH; i += 1) {
    body += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return `env-${body}`;
}

@Injectable()
export class EnvironmentsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly entitlement: EntitlementService,
  ) {}

  /**
   * Create the buyer's environment for a scenario they own.
   *
   * Entitlement is checked before any quota read, so an unentitled caller can
   * never learn how much capacity is in use.
   */
  async create(userId: string, listingId: string) {
    await this.entitlement.assertOwnsListing(userId, listingId);

    const [live] = await this.db
      .select({ count: count() })
      .from(schema.arenaEnvironments)
      .where(inArray(schema.arenaEnvironments.status, [...LIVE_ENVIRONMENT_STATUSES]));

    if (Number(live?.count ?? 0) >= MAX_CONCURRENT_ENVIRONMENTS) {
      // Explicit refusal, never a silent stall — the lesson of this project's
      // own F09 incident, where queued work vanished with no signal.
      throw new ServiceUnavailableException(
        'The arena is at capacity. Try again shortly.',
      );
    }

    const [existing] = await this.db
      .select({ id: schema.arenaEnvironments.id })
      .from(schema.arenaEnvironments)
      .where(
        and(
          eq(schema.arenaEnvironments.userId, userId),
          eq(schema.arenaEnvironments.listingId, listingId),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictException('You already have an environment for this scenario');
    }

    const ttlExpiresAt = new Date(Date.now() + ENVIRONMENT_TTL_HOURS * 60 * 60 * 1000);

    const [created] = await this.db
      .insert(schema.arenaEnvironments)
      .values({
        userId,
        listingId,
        envSlug: generateEnvSlug(),
        status: 'pending',
        ttlExpiresAt,
      })
      .returning();

    return created;
  }

  /** The caller's own environments. Never exposes another buyer's. */
  async mine(userId: string) {
    return this.db
      .select({
        id: schema.arenaEnvironments.id,
        listingId: schema.arenaEnvironments.listingId,
        envSlug: schema.arenaEnvironments.envSlug,
        status: schema.arenaEnvironments.status,
        ttlExpiresAt: schema.arenaEnvironments.ttlExpiresAt,
        createdAt: schema.arenaEnvironments.createdAt,
      })
      .from(schema.arenaEnvironments)
      .where(eq(schema.arenaEnvironments.userId, userId));
  }
}
