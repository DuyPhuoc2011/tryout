import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, lt, ne, sql } from 'drizzle-orm';
import { parseTfvars, sanitizeText } from '@tryout/arena';
import { schema, type Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';
import { TERRAFORM_EXECUTOR, type TerraformExecutor } from './terraform-executor';

/** How many expired environments one reap tick may destroy. */
const REAP_BATCH_SIZE = 5;

/** Failure text is stored and later shown to a buyer, so it is bounded. */
const MAX_FAILURE_LENGTH = 2000;

interface ClaimedTurn {
  turnId: string;
  environmentId: string;
  envSlug: string;
  tfvars: unknown;
}

@Injectable()
export class RunnerService {
  private readonly logger = new Logger(RunnerService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(TERRAFORM_EXECUTOR) private readonly terraform: TerraformExecutor,
  ) {}

  /**
   * Claim and apply at most one turn.
   *
   * One turn per invocation is the concurrency control: an apply is minutes
   * long and costs money, so a job that takes exactly one row is both bounded
   * in spend and safe to run in parallel with itself. Scaling is Cloud Run
   * Jobs' `parallelism`, not an in-process queue.
   */
  async applyOnce(): Promise<'applied' | 'apply_failed' | 'idle'> {
    const claimed = await this.claimTurn();
    if (!claimed) {
      return 'idle';
    }

    // Re-validate on the read side. renderTfvars guaranteed this shape when
    // the row was written, so a failure here means the row was changed by
    // something other than the API — a migration, a manual UPDATE, a restored
    // backup — and these values are about to become arguments to a command
    // that creates billable infrastructure. Refuse rather than apply a shape
    // nobody validated.
    const parsed = parseTfvars(claimed.tfvars);
    if (!parsed.ok) {
      const detail = parsed.errors.map((error) => `${error.path}: ${error.message}`).join('; ');
      await this.recordFailure(claimed, `stored tfvars are invalid — ${detail}`);
      return 'apply_failed';
    }

    if (parsed.tfvars.environment_id !== claimed.envSlug) {
      // The state prefix is derived from the slug, so a mismatch would apply
      // one environment's design into another's state file.
      await this.recordFailure(claimed, 'stored tfvars do not match the environment slug');
      return 'apply_failed';
    }

    const result = await this.terraform.apply(parsed.tfvars);

    if (!result.ok) {
      await this.recordFailure(claimed, result.message);
      return 'apply_failed';
    }

    await this.recordSuccess(claimed);
    return 'applied';
  }

  /**
   * Destroy environments past their TTL.
   *
   * Bounded per tick so one slow destroy cannot monopolize the run, and the
   * row is marked `destroyed` only after Terraform reports success — an
   * environment marked destroyed while its resources still bill is the one
   * outcome this milestone must never produce.
   */
  async reapExpired(): Promise<{ destroyed: number; failed: number }> {
    const expired = await this.db
      .select({
        id: schema.arenaEnvironments.id,
        envSlug: schema.arenaEnvironments.envSlug,
      })
      .from(schema.arenaEnvironments)
      .where(
        and(
          ne(schema.arenaEnvironments.status, 'destroyed'),
          lt(schema.arenaEnvironments.ttlExpiresAt, new Date()),
          // Never tear down underneath an apply that is mid-flight: both would
          // be holding the same Terraform state lock, and the loser leaves the
          // environment in an unknown state.
          sql`not exists (
            select 1 from ${schema.arenaTurns}
            where ${schema.arenaTurns.environmentId} = ${schema.arenaEnvironments.id}
              and ${schema.arenaTurns.status} = 'applying'
          )`,
        ),
      )
      .orderBy(asc(schema.arenaEnvironments.ttlExpiresAt))
      .limit(REAP_BATCH_SIZE);

    let destroyed = 0;
    let failed = 0;

    for (const environment of expired) {
      const result = await this.terraform.destroy(environment.envSlug);

      if (!result.ok) {
        // Left live on purpose: the next tick retries. A failed destroy that
        // marked the row destroyed would leak billable resources silently,
        // which is this project's own F09 lesson in a different costume.
        failed += 1;
        this.logger.error(
          `destroy failed for ${environment.envSlug}: ${sanitizeText(result.message)}`,
        );
        continue;
      }

      await this.db
        .update(schema.arenaEnvironments)
        .set({ status: 'destroyed', updatedAt: new Date() })
        .where(eq(schema.arenaEnvironments.id, environment.id));

      destroyed += 1;
    }

    return { destroyed, failed };
  }

  /**
   * Take the oldest submitted turn, or nothing.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes concurrent runners safe: a second
   * runner walks past the locked row instead of blocking on it or claiming it
   * twice. The status flip happens inside the same transaction, so the lock
   * never has to outlive it.
   */
  private async claimTurn(): Promise<ClaimedTurn | null> {
    return this.db.transaction(async (tx) => {
      const [turn] = await tx
        .select({
          id: schema.arenaTurns.id,
          environmentId: schema.arenaTurns.environmentId,
          tfvars: schema.arenaTurns.tfvars,
        })
        .from(schema.arenaTurns)
        .where(eq(schema.arenaTurns.status, 'submitted'))
        .orderBy(asc(schema.arenaTurns.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });

      if (!turn) {
        return null;
      }

      const [environment] = await tx
        .select({
          id: schema.arenaEnvironments.id,
          envSlug: schema.arenaEnvironments.envSlug,
          status: schema.arenaEnvironments.status,
        })
        .from(schema.arenaEnvironments)
        .where(eq(schema.arenaEnvironments.id, turn.environmentId))
        .limit(1);

      if (!environment) {
        // Impossible through the FK, but the alternative to handling it is
        // applying with no slug to derive a state prefix from.
        return null;
      }

      // Guarded in the WHERE clause, not just by the SELECT above: a status
      // machine that is enforced only by the code path that read it is not
      // enforced. updatedAt is set explicitly on every UPDATE in this file —
      // Drizzle's defaultNow() fires on INSERT only, and there is no trigger.
      await tx
        .update(schema.arenaTurns)
        .set({ status: 'applying', updatedAt: new Date() })
        .where(and(eq(schema.arenaTurns.id, turn.id), eq(schema.arenaTurns.status, 'submitted')));

      if (environment.status === 'pending') {
        await tx
          .update(schema.arenaEnvironments)
          .set({ status: 'provisioning', updatedAt: new Date() })
          .where(
            and(
              eq(schema.arenaEnvironments.id, environment.id),
              eq(schema.arenaEnvironments.status, 'pending'),
            ),
          );
      }

      return {
        turnId: turn.id,
        environmentId: environment.id,
        envSlug: environment.envSlug,
        tfvars: turn.tfvars,
      };
    });
  }

  private async recordSuccess(claimed: ClaimedTurn): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.arenaTurns)
        .set({ status: 'applied', updatedAt: new Date() })
        .where(and(eq(schema.arenaTurns.id, claimed.turnId), eq(schema.arenaTurns.status, 'applying')));

      await tx
        .update(schema.arenaEnvironments)
        .set({ status: 'ready', updatedAt: new Date() })
        .where(eq(schema.arenaEnvironments.id, claimed.environmentId));
    });
  }

  /**
   * Terraform stderr is attacker-adjacent: it can echo values derived from a
   * buyer's design, and B4 renders this string onto a page. Sanitized and
   * truncated on the way in, where there is exactly one write site, rather
   * than at every future read site.
   */
  private async recordFailure(claimed: ClaimedTurn, message: string): Promise<void> {
    const safe = sanitizeText(message).slice(0, MAX_FAILURE_LENGTH);

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.arenaTurns)
        .set({
          status: 'apply_failed',
          parseErrors: [{ path: 'terraform', message: safe }],
          updatedAt: new Date(),
        })
        .where(and(eq(schema.arenaTurns.id, claimed.turnId), eq(schema.arenaTurns.status, 'applying')));

      // degraded, not destroyed: a failed apply usually leaves some resources
      // standing, and the reaper still has to tear them down at TTL.
      await tx
        .update(schema.arenaEnvironments)
        .set({ status: 'degraded', updatedAt: new Date() })
        .where(eq(schema.arenaEnvironments.id, claimed.environmentId));
    });
  }
}
