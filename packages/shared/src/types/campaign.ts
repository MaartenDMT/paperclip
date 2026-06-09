import type { CampaignPhaseStatus, CampaignStatus } from "../constants.js";
import type { IssuePriority, IssueStatus } from "../constants.js";
import type { Approval } from "./approval.js";

export interface CampaignProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  color: string | null;
}

export interface CampaignAgentSummary {
  id: string;
  name: string;
  role: string;
  title: string | null;
  icon?: string | null;
  urlKey?: string | null;
}

export interface CampaignIssueSummary {
  id: string;
  identifier: string | null;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  updatedAt: Date;
}

export interface CampaignPhaseTaskProgress {
  source: "execution_issue" | "subtree";
  totalCount: number;
  openCount: number;
  completedCount: number;
  cancelledCount: number;
  statusCounts: Record<IssueStatus, number>;
  nextIssues: CampaignIssueSummary[];
}

export interface CampaignDocumentSummary {
  id: string;
  title: string | null;
  format: "markdown";
  latestBody: string;
  latestRevisionId: string | null;
  latestRevisionNumber: number;
  updatedAt: Date;
}

export interface CampaignDocumentRevision {
  id: string;
  companyId: string;
  documentId: string;
  revisionNumber: number;
  title: string | null;
  format: "markdown";
  body: string;
  changeSummary: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface Campaign {
  id: string;
  companyId: string;
  goalId: string | null;
  leadAgentId: string | null;
  title: string;
  objective: string | null;
  status: CampaignStatus;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  updatedByAgentId: string | null;
  updatedByUserId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignPhase {
  id: string;
  companyId: string;
  campaignId: string;
  sequenceNumber: number;
  title: string;
  objective: string | null;
  status: CampaignPhaseStatus;
  planDocumentId: string | null;
  resultDocumentId: string | null;
  approvalId: string | null;
  approvedPlanRevisionId: string | null;
  executionIssueId: string | null;
  assigneeAgentId: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  updatedByAgentId: string | null;
  updatedByUserId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignPhaseDetail extends CampaignPhase {
  assignee: CampaignAgentSummary | null;
  planDocument: CampaignDocumentSummary | null;
  resultDocument: CampaignDocumentSummary | null;
  approval: Approval | null;
  executionIssue: CampaignIssueSummary | null;
  taskProgress: CampaignPhaseTaskProgress | null;
}

export interface CampaignListItem extends Campaign {
  projects: CampaignProjectSummary[];
  leadAgent: CampaignAgentSummary | null;
  phaseCount: number;
  activePhase: CampaignPhaseDetail | null;
  pendingReviewCount: number;
}

export interface CampaignDetail extends CampaignListItem {
  phases: CampaignPhaseDetail[];
}

export interface CampaignPhasePlanApprovalPayload {
  kind: "campaign_phase_plan";
  campaignId: string;
  campaignTitle: string;
  phaseId: string;
  phaseTitle: string;
  planDocumentId: string;
  planRevisionId: string;
  assigneeAgentId: string | null;
  projectIds: string[];
}

export interface CampaignPhasePlanSubmission {
  phase: CampaignPhaseDetail;
  approval: Approval;
  planRevision: CampaignDocumentRevision;
}
