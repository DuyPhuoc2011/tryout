CREATE TABLE IF NOT EXISTS "candidate_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scenario_run_id" uuid,
	"experience_level" text,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"goals" text,
	"confidence" integer DEFAULT 0 NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_scenario_id" uuid,
	"matched_role" text,
	"match_rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_scenario_run_id_scenario_runs_id_fk" FOREIGN KEY ("scenario_run_id") REFERENCES "public"."scenario_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_matched_scenario_id_scenarios_id_fk" FOREIGN KEY ("matched_scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
