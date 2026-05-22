export interface DashboardRunActivityDay {
  date: string;
  succeeded: number;
  failed: number;
  other: number;
  total: number;
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
  | "stale_meeting";

export interface ManagerOverviewIssue {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string;
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
    activeRuns: number;
    recentMeetings: number;
    stalePendingMeetings: number;
    blockerTextWithoutEdges: number;
  };
  reports: ManagerOverviewReport[];
}
