import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type {
  ProjectType,
  ScenarioCatalogItem,
  ScenarioDefinition,
  ScenarioDetailView,
  TeamSeatView,
} from '@tryout/shared';
import { DRIZZLE } from '../db/db.module';

type ScenarioRow = typeof schema.scenarios.$inferSelect;
type TeamRoleRow = typeof schema.teamRoles.$inferSelect;

@Injectable()
export class ScenariosService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** The catalog: every scenario as a card, ordered by availability then title. */
  async list(): Promise<ScenarioCatalogItem[]> {
    const rows = await this.db
      .select()
      .from(schema.scenarios)
      .orderBy(asc(schema.scenarios.title));
    return rows
      .map((row) => this.toCatalogItem(row))
      .sort((a, b) => Number(b.available) - Number(a.available));
  }

  /** A single scenario with its resolved team roster. */
  async detail(id: string): Promise<ScenarioDetailView> {
    const [row] = await this.db
      .select()
      .from(schema.scenarios)
      .where(eq(schema.scenarios.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException(`Scenario ${id} not found.`);
    }

    const roles = await this.db
      .select()
      .from(schema.teamRoles)
      .orderBy(asc(schema.teamRoles.sortOrder));
    const byKey = new Map(roles.map((r) => [r.key, r]));

    const def = row.definition as ScenarioDefinition;
    const teamKeys = def.team ?? [];
    const team: TeamSeatView[] = teamKeys
      .map((key) => byKey.get(key))
      .filter((r): r is TeamRoleRow => Boolean(r))
      .map((r) => ({
        key: r.key,
        title: r.title,
        description: r.description,
        category: r.category,
        aiName: r.aiName,
        aiInitial: r.aiInitial,
        interactive: r.interactive,
        selectable: r.selectableByCandidate,
      }));

    return {
      ...this.toCatalogItem(row),
      team,
      selectableRoles: team.filter((s) => s.selectable).map((s) => s.key),
    };
  }

  private toCatalogItem(row: ScenarioRow): ScenarioCatalogItem {
    const def = row.definition as ScenarioDefinition;
    return {
      id: row.id,
      title: row.title,
      projectType: row.projectType as ProjectType,
      summary: def.catalog?.summary ?? '',
      difficulty: def.catalog?.difficulty ?? 'intro',
      tags: def.catalog?.tags ?? [],
      available: row.available,
      companyName: def.company_context?.name ?? '',
    };
  }
}
