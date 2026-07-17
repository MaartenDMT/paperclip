CREATE TABLE IF NOT EXISTS "meeting_contributions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "meeting_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "summary_markdown" text NOT NULL,
  "progress" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "next_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "proposed_decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "better_alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_contributions" ADD CONSTRAINT "meeting_contributions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_contributions" ADD CONSTRAINT "meeting_contributions_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_contributions" ADD CONSTRAINT "meeting_contributions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_contributions_meeting_agent_uq" ON "meeting_contributions" USING btree ("meeting_id","agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_contributions_company_meeting_idx" ON "meeting_contributions" USING btree ("company_id","meeting_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_contributions_company_agent_idx" ON "meeting_contributions" USING btree ("company_id","agent_id");
