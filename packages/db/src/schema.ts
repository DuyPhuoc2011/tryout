import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';

export const scenarioRunStatus = pgEnum('scenario_run_status', [
  'onboarding',
  'in_progress',
  'in_review',
  'grading',
  'complete',
]);
export const agentRoleEnum = pgEnum('agent_role', ['pm', 'senior']);
export const messageDirectionEnum = pgEnum('message_direction', ['user', 'agent']);
export const reviewVerdictEnum = pgEnum('review_verdict', ['approve', 'request_changes']);
export const projectTypeEnum = pgEnum('project_type', [
  'backend_monolith',
  'microservices',
  'frontend_web',
  'mobile',
  'desktop',
]);
export const teamRoleCategoryEnum = pgEnum('team_role_category', [
  'leadership',
  'engineering',
  'design',
  'qa',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  // Nullable: OAuth-only users have no local password.
  passwordHash: text('password_hash'),
  // Reserved for cohorts/orgs (spec §4). No FK yet — Organization isn't built.
  organizationId: uuid('organization_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tracks = pgTable('tracks', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
});

export const scenarios = pgTable('scenarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  trackId: uuid('track_id')
    .notNull()
    .references(() => tracks.id),
  title: text('title').notNull(),
  version: integer('version').notNull().default(1),
  definition: jsonb('definition').notNull(),
  status: text('status').notNull().default('draft'),
  projectType: projectTypeEnum('project_type').notNull().default('backend_monolith'),
  available: boolean('available').notNull().default(false),
});

// The canonical set of team seats. Seeded; referenced by scenario team templates.
export const teamRoles = pgTable('team_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  category: teamRoleCategoryEnum('category').notNull(),
  // The AI persona that fills this seat (null = filled by the candidate / generic).
  aiName: text('ai_name'),
  aiInitial: text('ai_initial'),
  // Whether this seat is a live, interactive agent today (PM, Senior).
  interactive: boolean('interactive').notNull().default(false),
  // Whether a candidate may claim this seat.
  selectableByCandidate: boolean('selectable_by_candidate').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const scenarioRuns = pgTable('scenario_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  scenarioId: uuid('scenario_id')
    .notNull()
    .references(() => scenarios.id),
  status: scenarioRunStatus('status').notNull().default('onboarding'),
  // The team-role key the candidate claimed for this run.
  chosenRole: text('chosen_role'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }),
  repoMetadata: jsonb('repo_metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const repos = pgTable('repos', {
  id: uuid('id').primaryKey().defaultRandom(),
  scenarioRunId: uuid('scenario_run_id')
    .notNull()
    .references(() => scenarioRuns.id),
  url: text('url').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  prNumber: integer('pr_number'),
});

export const agentMessages = pgTable('agent_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  scenarioRunId: uuid('scenario_run_id')
    .notNull()
    .references(() => scenarioRuns.id),
  agentRole: agentRoleEnum('agent_role').notNull(),
  direction: messageDirectionEnum('direction').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  scenarioRunId: uuid('scenario_run_id')
    .notNull()
    .references(() => scenarioRuns.id),
  prUrl: text('pr_url').notNull(),
  ciStatus: text('ci_status'),
  ciResults: jsonb('ci_results'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id')
    .notNull()
    .references(() => submissions.id),
  agentRole: agentRoleEnum('agent_role').notNull(),
  comments: jsonb('comments'),
  verdict: reviewVerdictEnum('verdict').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const scorecards = pgTable('scorecards', {
  id: uuid('id').primaryKey().defaultRandom(),
  scenarioRunId: uuid('scenario_run_id')
    .notNull()
    .references(() => scenarioRuns.id),
  technicalScore: integer('technical_score').notNull(),
  technicalFeedback: text('technical_feedback').notNull(),
  professionalScore: integer('professional_score').notNull(),
  professionalFeedback: text('professional_feedback').notNull(),
  overallFeedback: text('overall_feedback').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One row per intake session. Lives outside scenario_runs because intake
// happens BEFORE a run exists. transcript + profile are LLM-maintained.
export const candidateProfiles = pgTable('candidate_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  // Set once the candidate is placed into a run.
  scenarioRunId: uuid('scenario_run_id').references(() => scenarioRuns.id),
  experienceLevel: text('experience_level'),
  languages: jsonb('languages').notNull().default([]),
  strengths: jsonb('strengths').notNull().default([]),
  gaps: jsonb('gaps').notNull().default([]),
  goals: text('goals'),
  confidence: integer('confidence').notNull().default(0),
  // Array of { role: 'recruiter' | 'candidate', content: string }.
  transcript: jsonb('transcript').notNull().default([]),
  matchedScenarioId: uuid('matched_scenario_id').references(() => scenarios.id),
  matchedRole: text('matched_role'),
  matchRationale: text('match_rationale'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
