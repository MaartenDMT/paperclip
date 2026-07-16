export type TimerWakeAssignedIssue = {
  id: string;
  identifier: string | null;
  projectId: string | null;
  status: string;
};

export function buildTimerWakeupAssignmentContext(
  now: Date,
  assignedIssue: TimerWakeAssignedIssue | null,
) {
  const contextSnapshot: Record<string, unknown> = {
    source: "scheduler",
    reason: "interval_elapsed",
    now: now.toISOString(),
  };
  if (!assignedIssue) {
    return { payload: null, contextSnapshot };
  }

  const taskKey = assignedIssue.identifier ?? assignedIssue.id;
  const assignmentContext = {
    issueId: assignedIssue.id,
    taskId: assignedIssue.id,
    taskKey,
    projectId: assignedIssue.projectId,
    issueStatus: assignedIssue.status,
  };

  return {
    payload: {
      ...assignmentContext,
      source: "scheduler",
      reason: "interval_elapsed",
    },
    contextSnapshot: {
      ...contextSnapshot,
      ...assignmentContext,
    },
  };
}
