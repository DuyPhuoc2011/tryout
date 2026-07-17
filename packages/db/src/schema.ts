import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  unique,
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
