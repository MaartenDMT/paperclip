CREATE INDEX IF NOT EXISTS "agent_wakeup_requests_status_requested_idx"
  ON "agent_wakeup_requests" ("status", "requested_at");

CREATE INDEX IF NOT EXISTS "agent_wakeup_requests_run_idx"
  ON "agent_wakeup_requests" ("run_id");

CREATE INDEX IF NOT EXISTS "heartbeat_runs_agent_status_created_idx"
  ON "heartbeat_runs" ("agent_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "heartbeat_runs_status_created_idx"
  ON "heartbeat_runs" ("status", "created_at");

CREATE INDEX IF NOT EXISTS "meetings_company_status_updated_idx"
  ON "meetings" ("company_id", "status", "updated_at");
