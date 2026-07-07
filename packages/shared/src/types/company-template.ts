export type CompanyTemplateSchemaVersion = 1;

export type CompanyTemplateMetadata = Record<string, unknown>;

export type CompanyTemplateArtifactKind =
  | "markdown_document"
  | "json_manifest"
  | "manuscript"
  | "outline"
  | "bible"
  | "checklist"
  | "qa_report"
  | "package"
  | "external_link";

export type CompanyTemplateArtifactLifecycleStatus =
  | "draft"
  | "review_ready"
  | "approved"
  | "superseded"
  | "published";

export type CompanyTemplateArtifactReviewGate =
  | "lead_review"
  | "ceo_review"
  | "board_approval"
  | "bridge_validation"
  | "final_acceptance";

export interface CompanyTemplateCompanyDefinition {
  name: string;
  issuePrefix: string;
  description?: string;
  requireBoardApprovalForNewAgents?: boolean;
  budgetMonthlyCents?: number;
  metadata?: CompanyTemplateMetadata;
}

export interface CompanyTemplateAgentDefinition {
  slug: string;
  name: string;
  role: string;
  title?: string;
  icon?: string;
  reportsToSlug?: string;
  capabilities: string;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
  metadata?: CompanyTemplateMetadata;
}

export interface CompanyTemplateGoalDefinition {
  slug: string;
  title: string;
  description?: string;
  level: "company" | "team" | "agent" | "task";
  parentSlug?: string;
  ownerAgentSlug?: string;
  metadata?: CompanyTemplateMetadata;
}

export interface CompanyTemplateProjectDefinition {
  slug: string;
  name: string;
  description?: string;
  goalSlug?: string;
  leadAgentSlug?: string;
  metadata?: CompanyTemplateMetadata;
}

export interface CompanyTemplateCampaignPhaseDefinition {
  slug: string;
  title: string;
  sequence: number;
  objective: string;
  ownerAgentSlug?: string;
  projectSlug?: string;
  requiredArtifactKeys?: string[];
  planTemplate?: string;
  metadata?: CompanyTemplateMetadata;
}

export interface CompanyTemplateCampaignDefinition {
  slug: string;
  title: string;
  objective: string;
  leadAgentSlug?: string;
  projectSlugs?: string[];
  phases: CompanyTemplateCampaignPhaseDefinition[];
  metadata?: CompanyTemplateMetadata;
}

export interface CompanyTemplateIssueDefinition {
  slug: string;
  title: string;
  description?: string;
  priority?: "critical" | "high" | "medium" | "low";
  assigneeAgentSlug?: string;
  projectSlug?: string;
  goalSlug?: string;
  metadata?: CompanyTemplateMetadata;
}

export interface CompanyTemplateArtifactContract {
  key: string;
  title: string;
  description?: string;
  phaseSlug: string;
  projectSlug?: string;
  ownerAgentSlug?: string;
  kind: CompanyTemplateArtifactKind;
  lifecycle: CompanyTemplateArtifactLifecycleStatus;
  reviewGates: CompanyTemplateArtifactReviewGate[];
  required: boolean;
  metadata?: CompanyTemplateMetadata;
}

export interface CompanyTemplateDefinition {
  schemaVersion: CompanyTemplateSchemaVersion;
  slug: string;
  version: string;
  name: string;
  description: string;
  company: CompanyTemplateCompanyDefinition;
  agents: CompanyTemplateAgentDefinition[];
  goals: CompanyTemplateGoalDefinition[];
  projects: CompanyTemplateProjectDefinition[];
  campaignTemplates: CompanyTemplateCampaignDefinition[];
  artifactContracts: CompanyTemplateArtifactContract[];
  starterIssues?: CompanyTemplateIssueDefinition[];
  metadata?: CompanyTemplateMetadata;
}

export interface CompanyTemplateSeedOptions {
  dryRun?: boolean;
  companyId?: string;
  companyName?: string;
  replaceTemplateManaged?: boolean;
  adapterOverrides?: Record<string, Record<string, unknown>>;
  metadata?: CompanyTemplateMetadata;
}

export type CompanyTemplateMaterializationActionKind = "create" | "update" | "skip" | "warn";

export interface CompanyTemplateMaterializationAction {
  kind: CompanyTemplateMaterializationActionKind;
  entityType: "company" | "agent" | "goal" | "project" | "campaign" | "campaign_phase" | "issue" | "work_product" | "artifact_contract";
  slug: string;
  label: string;
  reason?: string;
  metadata?: CompanyTemplateMetadata;
}

export interface CompanyTemplateMaterializationPlan {
  templateSlug: string;
  templateVersion: string;
  dryRun: boolean;
  actions: CompanyTemplateMaterializationAction[];
  warnings: string[];
}

export interface CompanyTemplateMaterializationResult {
  templateSlug: string;
  templateVersion: string;
  companyId?: string;
  applied: boolean;
  plan: CompanyTemplateMaterializationPlan;
  created: CompanyTemplateMaterializationAction[];
  updated: CompanyTemplateMaterializationAction[];
  skipped: CompanyTemplateMaterializationAction[];
  warnings: string[];
}
