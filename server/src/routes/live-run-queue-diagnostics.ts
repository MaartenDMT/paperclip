import { effectiveMaxConcurrentRunsForQueuedBacklog } from "../services/heartbeat-backlog-concurrency.js";

export type LiveRunQueueDiagnosticCode =
  | "issue_not_found"
  | "issue_terminal"
  | "issue_blocked"
  | "issue_assignee_changed"
  | "waiting_for_agent_slot"
  | "waiting_for_local_capacity"
  | "waiting_for_scheduler";

export type LiveRunQueueDiagnostic = {
  code: LiveRunQueueDiagnosticCode;
  label: string;
  detail: string;
};

type LiveRunQueueDiagnosticRun = {
  status: string;
  agentId: string;
  issueId?: string | null;
};

type LiveRunQueueDiagnosticIssue = {
  id: string;
  status: string;
  assigneeAgentId?: string | null;
};

const TERMINAL_ISSUE_STATUSES = new Set(["done", "cancelled"]);

export function buildLiveRunQueueDiagnostic(
  run: LiveRunQueueDiagnosticRun,
  opts: {
    issue?: LiveRunQueueDiagnosticIssue | null;
    runningRunsForAgent: number;
    queuedRunsForAgent?: number;
    maxConcurrentRunsForAgent?: number;
    runningRunsTotal?: number;
    maxLocalActiveRunExecutions?: number;
  },
): LiveRunQueueDiagnostic | null {
  if (run.status !== "queued") return null;

  if (run.issueId) {
    if (!opts.issue) {
      return {
        code: "issue_not_found",
        label: "Issue missing",
        detail: "The queued wake points at an issue that no longer exists.",
      };
    }

    if (TERMINAL_ISSUE_STATUSES.has(opts.issue.status)) {
      return {
        code: "issue_terminal",
        label: "Issue already closed",
        detail: `The target issue is ${opts.issue.status}; the queued wake is waiting for stale-run cleanup.`,
      };
    }

    if (opts.issue.assigneeAgentId && opts.issue.assigneeAgentId !== run.agentId) {
      return {
        code: "issue_assignee_changed",
        label: "Assignee changed",
        detail: "The target issue is no longer assigned to this agent; the queued wake is waiting for stale-run cleanup.",
      };
    }

    if (opts.issue.status === "blocked") {
      return {
        code: "issue_blocked",
        label: "Issue blocked",
        detail: "The target issue is blocked, so this wake will not start until the scheduler reconciles it.",
      };
    }
  }

  const effectiveMaxConcurrentRuns = effectiveMaxConcurrentRunsForQueuedBacklog(
    opts.maxConcurrentRunsForAgent ?? 1,
    opts.queuedRunsForAgent ?? 0,
  );
  if (opts.runningRunsForAgent >= effectiveMaxConcurrentRuns) {
    return {
      code: "waiting_for_agent_slot",
      label: "Agent busy",
      detail: `This agent already has ${opts.runningRunsForAgent} running heartbeat${opts.runningRunsForAgent === 1 ? "" : "s"} and is limited by its per-agent concurrency of ${effectiveMaxConcurrentRuns}.`,
    };
  }

  if (
    typeof opts.runningRunsTotal === "number" &&
    typeof opts.maxLocalActiveRunExecutions === "number" &&
    opts.runningRunsTotal >= opts.maxLocalActiveRunExecutions
  ) {
    return {
      code: "waiting_for_local_capacity",
      label: "Local capacity full",
      detail: `All ${opts.maxLocalActiveRunExecutions} local execution slots are active; this wake will start when one frees up.`,
    };
  }

  return {
    code: "waiting_for_scheduler",
    label: "Waiting for scheduler",
    detail: "The wake is queued and ready for the next scheduler slot.",
  };
}
