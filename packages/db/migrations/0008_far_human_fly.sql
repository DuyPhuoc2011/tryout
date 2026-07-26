CREATE INDEX IF NOT EXISTS "arena_env_live_status_idx" ON "arena_environments" USING btree ("status") WHERE "arena_environments"."status" <> 'destroyed';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arena_env_live_ttl_idx" ON "arena_environments" USING btree ("ttl_expires_at") WHERE "arena_environments"."status" <> 'destroyed';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arena_turns_environment_id_created_at_idx" ON "arena_turns" USING btree ("environment_id","created_at");--> statement-breakpoint
-- Appended by hand: drizzle-kit 0.24.2 does not generate migration SQL for
-- Drizzle's `check()` table constraint on Postgres, so this is not expressed
-- in packages/db/src/schema.ts via the ORM builder (see comment on
-- arenaEnvironments.envSlug). Defense-in-depth only — env_slug is always
-- server-generated to this shape today, so no current code path can violate it.
ALTER TABLE "arena_environments" ADD CONSTRAINT "arena_env_slug_shape" CHECK ("arena_environments"."env_slug" ~ '^env-[a-z0-9]{6,32}$');