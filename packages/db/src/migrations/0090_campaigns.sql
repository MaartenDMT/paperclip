CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"goal_id" uuid,
	"lead_agent_id" uuid,
	"title" text NOT NULL,
	"objective" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"updated_by_agent_id" uuid,
	"updated_by_user_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_projects" (
	"campaign_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_projects_pk" PRIMARY KEY("campaign_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"title" text NOT NULL,
	"objective" text,
	"status" text DEFAULT 'planning' NOT NULL,
	"plan_document_id" uuid,
	"result_document_id" uuid,
	"approval_id" uuid,
	"approved_plan_revision_id" uuid,
	"execution_issue_id" uuid,
	"assignee_agent_id" uuid,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"updated_by_agent_id" uuid,
	"updated_by_user_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_lead_agent_id_agents_id_fk" FOREIGN KEY ("lead_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_projects" ADD CONSTRAINT "campaign_projects_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_projects" ADD CONSTRAINT "campaign_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_projects" ADD CONSTRAINT "campaign_projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_phases" ADD CONSTRAINT "campaign_phases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_phases" ADD CONSTRAINT "campaign_phases_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_phases" ADD CONSTRAINT "campaign_phases_plan_document_id_documents_id_fk" FOREIGN KEY ("plan_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_phases" ADD CONSTRAINT "campaign_phases_result_document_id_documents_id_fk" FOREIGN KEY ("result_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_phases" ADD CONSTRAINT "campaign_phases_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_phases" ADD CONSTRAINT "campaign_phases_approved_plan_revision_id_document_revisions_id_fk" FOREIGN KEY ("approved_plan_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_phases" ADD CONSTRAINT "campaign_phases_execution_issue_id_issues_id_fk" FOREIGN KEY ("execution_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_phases" ADD CONSTRAINT "campaign_phases_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_phases" ADD CONSTRAINT "campaign_phases_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_phases" ADD CONSTRAINT "campaign_phases_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "campaigns_company_status_idx" ON "campaigns" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX "campaigns_company_lead_idx" ON "campaigns" USING btree ("company_id","lead_agent_id");
--> statement-breakpoint
CREATE INDEX "campaign_projects_company_idx" ON "campaign_projects" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "campaign_projects_project_idx" ON "campaign_projects" USING btree ("project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_phases_campaign_sequence_uq" ON "campaign_phases" USING btree ("campaign_id","sequence_number");
--> statement-breakpoint
CREATE INDEX "campaign_phases_company_status_idx" ON "campaign_phases" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX "campaign_phases_campaign_idx" ON "campaign_phases" USING btree ("campaign_id");
--> statement-breakpoint
CREATE INDEX "campaign_phases_approval_idx" ON "campaign_phases" USING btree ("approval_id");
--> statement-breakpoint
CREATE INDEX "campaign_phases_execution_issue_idx" ON "campaign_phases" USING btree ("execution_issue_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "issues_campaign_phase_execution_uq" ON "issues" USING btree ("company_id","origin_kind","origin_id") WHERE "issues"."origin_kind" = 'campaign_phase_execution' AND "issues"."origin_id" IS NOT NULL;
