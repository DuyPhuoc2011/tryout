import { Inject, Injectable } from '@nestjs/common';
import { eq, gte, count, avg, desc } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';

// Read-only aggregate over tables we already write. No new event pipeline:
// runs, completion, scores, and scenario popularity are all derivable. This is
// the traction snapshot that backs a Phase-2 (institutions) sales conversation.
@Injectable()
export class MetricsService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async snapshot() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [[users], [runs], [graded], [runs7d], [scores]] = await Promise.all([
      this.db.select({ value: count() }).from(schema.users),
      this.db.select({ value: count() }).from(schema.scenarioRuns),
      this.db.select({ value: count() }).from(schema.scorecards),
      this.db
        .select({ value: count() })
        .from(schema.scenarioRuns)
        .where(gte(schema.scenarioRuns.createdAt, sevenDaysAgo)),
      this.db
        .select({
          technical: avg(schema.scorecards.technicalScore),
          professional: avg(schema.scorecards.professionalScore),
        })
        .from(schema.scorecards),
    ]);

    const runsByStatus = await this.db
      .select({ status: schema.scenarioRuns.status, value: count() })
      .from(schema.scenarioRuns)
      .groupBy(schema.scenarioRuns.status);

    const runsByScenario = await this.db
      .select({ title: schema.scenarios.title, value: count() })
      .from(schema.scenarioRuns)
      .innerJoin(schema.scenarios, eq(schema.scenarioRuns.scenarioId, schema.scenarios.id))
      .groupBy(schema.scenarios.title)
      .orderBy(desc(count()));

    const skillLevels = await this.db
      .select({ level: schema.candidateProfiles.experienceLevel, value: count() })
      .from(schema.candidateProfiles)
      .groupBy(schema.candidateProfiles.experienceLevel);

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        users: users.value,
        runs: runs.value,
        gradedRuns: graded.value,
        runsLast7d: runs7d.value,
      },
      avgScores: {
        technical: round(scores.technical),
        professional: round(scores.professional),
      },
      runsByStatus,
      runsByScenario,
      skillLevels,
    };
  }
}

// pg avg() comes back as a numeric string (or null when there are no rows).
function round(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}
