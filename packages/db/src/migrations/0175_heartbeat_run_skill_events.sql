CREATE TABLE "heartbeat_run_skill_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"skill_key" text NOT NULL,
	"skill_name" text NOT NULL,
	"source" text DEFAULT 'adapter' NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "heartbeat_run_skill_events" ADD CONSTRAINT "heartbeat_run_skill_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "heartbeat_run_skill_events" ADD CONSTRAINT "heartbeat_run_skill_events_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "heartbeat_run_skill_events" ADD CONSTRAINT "heartbeat_run_skill_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "heartbeat_run_skill_events_run_activated_idx" ON "heartbeat_run_skill_events" USING btree ("run_id","activated_at");
CREATE INDEX "heartbeat_run_skill_events_company_skill_idx" ON "heartbeat_run_skill_events" USING btree ("company_id","skill_key","activated_at");
