CREATE TABLE IF NOT EXISTS "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"goal_id" uuid,
	"source_issue_id" uuid,
	"meeting_type" text DEFAULT 'operating_review' NOT NULL,
	"title" text,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"chair_agent_id" uuid,
	"idempotency_key" text,
	"agenda" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context_markdown" text,
	"result" jsonb,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"resolved_by_agent_id" uuid,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"role" text DEFAULT 'participant' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_issue_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"link_kind" text DEFAULT 'mentioned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meetings" ADD CONSTRAINT "meetings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meetings" ADD CONSTRAINT "meetings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meetings" ADD CONSTRAINT "meetings_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meetings" ADD CONSTRAINT "meetings_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meetings" ADD CONSTRAINT "meetings_chair_agent_id_agents_id_fk" FOREIGN KEY ("chair_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meetings" ADD CONSTRAINT "meetings_resolved_by_agent_id_agents_id_fk" FOREIGN KEY ("resolved_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_issue_links" ADD CONSTRAINT "meeting_issue_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_issue_links" ADD CONSTRAINT "meeting_issue_links_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_issue_links" ADD CONSTRAINT "meeting_issue_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_company_status_created_idx" ON "meetings" USING btree ("company_id","status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_company_source_issue_idx" ON "meetings" USING btree ("company_id","source_issue_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meetings_company_idempotency_uq" ON "meetings" USING btree ("company_id","idempotency_key") WHERE "meetings"."idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_participants_meeting_agent_uq" ON "meeting_participants" USING btree ("meeting_id","agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_participants_company_agent_idx" ON "meeting_participants" USING btree ("company_id","agent_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_issue_links_meeting_issue_kind_uq" ON "meeting_issue_links" USING btree ("meeting_id","issue_id","link_kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_issue_links_company_issue_idx" ON "meeting_issue_links" USING btree ("company_id","issue_id");
