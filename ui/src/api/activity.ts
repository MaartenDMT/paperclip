import type { ActivityEvent, HeartbeatRunSkillActivation, RunLivenessState } from "@paperclipai/shared";
import { api } from "./client";

export type { RunLivenessState } from "@paperclipai/shared";

export interface RunForIssue {
  runId: string;
  status: string;
  agentId: string;
  adapterType: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  invocationSource: string;
  usageJson: Record<string, unknown> | null;
  resultJson: Record<string, unknown> | null;
  logBytes?: number | null;
  retryOfRunId?: string | null;
  scheduledRetryAt?: string | null;
  scheduledRetryAttempt?: number;
  scheduledRetryReason?: string | null;
  retryExhaustedReason?: string | null;
  livenessState?: RunLivenessState | null;
  livenessReason?: string | null;
  continuationAttempt?: number;
  lastUsefulActionAt?: string | null;
  nextAction?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
  environment?: {
    id: string;
    name: string;
    driver: string;
  } | null;
  environmentLease?: {
    id: string;
    status: string;
    leasePolicy: string;
    provider: string | null;
    providerLeaseId: string | null;
    executionWorkspaceId: string | null;
    workspacePath: string | null;
    failureReason: string | null;
    cleanupStatus: string | null;
    acquiredAt: string | Date;
    releasedAt: string | Date | null;
  } | null;
  skillActivations?: HeartbeatRunSkillActivation[];
}

export interface IssueForRun {
  issueId: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string;
}

export interface SkillUsageSummary {
  skillKey: string;
  skillName: string;
  runCount: number;
  doneCount: number;
  blockedCount: number;
  cancelledCount: number;
  noopCount: number;
}

export interface AgentSkillUsageSummary {
  agentId: string;
  agentName: string;
  skillKey: string;
  skillName: string;
  runCount: number;
  activationCount: number;
  lastActivatedAt: string;
}

export interface AgentSkillActivation {
  id: number;
  runId: string;
  skillKey: string;
  skillName: string;
  source: string;
  activatedAt: string;
  runStatus: string;
  invocationSource: string;
  issueId: string | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  issueStatus: string | null;
}

export interface RecoveryDismissal {
  issueId: string;
  identifier: string | null;
  title: string;
  status: string;
  originId: string | null;
  parentId: string | null;
  assigneeAgentId: string | null;
  assigneeAgentName: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  createdAt: string;
  cancelledByKind: string | null;
  sourceIssue: {
    id: string;
    identifier: string | null;
    title: string;
    status: string;
  } | null;
}

export interface WakeSuppression {
  agentId: string;
  agentName: string | null;
  dismissalCount: number;
  latestDismissedAt: string;
  suppressUntil: string;
  suppressedWakeReasonPrefix: string;
}

export const activityApi = {
  list: (companyId: string, filters?: { entityType?: string; entityId?: string; agentId?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.entityType) params.set("entityType", filters.entityType);
    if (filters?.entityId) params.set("entityId", filters.entityId);
    if (filters?.agentId) params.set("agentId", filters.agentId);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return api.get<ActivityEvent[]>(`/companies/${companyId}/activity${qs ? `?${qs}` : ""}`);
  },
  skillUsage: (companyId: string) => api.get<SkillUsageSummary[]>(`/companies/${companyId}/skill-usage`),
  skillUsageByAgent: (companyId: string) =>
    api.get<AgentSkillUsageSummary[]>(`/companies/${companyId}/skill-usage/agents`),
  agentSkillActivations: (companyId: string, agentId: string, limit = 200) =>
    api.get<AgentSkillActivation[]>(`/companies/${companyId}/agents/${agentId}/skill-activations?limit=${limit}`),
  recoveryDismissals: (companyId: string) =>
    api.get<RecoveryDismissal[]>(`/companies/${companyId}/recovery-dismissals`),
  wakeSuppressions: (companyId: string) =>
    api.get<WakeSuppression[]>(`/companies/${companyId}/wake-suppressions`),
  forIssue: (issueId: string) => api.get<ActivityEvent[]>(`/issues/${issueId}/activity`),
  runsForIssue: (issueId: string) => api.get<RunForIssue[]>(`/issues/${issueId}/runs`),
  issuesForRun: (runId: string) => api.get<IssueForRun[]>(`/heartbeat-runs/${runId}/issues`),
};
