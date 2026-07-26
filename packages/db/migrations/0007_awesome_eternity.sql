DO $$ BEGIN
 CREATE TYPE "public"."arena_env_status" AS ENUM('pending', 'provisioning', 'ready', 'degraded', 'destroyed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."arena_turn_status" AS ENUM('submitted', 'rejected', 'applying', 'apply_failed', 'applied', 'measuring', 'scored');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arena_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"env_slug" text NOT NULL,
	"status" "arena_env_status" DEFAULT 'pending' NOT NULL,
	"ttl_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arena_environments_env_slug_unique" UNIQUE("env_slug"),
	CONSTRAINT "arena_env_user_listing_unique" UNIQUE("user_id","listing_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arena_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"status" "arena_turn_status" DEFAULT 'submitted' NOT NULL,
	"parse_errors" jsonb,
	"tfvars" jsonb,
	"verdict" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arena_environments" ADD CONSTRAINT "arena_environments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arena_environments" ADD CONSTRAINT "arena_environments_listing_id_scenario_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."scenario_listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arena_turns" ADD CONSTRAINT "arena_turns_environment_id_arena_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."arena_environments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
