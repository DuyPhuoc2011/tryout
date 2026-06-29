import { eq } from 'drizzle-orm';
import { createDb } from '../client';
import { tracks, scenarios } from '../schema';

const db = createDb(
  process.env.DATABASE_URL ?? 'postgres://tryout:tryout@localhost:5432/tryout',
);

const RUNG_0 = {
  title: 'Wire up the model',
  version: 1,
  catalog: {
    summary:
      'Your first AI-agent ticket: make a summarizer call the model correctly and handle its failures. Mocked-LLM tests, a real PR, a senior review.',
    difficulty: 'intro' as const,
    tags: ['AI agents', 'Python', 'Anthropic', 'LLM'],
  },
  team: ['product_manager', 'senior_engineer', 'backend_engineer'],
  company_context: {
    name: 'Brief',
    product: 'Brief turns long documents into one-line summaries using an AI agent.',
    team: "You're a new engineer on the agent team. The codebase is a small Python service.",
    user_role: 'AI Engineer (new hire, first ticket)',
  },
  repo: { template_ref: 'agent-foundations-py', default_branch: 'main', ci: 'github-actions' },
  ticket: {
    id: 'AGENT-0',
    title: 'Make the summarizer call the model',
    body:
      'Implement summarize() in agent/model_call.py so it calls our model and returns a one-line summary. It needs to be solid — think about what happens when the model call fails or comes back empty. The acceptance tests describe the behavior; make them pass and open a PR.',
  },
  agent_prompts: {
    pm_mai: {
      system:
        'You are Mai, PM at Brief. Friendly, busy, practical. You assigned AGENT-0 to a new AI engineer. If they ask a clarifying question, answer directly. Do not volunteer implementation detail. Canonical answers when asked: error handling — "Yes, if the model call throws or returns nothing, raise our SummarizationError, don\'t leak raw exceptions." Output — "One sentence, trimmed of whitespace." Keep replies short and Slack-like.',
    },
    senior_alex: {
      system:
        'You are Alex, a senior engineer at Brief. Clear, professional, slightly terse async English. CHAT: nudge, point at the right file, don\'t hand over the solution. PR REVIEW: specific comments tied to the code. Request changes at least once on the first submission. Catch: raw exceptions not wrapped, missing empty-content handling, wrong request shape, no tests. Approve once correct and clean.',
    },
  },
  ground_truth: {
    solution_notes:
      'summarize() calls client.create_message with model claude-haiku-4-5, max_tokens 256, a single user message containing the text; returns response.content[0].text.strip(); wraps any client exception in SummarizationError; raises SummarizationError when content is empty.',
    red_flags: [
      'raw exception leaks instead of SummarizationError',
      'no empty-content handling',
      'wrong model or message shape',
      'no PR description',
    ],
  },
  rubric: {
    technical: {
      weight: 0.5,
      criteria: [
        { id: 'acceptance_tests_pass', weight: 0.5, description: 'CI green — the mocked-LLM acceptance suite passes.' },
        { id: 'error_handling', weight: 0.3, description: 'Client failures and empty content both raise SummarizationError.' },
        { id: 'request_shape', weight: 0.2, description: 'Correct model, max_tokens, and single user message containing the text.' },
      ],
    },
    professional: {
      weight: 0.5,
      criteria: [
        { id: 'surfaced_ambiguity', weight: 0.4, description: 'Asked the PM about error/empty behavior before implementing.' },
        { id: 'pr_description', weight: 0.3, description: 'PR explains what changed and why; states assumptions.' },
        { id: 'response_to_review', weight: 0.3, description: 'Incorporated senior feedback constructively across resubmits.' },
      ],
    },
  },
};

const RUNG_1 = {
  title: 'Give it a tool',
  version: 1,
  catalog: {
    summary:
      'Teach the agent to use a tool: define a tool schema, wire function-calling, dispatch the call. Mocked-LLM tests, a real PR, a senior review.',
    difficulty: 'intro' as const,
    tags: ['AI agents', 'Python', 'tool use', 'function calling'],
  },
  team: ['product_manager', 'senior_engineer', 'backend_engineer'],
  company_context: {
    name: 'Brief',
    product: 'Brief is adding tool use so its agent can fetch live data.',
    team: "You're on the agent team. The model call already works; now it needs a tool.",
    user_role: 'AI Engineer (second ticket)',
  },
  repo: { template_ref: 'agent-tools-py', default_branch: 'main', ci: 'github-actions' },
  ticket: {
    id: 'AGENT-1',
    title: 'Add a get_weather tool',
    body:
      'Give the agent a get_weather tool: define its schema, and wire a dispatcher that runs the right tool when the model asks for it (and refuses unknown tools). The acceptance tests describe the contract; make them pass and open a PR.',
  },
  agent_prompts: {
    pm_mai: {
      system:
        'You are Mai, PM at Brief. You assigned AGENT-1. Canonical answers when asked: unknown tools — "If the model names a tool we don\'t have, raise UnknownToolError, never guess." Schema — "The tool takes one required string, city." Keep replies short and Slack-like; no implementation detail.',
    },
    senior_alex: {
      system:
        'You are Alex, senior engineer at Brief. CHAT: nudge, don\'t solve. PR REVIEW: request changes at least once on the first submission. Catch: tool schema missing required city, dispatcher that ignores the tool name, no UnknownToolError path, no tests. Approve once correct and clean.',
    },
  },
  ground_truth: {
    solution_notes:
      'WEATHER_TOOL is a schema with name get_weather, a description, and input_schema requiring a string city. run_tool dispatches get_weather by name and raises UnknownToolError otherwise. get_weather returns a string mentioning the city.',
    red_flags: [
      'dispatcher ignores the tool name',
      'no UnknownToolError path',
      'schema missing required city',
      'no tests',
    ],
  },
  rubric: {
    technical: {
      weight: 0.5,
      criteria: [
        { id: 'acceptance_tests_pass', weight: 0.5, description: 'CI green — the mocked-LLM acceptance suite passes.' },
        { id: 'dispatch_correctness', weight: 0.3, description: 'Correct tool dispatched by name; unknown tools rejected.' },
        { id: 'schema_shape', weight: 0.2, description: 'Tool schema requires a string city.' },
      ],
    },
    professional: {
      weight: 0.5,
      criteria: [
        { id: 'surfaced_ambiguity', weight: 0.4, description: 'Asked the PM about unknown-tool behavior before implementing.' },
        { id: 'pr_description', weight: 0.3, description: 'PR explains what changed and why.' },
        { id: 'response_to_review', weight: 0.3, description: 'Incorporated senior feedback across resubmits.' },
      ],
    },
  },
};

async function upsertScenario(trackId: string, def: typeof RUNG_0) {
  const values = {
    trackId,
    title: def.title,
    version: def.version,
    definition: def,
    status: 'active',
    projectType: 'backend_monolith' as const,
    available: true,
  };
  const existing = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(eq(scenarios.title, def.title))
    .limit(1);
  if (existing.length > 0) {
    await db.update(scenarios).set(values).where(eq(scenarios.id, existing[0].id));
    console.log(`  Updated scenario "${def.title}"`);
  } else {
    await db.insert(scenarios).values(values);
    console.log(`  Inserted scenario "${def.title}"`);
  }
}

async function seed() {
  console.log('Seeding Track: ai-agents...');
  const existing = await db.select().from(tracks).where(eq(tracks.name, 'ai-agents')).limit(1);
  const trackId =
    existing.length > 0
      ? existing[0].id
      : (await db.insert(tracks).values({ name: 'ai-agents' }).returning())[0].id;

  await upsertScenario(trackId, RUNG_0);
  await upsertScenario(trackId, RUNG_1);

  console.log('Agent scenarios seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
