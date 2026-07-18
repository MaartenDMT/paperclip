CREATE TABLE plugin_maos_company_18e72b866b.campaigns (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  goal_id uuid,
  lead_agent_id uuid,
  title text NOT NULL,
  objective text,
  status text NOT NULL DEFAULT 'draft',
  project_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_agent_id uuid,
  created_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaigns_company_status_idx ON plugin_maos_company_18e72b866b.campaigns (company_id, status);

CREATE TABLE plugin_maos_company_18e72b866b.campaign_phases (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES plugin_maos_company_18e72b866b.campaigns(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL,
  title text NOT NULL,
  objective text,
  status text NOT NULL DEFAULT 'planning',
  assignee_agent_id uuid,
  plan_document_id uuid,
  result_document_id uuid,
  approval_id uuid,
  approved_plan_revision_id uuid,
  execution_issue_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, sequence_number)
);

CREATE INDEX campaign_phases_company_status_idx ON plugin_maos_company_18e72b866b.campaign_phases (company_id, status);

CREATE TABLE plugin_maos_company_18e72b866b.goal_bindings (
  company_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  maos_system_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, goal_id),
  UNIQUE (company_id, maos_system_id),
  CHECK (maos_system_id ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')
);

CREATE TABLE plugin_maos_company_18e72b866b.meeting_recommendations (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  trigger text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  issue_id uuid,
  participant_agent_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  agenda jsonb NOT NULL,
  expected_outputs jsonb NOT NULL,
  status text NOT NULL DEFAULT 'recommended',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX meeting_recommendations_company_status_idx ON plugin_maos_company_18e72b866b.meeting_recommendations (company_id, status, created_at DESC);
