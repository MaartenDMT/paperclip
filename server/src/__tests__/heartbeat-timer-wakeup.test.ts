import { describe, expect, it } from "vitest";
import { buildTimerWakeupAssignmentContext } from "../services/heartbeat-timer-context.js";

describe("heartbeat timer wakeup context", () => {
  it("includes assigned issue identity in timer wake payloads and snapshots", () => {
    const now = new Date("2026-04-11T12:31:00.000Z");

    const result = buildTimerWakeupAssignmentContext(now, {
      id: "issue-1",
      identifier: "REA-850",
      projectId: "project-1",
      status: "backlog",
    });

    expect(result).toEqual({
      payload: {
        issueId: "issue-1",
        taskId: "issue-1",
        taskKey: "REA-850",
        projectId: "project-1",
        issueStatus: "backlog",
        source: "scheduler",
        reason: "interval_elapsed",
      },
      contextSnapshot: {
        source: "scheduler",
        reason: "interval_elapsed",
        now: "2026-04-11T12:31:00.000Z",
        issueId: "issue-1",
        taskId: "issue-1",
        taskKey: "REA-850",
        projectId: "project-1",
        issueStatus: "backlog",
      },
    });
  });

  it("keeps generic timer context when no assigned issue is available", () => {
    const now = new Date("2026-04-11T12:31:00.000Z");

    expect(buildTimerWakeupAssignmentContext(now, null)).toEqual({
      payload: null,
      contextSnapshot: {
        source: "scheduler",
        reason: "interval_elapsed",
        now: "2026-04-11T12:31:00.000Z",
      },
    });
  });
});
