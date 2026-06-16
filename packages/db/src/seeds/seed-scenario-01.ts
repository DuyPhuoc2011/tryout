import { eq } from 'drizzle-orm';
import { createDb } from '../client';
import { tracks, scenarios, teamRoles } from '../schema';

const db = createDb(
  process.env.DATABASE_URL ?? 'postgres://tryout:tryout@localhost:5432/tryout',
);

const SCENARIO_DEFINITION = {
  id: 'scenario-01-archive-tasks',
  track: 'backend',
  title: 'Add the ability to archive tasks',
  version: 1,
  difficulty: 'intro',
  estimated_minutes: 60,
  catalog: {
    summary:
      'Ship your first ticket on a live NestJS REST API: add soft-archive to the Tasks resource, with a PR and a senior review.',
    difficulty: 'intro',
    tags: ['NestJS', 'REST', 'TypeScript', 'CRUD'],
  },
  team: [
    'product_manager',
    'engineering_manager',
    'senior_engineer',
    'backend_engineer',
    'qa_engineer',
  ],
  company_context: {
    name: 'Lumi',
    product:
      'Lumi is a lightweight personal productivity app. Users create tasks, mark them complete, and want to keep their list focused on what\'s active.',
    team: 'A small product team. You\'re a new backend engineer. The codebase is a NestJS REST API that owns the Tasks resource.',
    user_role: 'Backend Engineer (new hire, first ticket)',
  },
  repo: {
    template_ref: 'lumi-tasks-api',
    default_branch: 'main',
    ci: 'github-actions',
  },
  ticket: {
    id: 'LUMI-142',
    title: 'Let users archive completed tasks',
    body: 'Users have asked for a way to archive tasks they\'re done with so their task list stays clean and focused on what\'s still active.\n\nPlease add an archive endpoint: POST /tasks/:id/archive\n\nKeep it consistent with how the rest of our Tasks API is built.',
  },
  clarifications: [
    {
      id: 'exclude-from-default-list',
      the_gap: 'The ticket says the list should "stay clean" but never says archived tasks should be hidden from GET /tasks, or how to still retrieve them.',
      good_question_signals: [
        'Should archived tasks be excluded from the default GET /tasks?',
        'How should someone still see their archived tasks if needed?',
      ],
      canonical_answer:
        'Yes — exclude archived tasks from GET /tasks by default. But nothing should be lost: support GET /tasks?includeArchived=true to include them.',
      has_technical_consequence: true,
    },
    {
      id: 'unarchive-needed',
      the_gap: 'The ticket only mentions archiving. It never says whether users can restore an archived task.',
      good_question_signals: [
        'Do users need to un-archive / restore a task?',
        'Is archive reversible?',
      ],
      canonical_answer: 'Yes — users need to restore tasks. Add POST /tasks/:id/unarchive.',
      has_technical_consequence: true,
    },
    {
      id: 'archive-vs-delete',
      the_gap: 'Confirming archive is a soft state, not a deletion.',
      good_question_signals: [
        "Archiving shouldn't delete the task, right? It's still retrievable directly?",
      ],
      canonical_answer:
        "Correct — archiving is a soft state. The task still exists and is retrievable at GET /tasks/:id. It's just hidden from the default list.",
      has_technical_consequence: true,
    },
  ],
  injected_events: [
    {
      id: 'scope-change-priority',
      type: 'scope_change',
      enabled: false,
      trigger: 'after first PR is opened',
      pm_message:
        'Quick change from product — can archived tasks also be sorted to the bottom when includeArchived=true is used, rather than mixed in? Small tweak, but they want active tasks on top.',
    },
  ],
  agents: {
    pm: { persona_ref: 'pm-mai' },
    senior: { persona_ref: 'senior-alex' },
  },
  rubric_ref: 'rubric-scenario-01',
  grading: {
    hidden_acceptance_suite: 'test/archive.acceptance.spec.ts',
  },
  ground_truth: {
    solution_notes:
      'A complete solution adds soft-archive state (archived boolean or archivedAt timestamp), POST /tasks/:id/archive (200/204, 404 if missing), POST /tasks/:id/unarchive (404 if missing), GET /tasks excludes archived by default, GET /tasks?includeArchived=true includes them, GET /tasks/:id always returns the task. Logic lives in the service, not the controller.',
    red_flags: [
      'archive implemented as hard delete',
      'archived tasks leaking into default list',
      'no un-archive endpoint',
      'business logic in the controller',
      'no new tests',
    ],
  },
  agent_prompts: {
    pm_mai: {
      system:
        "You are Mai, the Product Manager at Lumi. You are friendly, busy, and practical. You assigned ticket LUMI-142 to a new backend engineer.\n\nBehavior:\n- If the engineer asks a clarifying question, answer it directly using the canonical answers below. Reward good questions with a clear, useful answer.\n- If they ask something the ticket already covers, answer briefly.\n- Do NOT volunteer the answers to the consequential clarifications unless asked.\n- Stay in scope. You're a PM, not an engineer: don't give implementation details.\n- Keep replies short and natural, like real Slack messages.\n\nCanonical answers (only when asked):\n- Excluding archived from the default list: \"Yes, hide archived tasks from the main list by default. But don't lose them — let people pass ?includeArchived=true to see them.\"\n- Un-archive: \"Good catch — yes, people need to restore tasks. Add an un-archive too.\"\n- Archive vs delete: \"Right, archiving doesn't delete anything. The task should still be there if you fetch it directly.\"",
    },
    senior_alex: {
      system:
        'You are Alex, a senior backend engineer at Lumi. You communicate in clear, professional, slightly terse async English.\n\nTwo modes:\n1) CHAT: Help them think; do NOT hand over the solution. Point at the relevant file or pattern, ask what they\'ve tried, give a nudge. If they ask about list behaviour, redirect them to confirm with Mai.\n2) PR REVIEW: Leave specific, constructive comments tied to the code. Request changes at least once on the first submission. Catch incompleteness (missing un-archive, archived tasks leaking, no includeArchived support) and call it out clearly. Approve once the feature is complete and conventions respected.',
    },
  },
  rubric: {
    technical: {
      weight: 0.5,
      criteria: [
        { id: 'acceptance_tests_pass', weight: 0.4, description: 'Hidden suite passes on the final branch.' },
        { id: 'correctness', weight: 0.25, description: 'Default-list exclusion, includeArchived, un-archive, 404s all handled.' },
        { id: 'conventions', weight: 0.2, description: 'Logic in the service; DTO/validation patterns respected; idiomatic NestJS.' },
        { id: 'own_tests', weight: 0.15, description: 'New tests cover the feature, following the existing e2e pattern.' },
      ],
    },
    professional: {
      weight: 0.5,
      criteria: [
        { id: 'surfaced_ambiguity', weight: 0.3, description: 'Asked the PM at least one consequential clarifying question before implementation.' },
        { id: 'pr_description', weight: 0.2, description: 'Explains what changed and why; states assumptions.' },
        { id: 'response_to_review', weight: 0.25, description: 'Incorporated feedback constructively; not defensive; no silent force-push.' },
        { id: 'communication_clarity', weight: 0.15, description: 'Messages to PM/Senior are clear, specific, and respectful.' },
        { id: 'help_seeking_judgment', weight: 0.1, description: 'Used the Senior appropriately — neither silent nor asked for the answer.' },
      ],
    },
  },
};

// The canonical team seats. Idempotent on `key`.
const TEAM_ROLES = [
  {
    key: 'product_manager',
    title: 'Product Manager',
    description: 'Owns the "why", writes the ticket, and answers scope questions.',
    category: 'leadership' as const,
    aiName: 'Mai',
    aiInitial: 'M',
    interactive: true,
    selectableByCandidate: false,
    sortOrder: 10,
  },
  {
    key: 'engineering_manager',
    title: 'Engineering Manager',
    description: 'Keeps the team unblocked and the delivery on track.',
    category: 'leadership' as const,
    aiName: 'Linh',
    aiInitial: 'L',
    interactive: false,
    selectableByCandidate: false,
    sortOrder: 20,
  },
  {
    key: 'senior_engineer',
    title: 'Senior Engineer',
    description: 'Reviews your diff, requests changes, and nudges you when you ask.',
    category: 'engineering' as const,
    aiName: 'Alex',
    aiInitial: 'A',
    interactive: true,
    selectableByCandidate: false,
    sortOrder: 30,
  },
  {
    key: 'backend_engineer',
    title: 'Backend Engineer',
    description: 'Implements the ticket on the service and ships the PR.',
    category: 'engineering' as const,
    aiName: null,
    aiInitial: null,
    interactive: false,
    selectableByCandidate: true,
    sortOrder: 40,
  },
  {
    key: 'frontend_engineer',
    title: 'Frontend Engineer',
    description: 'Builds the UI and wires it to the API.',
    category: 'engineering' as const,
    aiName: null,
    aiInitial: null,
    interactive: false,
    selectableByCandidate: true,
    sortOrder: 41,
  },
  {
    key: 'mobile_engineer',
    title: 'Mobile Engineer',
    description: 'Builds the native/mobile client and its flows.',
    category: 'engineering' as const,
    aiName: null,
    aiInitial: null,
    interactive: false,
    selectableByCandidate: true,
    sortOrder: 42,
  },
  {
    key: 'qa_engineer',
    title: 'QA Engineer',
    description: 'Guards quality — exercises edge cases and the acceptance suite.',
    category: 'qa' as const,
    aiName: 'Tom',
    aiInitial: 'T',
    interactive: false,
    selectableByCandidate: false,
    sortOrder: 50,
  },
  {
    key: 'product_designer',
    title: 'Product Designer',
    description: 'Owns the experience and how the work should feel.',
    category: 'design' as const,
    aiName: 'Sara',
    aiInitial: 'S',
    interactive: false,
    selectableByCandidate: false,
    sortOrder: 60,
  },
];

// "Coming soon" catalog entries — diverse project types, not yet playable.
const COMING_SOON = [
  {
    title: 'Make the orders service retry-safe',
    projectType: 'microservices' as const,
    company: 'Cargo',
    summary:
      'Add idempotent retries to the Orders microservice so duplicate webhooks stop double-charging.',
    difficulty: 'intermediate' as const,
    tags: ['microservices', 'idempotency', 'queues'],
    team: ['product_manager', 'engineering_manager', 'senior_engineer', 'backend_engineer', 'qa_engineer'],
  },
  {
    title: 'Add saved filters to the dashboard',
    projectType: 'frontend_web' as const,
    company: 'Pulse',
    summary:
      'Let users save and re-apply table filters in a React dashboard, persisted to the URL and the backend.',
    difficulty: 'intermediate' as const,
    tags: ['React', 'Next.js', 'state', 'URL'],
    team: ['product_manager', 'product_designer', 'senior_engineer', 'frontend_engineer', 'qa_engineer'],
  },
  {
    title: 'Ship offline mode for the tracker app',
    projectType: 'mobile' as const,
    company: 'Trail',
    summary:
      'Cache trips locally and sync when the device comes back online, with conflict handling.',
    difficulty: 'advanced' as const,
    tags: ['mobile', 'offline', 'sync'],
    team: ['product_manager', 'product_designer', 'senior_engineer', 'mobile_engineer', 'qa_engineer'],
  },
  {
    title: 'Add auto-update to the desktop client',
    projectType: 'desktop' as const,
    company: 'Forge',
    summary:
      'Wire a background auto-updater into the Electron desktop app with a safe rollback path.',
    difficulty: 'advanced' as const,
    tags: ['desktop', 'Electron', 'releases'],
    team: ['product_manager', 'engineering_manager', 'senior_engineer', 'frontend_engineer', 'qa_engineer'],
  },
];

async function seedTeamRoles() {
  console.log('Seeding team roles...');
  for (const role of TEAM_ROLES) {
    const existing = await db
      .select({ id: teamRoles.id })
      .from(teamRoles)
      .where(eq(teamRoles.key, role.key))
      .limit(1);
    if (existing.length > 0) {
      await db.update(teamRoles).set(role).where(eq(teamRoles.key, role.key));
    } else {
      await db.insert(teamRoles).values(role);
    }
  }
  console.log(`  ${TEAM_ROLES.length} team roles ready.`);
}

async function seedComingSoon(trackId: string) {
  console.log('Seeding coming-soon catalog scenarios...');
  for (const item of COMING_SOON) {
    const definition = {
      title: item.title,
      catalog: { summary: item.summary, difficulty: item.difficulty, tags: item.tags },
      team: item.team,
      company_context: { name: item.company, product: '', team: '', user_role: '' },
      ticket: { id: 'SOON', title: item.title, body: 'Coming soon.' },
    };
    const existing = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(eq(scenarios.title, item.title))
      .limit(1);
    const values = {
      trackId,
      title: item.title,
      version: 1,
      definition,
      status: 'draft',
      projectType: item.projectType,
      available: false,
    };
    if (existing.length > 0) {
      await db.update(scenarios).set(values).where(eq(scenarios.title, item.title));
    } else {
      await db.insert(scenarios).values(values);
    }
  }
  console.log(`  ${COMING_SOON.length} coming-soon scenarios ready.`);
}

async function seed() {
  console.log('Seeding Track: backend...');
  const existingTrack = await db
    .select()
    .from(tracks)
    .where(eq(tracks.name, 'backend'))
    .limit(1);

  let trackId: string;
  if (existingTrack.length > 0) {
    trackId = existingTrack[0].id;
    console.log(`  Track already exists (id=${trackId}), skipping insert.`);
  } else {
    const [track] = await db.insert(tracks).values({ name: 'backend' }).returning();
    trackId = track.id;
    console.log(`  Inserted track id=${trackId}`);
  }

  console.log('Seeding Scenario 01...');
  const scenarioValues = {
    trackId,
    title: SCENARIO_DEFINITION.title,
    version: SCENARIO_DEFINITION.version,
    definition: SCENARIO_DEFINITION,
    status: 'active',
    projectType: 'backend_monolith' as const,
    available: true,
  };
  const existingScenario = await db
    .select()
    .from(scenarios)
    .where(eq(scenarios.title, SCENARIO_DEFINITION.title))
    .limit(1);

  if (existingScenario.length > 0) {
    await db
      .update(scenarios)
      .set(scenarioValues)
      .where(eq(scenarios.id, existingScenario[0].id));
    console.log(`  Updated scenario id=${existingScenario[0].id} (catalog fields).`);
  } else {
    const [scenario] = await db.insert(scenarios).values(scenarioValues).returning();
    console.log(`  Inserted scenario id=${scenario.id}`);
  }

  await seedTeamRoles();
  await seedComingSoon(trackId);

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
