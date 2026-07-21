import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';
import { EntitlementService } from '../entitlement/entitlement.service';
import {
  ARENA_CREATE_LOCK_KEY,
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
  // randomInt rejection-samples internally, so every character of the
  // 36-symbol alphabet is equally likely (a plain `randomBytes()[i] % 36`
  // would skew 4 of the 36 characters ~14% high, since 256 isn't a multiple
  // of 36). Not a security requirement — the slug is a GCP resource name,
  // not a capability token — but there is no reason to leave the bias in.
  let body = '';
  for (let i = 0; i < SLUG_BODY_LENGTH; i += 1) {
    body += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  }
  return `env-${body}`;
}

/** True for a raw Postgres unique_violation (23505). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
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
   * Entitlement is checked before any quota read (and before the advisory
   * lock below is taken), so an unentitled caller can never learn how much
   * capacity is in use and can never block a legitimate creator by holding
   * the lock.
   *
   * The quota check, the duplicate check, and the insert all run inside one
   * transaction serialized by a Postgres advisory lock. Without that, this
   * is a classic TOCTOU race: N concurrent callers can all read the same
   * live count, all see it under the cap, and all insert — overshooting
   * MAX_CONCURRENT_ENVIRONMENTS by up to N-1. There is no database
   * constraint backstopping the cap (Postgres has no native "max live rows"
   * constraint), so this transaction is the only thing making the cap real.
   */
  async create(userId: string, listingId: string) {
    await this.entitlement.assertOwnsListing(userId, listingId);

    return this.db.transaction(async (tx) => {
      // Released automatically at transaction end (commit or rollback) —
      // nothing to clean up on the error paths below.
      await tx.execute(sql`select pg_advisory_xact_lock(${ARENA_CREATE_LOCK_KEY})`);

      const [live] = await tx
        .select({ count: count() })
        .from(schema.arenaEnvironments)
        .where(inArray(schema.arenaEnvironments.status, [...LIVE_ENVIRONMENT_STATUSES]));

      const liveCount = Number(live?.count);
      if (!Number.isFinite(liveCount) || liveCount >= MAX_CONCURRENT_ENVIRONMENTS) {
        // Explicit refusal, never a silent stall — the lesson of this
        // project's own F09 incident, where queued work vanished with no
        // signal. A missing or non-numeric count fails CLOSED (refuses) —
        // it must never be read as "the arena is empty" on a spend ceiling.
        throw new ServiceUnavailableException(
          'The arena is at capacity. Try again shortly.',
        );
      }

      const [existing] = await tx
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

      try {
        const [created] = await tx
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
      } catch (err) {
        // Backstop for the same-user-same-listing duplicate: the advisory
        // lock above already closes this race in practice, but a raw 23505
        // must still surface as a friendly 409 rather than Nest's generic
        // 500 (e.g. a client double-click racing two requests through here).
        if (isUniqueViolation(err)) {
          throw new ConflictException('You already have an environment for this scenario');
        }
        throw err;
      }
    });
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
