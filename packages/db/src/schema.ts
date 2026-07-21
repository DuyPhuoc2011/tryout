import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  unique,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

export const listingStatusEnum = pgEnum('listing_status', ['draft', 'published', 'archived']);
export const purchaseStatusEnum = pgEnum('purchase_status', [
  'pending',
  'paid',
  'invite_sent',
  'invite_failed',
  'refunded',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  // Nullable: OAuth-only users have no local password.
  passwordHash: text('password_hash'),
  // Reserved for cohorts/orgs. No FK yet — Organization isn't built.
  organizationId: uuid('organization_id'),
  // GitHub account that receives content-repo invites. Set on first purchase.
  githubUsername: text('github_username'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Marketplace: a sellable DevOps scenario. `story` is the free public part;
// the paid content lives in the private `contentRepo` under GITHUB_OWNER.
export const scenarioListings = pgTable('scenario_listings', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  tagline: text('tagline').notNull(),
  story: text('story').notNull(),
  contents: text('contents').notNull(),
  priceCents: integer('price_cents').notNull(),
  currency: text('currency').notNull().default('usd'),
  contentRepo: text('content_repo').notNull(),
  // Private guided-walkthrough knowledge for the tutor. NEVER exposed via /catalog.
  tutorBrief: text('tutor_brief'),
  status: listingStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => scenarioListings.id),
    stripeSessionId: text('stripe_session_id'),
    amountCents: integer('amount_cents').notNull(),
    status: purchaseStatusEnum('status').notNull().default('pending'),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One purchase row per user+listing; an abandoned checkout reuses its pending row.
    userListingUnique: unique('purchases_user_listing_unique').on(t.userId, t.listingId),
  }),
);

export const tutorMessages = pgTable('tutor_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  listingId: uuid('listing_id')
    .notNull()
    .references(() => scenarioListings.id),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tutorThreads = pgTable(
  'tutor_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => scenarioListings.id),
    phase: text('phase').notNull().default('orient'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userListingUnique: unique('tutor_threads_user_listing_unique').on(t.userId, t.listingId),
  }),
);

// One-way lifecycle. An environment never returns to an earlier state; `degraded`
// means a partial apply left it unusable and it must be reprovisioned.
export const arenaEnvStatusEnum = pgEnum('arena_env_status', [
  'pending',
  'provisioning',
  'ready',
  'degraded',
  'destroyed',
]);

// A turn is one submitted design. `rejected` is a validation failure — it never
// reaches infrastructure. Everything from `applying` onward costs real money.
export const arenaTurnStatusEnum = pgEnum('arena_turn_status', [
  'submitted',
  'rejected',
  'applying',
  'apply_failed',
  'applied',
  'measuring',
  'scored',
]);

export const arenaEnvironments = pgTable(
  'arena_environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => scenarioListings.id),
    // Becomes a GCP resource name. Must match /^env-[a-z0-9]{6,32}$/ — the same
    // pattern @tryout/arena's renderTfvars enforces. Also enforced in the
    // database via a CHECK constraint (`arena_env_slug_shape`), but that
    // constraint is defense-in-depth against a future backfill/refactor
    // inserting a malformed slug — not expressed here in Drizzle because the
    // installed drizzle-kit (0.24.2) does not generate migration SQL for
    // `check()` table constraints on Postgres (verified empirically: it
    // silently drops the constraint from both the generated SQL and the
    // migration snapshot). It exists only as raw SQL appended to
    // migrations/0008_far_human_fly.sql.
    envSlug: text('env_slug').notNull().unique(),
    status: arenaEnvStatusEnum('status').notNull().default('pending'),
    // Nothing lives forever by accident. The reaper (M1-B2) sweeps past this.
    ttlExpiresAt: timestamp('ttl_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One environment per buyer per scenario. Reprovisioning reuses the row.
    userListingUnique: unique('arena_env_user_listing_unique').on(t.userId, t.listingId),
    // Both queries below only ever care about non-destroyed rows, and most rows
    // eventually end up `destroyed` — a partial index keeps these small and
    // gives an index-only scan for the per-status count instead of carrying
    // dead weight for terminal rows.
    // Quota check on every environment create: count live (non-destroyed) rows.
    liveStatusIdx: index('arena_env_live_status_idx')
      .on(t.status)
      .where(sql`${t.status} <> 'destroyed'`),
    // Reaper (M1-B2): find live rows whose TTL has expired.
    liveTtlIdx: index('arena_env_live_ttl_idx')
      .on(t.ttlExpiresAt)
      .where(sql`${t.status} <> 'destroyed'`),
  }),
);

export const arenaTurns = pgTable(
  'arena_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    environmentId: uuid('environment_id')
      .notNull()
      .references(() => arenaEnvironments.id),
    status: arenaTurnStatusEnum('status').notNull().default('submitted'),
    // Validation failures, shaped as @tryout/arena's ParseError[]. Already
    // sanitized and length-bounded by parseDesign before they get here.
    parseErrors: jsonb('parse_errors'),
    // Rendered ArenaTfvars. Null until a design validates.
    tfvars: jsonb('tfvars'),
    // Verdict from scoreRun. Null until a later milestone scores the run.
    verdict: jsonb('verdict'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Serves the rate-limit query on every turn submission (count turns for an
    // environment created in the last hour) and doubles as the FK index that
    // Postgres does not create automatically. Equality column first.
    envCreatedAtIdx: index('arena_turns_environment_id_created_at_idx').on(
      t.environmentId,
      t.createdAt,
    ),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
