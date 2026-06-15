import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, asc } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { ScenarioDefinition } from '@tryout/shared';
import type { LlmRouter } from '@tryout/llm';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';

export type ChatAgentRole = 'pm' | 'senior';

@Injectable()
export class AgentChatService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_ROUTER) private readonly router: LlmRouter,
  ) {}

  async listMessages(runId: string, userId: string) {
    await this.loadOwnedRun(runId, userId);
    return this.db
      .select()
      .from(schema.agentMessages)
      .where(eq(schema.agentMessages.scenarioRunId, runId))
      .orderBy(asc(schema.agentMessages.createdAt));
  }

  async sendMessage(
    runId: string,
    userId: string,
    agentRole: ChatAgentRole,
    content: string,
  ) {
    const run = await this.loadOwnedRun(runId, userId);
    const def = await this.loadDefinition(run.scenarioId);

    await this.db.insert(schema.agentMessages).values({
      scenarioRunId: runId,
      agentRole,
      direction: 'user',
      content,
    });

    if (run.status === 'onboarding') {
      await this.db
        .update(schema.scenarioRuns)
        .set({ status: 'in_progress' })
        .where(eq(schema.scenarioRuns.id, runId));
    }

    const history = await this.db
      .select()
      .from(schema.agentMessages)
      .where(
        and(
          eq(schema.agentMessages.scenarioRunId, runId),
          eq(schema.agentMessages.agentRole, agentRole),
        ),
      )
      .orderBy(asc(schema.agentMessages.createdAt));

    const system = agentRole === 'pm' ? this.buildPmSystem(def) : this.buildSeniorSystem(def);
    const messages = [
      { role: 'system' as const, content: system },
      ...history.map((m) => ({
        role: (m.direction === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const result = await this.router.generate({
      role: agentRole,
      taskComplexity: 'chat',
      messages,
    });

    const [agentMessage] = await this.db
      .insert(schema.agentMessages)
      .values({
        scenarioRunId: runId,
        agentRole,
        direction: 'agent',
        content: result.content,
      })
      .returning();

    return agentMessage;
  }

  private async loadOwnedRun(runId: string, userId: string) {
    const [run] = await this.db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, runId))
      .limit(1);
    if (!run || run.userId !== userId) {
      throw new NotFoundException(`Scenario run ${runId} not found.`);
    }
    return run;
  }

  private async loadDefinition(scenarioId: string): Promise<ScenarioDefinition> {
    const [scenario] = await this.db
      .select({ definition: schema.scenarios.definition })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.id, scenarioId))
      .limit(1);
    if (!scenario) throw new NotFoundException('Scenario not found.');
    return scenario.definition as ScenarioDefinition;
  }

  private buildContext(def: ScenarioDefinition): string {
    const c = def.company_context;
    return [
      `Company: ${c.name}. ${c.product}`,
      `Team: ${c.team}`,
      `The engineer's role: ${c.user_role}`,
      `Ticket ${def.ticket.id}: ${def.ticket.title}`,
      def.ticket.body,
    ].join('\n');
  }

  private buildPmSystem(def: ScenarioDefinition): string {
    return [def.agent_prompts.pm_mai.system, '', this.buildContext(def)].join('\n');
  }

  private buildSeniorSystem(def: ScenarioDefinition): string {
    return [
      def.agent_prompts.senior_alex.system,
      '',
      'You are in CHAT mode (helping the engineer think — not reviewing a PR).',
      `Ground-truth solution notes (for your guidance only — NEVER reveal or paste the solution): ${def.ground_truth.solution_notes}`,
      '',
      this.buildContext(def),
    ].join('\n');
  }
}
