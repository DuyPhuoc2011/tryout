import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, eq, gte, ne, sql } from 'drizzle-orm';
import { schema, type Db } from '@tryout/db';
import { parseDesign, renderTfvars } from '@tryout/arena';
import { DRIZZLE } from '../db/db.module';
import { ARENA_TURN_LOCK_NAMESPACE, MAX_TURNS_PER_HOUR } from './arena.constants';

const ONE_HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class TurnsService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Validate a buyer's design.yaml and, if it passes, queue a real
   * `terraform apply`.
   *
   * Ownership is checked by scoping the environment lookup to
   * (id, userId) — not via EntitlementService. Owning the environment
   * already proves entitlement was checked at creation time
   * (EnvironmentsService.create()). A miss returns NotFoundException, never
   * ForbiddenException: a 403 would confirm to the caller that some OTHER
   * user's environment exists at this id, which is exactly the information a
   * 404 must not leak.
   *
   * Validation failures are stored and returned as ordinary data, never
   * thrown: parseDesign never throws, and a rejected turn is a legitimate,
   * buyer-readable outcome, not an error condition.
   */
  async submit(userId: string, environmentId: string, rawDesign: string) {
    const [environment] = await this.db
      .select({ id: schema.arenaEnvironments.id, envSlug: schema.arenaEnvironments.envSlug })
      .from(schema.arenaEnvironments)
      .where(
        and(
          eq(schema.arenaEnvironments.id, environmentId),
          eq(schema.arenaEnvironments.userId, userId),
        ),
      )
      .limit(1);

    if (!environment) {
      throw new NotFoundException('Environment not found');
    }

    const parsed = parseDesign(rawDesign);

    if (!parsed.ok) {
      // Rejected turns are not rate limited — validation costs nothing, only
      // an accepted apply costs money — and must never contend on the
      // per-environment advisory lock below, which exists solely to
      // serialize the accepted path against itself.
      const [turn] = await this.db
        .insert(schema.arenaTurns)
        .values({
          environmentId: environment.id,
          status: 'rejected',
          parseErrors: parsed.errors,
          tfvars: null,
        })
        .returning();

      return turn;
    }

    // Accepted path only: every turn here becomes a real `terraform apply`
    // that costs money, so the rate-limit count-check and the insert run
    // inside one transaction serialized by a per-environment advisory lock —
    // the same TOCTOU fix environments.service.ts applies to
    // MAX_CONCURRENT_ENVIRONMENTS. Without it, N concurrent accepted submits
    // for the same environment could all read a count under the limit and
    // all insert, overshooting MAX_TURNS_PER_HOUR by up to N-1.
    //
    // A single global lock (like ARENA_CREATE_LOCK_KEY) would be wrong here:
    // it would serialize every buyer's submissions against every other
    // buyer's, even though MAX_TURNS_PER_HOUR is scoped per environment. The
    // two-integer advisory lock form keyed on hashtext(environmentId) gives
    // each environment its own effective lock instead.
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${ARENA_TURN_LOCK_NAMESPACE}, hashtext(${environment.id}::text))`,
      );

      const oneHourAgo = new Date(Date.now() - ONE_HOUR_MS);
      const [recent] = await tx
        .select({ count: count() })
        .from(schema.arenaTurns)
        .where(
          and(
            eq(schema.arenaTurns.environmentId, environment.id),
            gte(schema.arenaTurns.createdAt, oneHourAgo),
            // Rejected turns cost nothing and must never eat into the paid
            // apply budget — that's the whole point of not rate-limiting the
            // rejected path above. Excluded via ne(status, 'rejected') rather
            // than an allow-list of "counts toward the cap" statuses: if the
            // enum ever grows a new status, ne() makes it COUNT by default
            // (conservative, fails closed on a spend limit) instead of
            // silently escaping the limit the way an allow-list would.
            ne(schema.arenaTurns.status, 'rejected'),
          ),
        );

      const recentCount = Number(recent?.count);
      // Fails CLOSED (refuses) on a missing or non-numeric count, mirroring
      // environments.service.ts's own quota check: a bare COUNT(*) always
      // returns one row in practice, but a spend ceiling must never be read
      // as "no turns yet" on a shape it doesn't recognize.
      if (!Number.isFinite(recentCount) || recentCount >= MAX_TURNS_PER_HOUR) {
        throw new HttpException(
          `Rate limit exceeded: at most ${MAX_TURNS_PER_HOUR} turns per hour per environment`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const tfvars = renderTfvars(parsed.design, environment.envSlug);

      // Inserted as 'submitted' — the enum's own default — not 'applying'.
      // A runner (not yet built) is the one that flips submitted -> applying
      // when it actually starts `terraform apply`; writing 'applying' here
      // would erase that distinction and leave a runner with no way to tell
      // "queued, not started" from "mid-apply right now". 'submitted' still
      // counts toward MAX_TURNS_PER_HOUR (it isn't 'rejected'), which is
      // correct: a queued apply is already committed spend.
      const [turn] = await tx
        .insert(schema.arenaTurns)
        .values({
          environmentId: environment.id,
          status: 'submitted',
          parseErrors: null,
          tfvars,
        })
        .returning();

      return turn;
    });
  }
}
