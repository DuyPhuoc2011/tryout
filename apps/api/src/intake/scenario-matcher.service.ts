import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { ProfileSnapshot, ScenarioDefinition } from '@tryout/shared';
import type { LlmRouter } from '@tryout/llm';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { RATIONALE_SYSTEM } from './intake.prompts';

export interface MatchResult {
  scenarioId: string;
  role: string;
  rationale: string;
}

@Injectable()
export class ScenarioMatcherService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_ROUTER) private readonly router: LlmRouter,
  ) {}

  async match(profile: ProfileSnapshot): Promise<MatchResult> {
    const [scenario] = await this.db
      .select({ id: schema.scenarios.id, definition: schema.scenarios.definition })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.available, true))
      .limit(1);
    if (!scenario) {
      throw new BadRequestException('No scenarios are available to place you in yet.');
    }

    const def = scenario.definition as ScenarioDefinition;
    const teamKeys = def.team ?? [];
    const roles = await this.db
      .select()
      .from(schema.teamRoles)
      .orderBy(asc(schema.teamRoles.sortOrder));
    const selectable = new Set(
      roles.filter((r) => r.selectableByCandidate).map((r) => r.key),
    );
    const role = teamKeys.find((k) => selectable.has(k));
    if (!role) {
      throw new BadRequestException('Available scenario has no candidate-selectable role.');
    }

    const rationale = await this.writeRationale(profile, def.title);
    return { scenarioId: scenario.id, role, rationale };
  }

  private async writeRationale(profile: ProfileSnapshot, scenarioTitle: string): Promise<string> {
    const summary = [
      `Project: ${scenarioTitle}`,
      `Experience: ${profile.experienceLevel ?? 'unknown'}`,
      `Languages: ${profile.languages.join(', ') || 'unknown'}`,
      `Strengths: ${profile.strengths.join(', ') || 'unknown'}`,
      `Growth areas: ${profile.gaps.join(', ') || 'unknown'}`,
      `Goals: ${profile.goals ?? 'unknown'}`,
    ].join('\n');

    const result = await this.router.generate({
      role: 'recruiter',
      taskComplexity: 'chat',
      messages: [
        { role: 'system', content: RATIONALE_SYSTEM },
        { role: 'user', content: summary },
      ],
    });
    return result.content;
  }
}
