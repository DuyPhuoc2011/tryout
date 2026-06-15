import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { ScenarioDefinition } from '@tryout/shared';
import type { LlmRouter as Router } from '@tryout/llm';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';

@Injectable()
export class PmService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_ROUTER) private readonly router: Router,
  ) {}

  async generateIntro(scenarioRunId: string) {
    const [run] = await this.db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, scenarioRunId))
      .limit(1);
    if (!run) throw new NotFoundException(`Scenario run ${scenarioRunId} not found.`);

    const [scenario] = await this.db
      .select({ definition: schema.scenarios.definition })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.id, run.scenarioId))
      .limit(1);
    if (!scenario) throw new NotFoundException('Scenario not found.');

    const def = scenario.definition as ScenarioDefinition;
    const c = def.company_context;
    const system = [
      def.agent_prompts.pm_mai.system,
      '',
      `Company: ${c.name}. ${c.product}`,
      `Team: ${c.team}`,
      `The engineer's role: ${c.user_role}`,
      '',
      `Ticket ${def.ticket.id}: ${def.ticket.title}`,
      def.ticket.body,
    ].join('\n');

    const result = await this.router.generate({
      role: 'pm',
      taskComplexity: 'chat',
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content:
            'Write your opening message to the new engineer: welcome them, give brief team/product context, and assign this ticket. Keep it warm but concise, like a Slack message. Do not solve the ticket for them.',
        },
      ],
    });

    const [message] = await this.db
      .insert(schema.agentMessages)
      .values({
        scenarioRunId,
        agentRole: 'pm',
        direction: 'agent',
        content: result.content,
      })
      .returning();

    return message;
  }
}
