import { describe, expect, it } from "vitest";
import { classifyManagerIssueWorkload, summarizeManagerIssueWorkload } from "./dashboard.js";

describe("manager workload classification", () => {
  it("separates coordination issues from executable work and manager-held delegation bottlenecks", () => {
    const ctoId = "cto-1";
    const engineerId = "engineer-1";
    const childManagerId = "qa-lead-1";

    const issues = [
      {
        id: "routine-1",
        assigneeAgentId: ctoId,
        originKind: "routine_execution",
      },
      {
        id: "manager-exec-1",
        assigneeAgentId: ctoId,
        originKind: "manual",
      },
      {
        id: "delegated-1",
        assigneeAgentId: engineerId,
        originKind: "manual",
      },
      {
        id: "lead-without-reports-1",
        assigneeAgentId: childManagerId,
        originKind: "manual",
      },
    ];

    expect(classifyManagerIssueWorkload(issues[0]!)).toBe("coordination");
    expect(classifyManagerIssueWorkload(issues[1]!)).toBe("execution");

    expect(summarizeManagerIssueWorkload({
      issues,
      reportAgentId: ctoId,
      descendantAgentIds: [ctoId, engineerId, childManagerId],
      managerAgentIds: new Set([ctoId]),
    })).toEqual({
      executableIssues: 3,
      coordinationIssues: 1,
      managerHeldExecutableIssues: 1,
      delegatedExecutableIssues: 2,
    });
  });
});
