DO $$ BEGIN
 CREATE TYPE "public"."project_type" AS ENUM('backend_monolith', 'microservices', 'frontend_web', 'mobile', 'desktop');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."team_role_category" AS ENUM('leadership', 'engineering', 'design', 'qa');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" "team_role_category" NOT NULL,
	"ai_name" text,
	"ai_initial" text,
	"interactive" boolean DEFAULT false NOT NULL,
	"selectable_by_candidate" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "team_roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "chosen_role" text;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "project_type" "project_type" DEFAULT 'backend_monolith' NOT NULL;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "available" boolean DEFAULT false NOT NULL;