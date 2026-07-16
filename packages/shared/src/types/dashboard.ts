export interface DashboardRunActivityDay {
  date: string;
  succeeded: number;
  /**
   * True failures for the day, excluding process-loss/restart kills that were
   * later recovered by a successful retry (those are surfaced in `recovered`).
   */
  failed: number;
  /**
   * Runs that terminated in a failure state (failed/timed_out) but whose retry
   * chain eventually succeeded — e.g. restart-killed runs that recovered. Kept
   * out of `failed` so the headline failure count reflects true, unrecovered
   * failures.
   */
  recovered: number;
  other: number;
  total: number;
  /**
   * Per-error-code breakdown of the (true) `failed` count for the day, so a
   * spike can be attributed to an error class (e.g. `process_lost`,
   * `provider_quota`, `workspace_validation_failed`). Recovered runs are not
   * included here. Runs with no error code are bucketed under `unknown`.
   */
  failedByErrorCode: Record<string, number>;
}

export interface DashboardSummary {
  companyId: string;
  agents: {
    active: number;
    running: number;
    paused: number;
    error: number;
  };
  tasks: {
    open: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
  costs: {
    monthSpendCents: number;
    monthBudgetCents: number;
    monthUtilizationPercent: number;
  };
  pendingApprovals: number;
  budgets: {
    activeIncidents: number;
    pendingApprovals: number;
    pausedAgents: number;
    pausedProjects: number;
  };
  runActivity: DashboardRunActivityDay[];
}

export type ManagerOverviewAttention =
  | "agent_paused"
  | "agent_error"
  | "multiple_active_runs"
  | "blocked_work"
  | "blocked_without_first_class_blocker"
  | "review_waiting"
  | "stale_meeting"
  | "manager_implementation_load";

export type ManagerOverviewIssueWorkloadKind = "execution" | "coordination";

export interface ManagerOverviewIssue {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string;
  workloadKind: ManagerOverviewIssueWorkloadKind;
  updatedAt: Date | string;
}

export interface ManagerOverviewMeeting {
  id: string;
  issueId: string;
  issueIdentifier: string | null;
  title: string | null;
  purpose: string;
  status: string;
  participantAgentIds: string[];
  pendingAgeHours: number | null;
  createdAt: Date | string;
}

export interface ManagerOverviewAgent {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title: string | null;
  status: string;
  reportsTo: string | null;
}

export interface ManagerOverviewReport {
  agent: ManagerOverviewAgent;
  counts: {
    openIssues: number;
    todoIssues: number;
    inProgressIssues: number;
    inReviewIssues: number;
    blockedIssues: number;
    executableIssues: number;
    coordinationIssues: number;
    managerHeldExecutableIssues: number;
    delegatedExecutableIssues: number;
    activeRuns: number;
    recentMeetings: number;
    stalePendingMeetings: number;
    blockerTextWithoutEdges: number;
  };
  attention: ManagerOverviewAttention[];
  recentIssues: ManagerOverviewIssue[];
  recentMeetings: ManagerOverviewMeeting[];
}

export interface ManagerOverview {
  companyId: string;
  manager: ManagerOverviewAgent;
  rollup: {
    directReports: number;
    openIssues: number;
    todoIssues: number;
    inProgressIssues: number;
    inReviewIssues: number;
    blockedIssues: number;
    executableIssues: number;
    coordinationIssues: number;
    managerHeldExecutableIssues: number;
    delegatedExecutableIssues: number;
    activeRuns: number;
    recentMeetings: number;
    stalePendingMeetings: number;
    blockerTextWithoutEdges: number;
  };
  reports: ManagerOverviewReport[];
}
