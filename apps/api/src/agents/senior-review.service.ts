import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { ScenarioDefinition } from '@tryout/shared';
import type { LlmRouter } from '@tryout/llm';
import { DRIZZLE } from '../db/db.module';
import { LLM_ROUTER } from '../llm/llm.module';
import { GitHubService, type ReviewEvent } from '../github/github.service';

export interface ReviewJobData {
  submissionId: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
}

interface ParsedReview {
  summary: string;
  comments: string[];
  verdict: 'approve' | 'request_changes';
}

const MAX_DIFF_CHARS = 12_000;

@Injectable()
export class SeniorReviewService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_ROUTER) private readonly router: LlmRouter,
    private readonly github: GitHubService,
  ) {}

  async reviewSubmission(data: ReviewJobData): Promise<void> {
    const { submissionId, repoOwner, repoName, prNumber } = data;

    const [submission] = await this.db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.id, submissionId))
      .limit(1);
    if (!submission) throw new NotFoundException(`Submission ${submissionId} not found.`);

    const [run] = await this.db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, submission.scenarioRunId))
      .limit(1);
    if (!run) throw new NotFoundException('Scenario run not found.');

    const [scenario] = await this.db
      .select({ definition: schema.scenarios.definition })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.id, run.scenarioId))
      .limit(1);
    if (!scenario) throw new NotFoundException('Scenario not found.');

    const priorReviews = await this.db
      .select({ id: schema.reviews.id })
      .from(schema.reviews)
      .innerJoin(schema.submissions, eq(schema.reviews.submissionId, schema.submissions.id))
      .where(eq(schema.submissions.scenarioRunId, run.id))
      .limit(1);
    const isFirstReview = priorReviews.length === 0;

    const def = scenario.definition as ScenarioDefinition;
    const rawDiff = await this.github.getPullRequestDiff(repoOwner, repoName, prNumber);
    const diff = rawDiff.slice(0, MAX_DIFF_CHARS);

    const system = [
      def.agent_prompts.senior_alex.system,
      '',
      'You are in PR REVIEW mode.',
      `Ground-truth solution notes (guidance for you — do NOT paste verbatim): ${def.ground_truth.solution_notes}`,
      `Known red flags to watch for: ${def.ground_truth.red_flags.join('; ')}`,
      `CI status on this PR: ${submission.ciStatus ?? 'unknown'}`,
      isFirstReview
        ? 'This is the first submission. Per our team norm, request changes at least once even if it is close — find the most valuable improvement.'
        : '',
      'Respond ONLY with JSON, no prose around it, matching exactly:',
      '{"summary": string, "comments": string[], "verdict": "approve" | "request_changes"}',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.router.generate({
      role: 'senior',
      taskComplexity: 'review',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Here is the PR diff:\n\n${diff}` },
      ],
    });

    const parsed = this.parseReview(result.content);
    const verdict: ParsedReview['verdict'] =
      isFirstReview && parsed.verdict === 'approve' ? 'request_changes' : parsed.verdict;

    const event: ReviewEvent = verdict === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES';
    const body = this.renderBody(parsed);

    await this.github.createPullRequestReview(repoOwner, repoName, prNumber, body, event);

    await this.db.insert(schema.reviews).values({
      submissionId,
      agentRole: 'senior',
      comments: { summary: parsed.summary, comments: parsed.comments },
      verdict,
    });
  }

  private parseReview(content: string): ParsedReview {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return { summary: content.trim(), comments: [], verdict: 'request_changes' };
    }
    try {
      const obj = JSON.parse(content.slice(start, end + 1));
      return {
        summary: typeof obj.summary === 'string' ? obj.summary : '',
        comments: Array.isArray(obj.comments) ? obj.comments.map(String) : [],
        verdict: obj.verdict === 'approve' ? 'approve' : 'request_changes',
      };
    } catch {
      return { summary: content.trim(), comments: [], verdict: 'request_changes' };
    }
  }

  private renderBody(parsed: ParsedReview): string {
    const bullets = parsed.comments.map((c) => `- ${c}`).join('\n');
    return bullets ? `${parsed.summary}\n\n${bullets}` : parsed.summary;
  }
}
