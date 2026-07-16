ALTER TABLE "agent_wakeup_requests" ADD COLUMN "team_lead_id" uuid;
ALTER TABLE "agent_wakeup_requests" ADD CONSTRAINT "agent_wakeup_requests_team_lead_id_agents_id_fk" FOREIGN KEY ("team_lead_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
-- paperclip:migration-safety-ignore large-create-index-not-concurrently: migration runner executes inside a transaction where CONCURRENTLY cannot run. Content matches the already-applied upstream migration.
CREATE INDEX "agent_wakeup_requests_team_lead_status_idx" ON "agent_wakeup_requests" USING btree ("team_lead_id","status") WHERE "team_lead_id" IS NOT NULL;
