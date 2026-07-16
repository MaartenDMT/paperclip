import { describe, expect, it } from "vitest";
import { buildLiveRunQueueDiagnostic } from "./live-run-queue-diagnostics.js";

describe("buildLiveRunQueueDiagnostic", () => {
  it("explains queued runs waiting behind an active run for the same agent", () => {
    expect(
      buildLiveRunQueueDiagnostic(
        { status: "queued", agentId: "agent-1", issueId: null },
        { issue: null, runningRunsForAgent: 1 },
      ),
    ).toMatchObject({
      code: "waiting_for_agent_slot",
      label: "Agent busy",
    });
  });

  it("prioritizes stale issue diagnostics over generic scheduler waiting", () => {
    expect(
      buildLiveRunQueueDiagnostic(
        { status: "queued", agentId: "agent-1", issueId: "issue-1" },
        {
          issue: { id: "issue-1", status: "blocked", assigneeAgentId: "agent-1" },
          runningRunsForAgent: 0,
        },
      ),
    ).toMatchObject({
      code: "issue_blocked",
      label: "Issue blocked",
    });
  });

  it("does not attach queue diagnostics to running runs", () => {
    expect(
      buildLiveRunQueueDiagnostic(
        { status: "running", agentId: "agent-1", issueId: "issue-1" },
        {
          issue: { id: "issue-1", status: "in_progress", assigneeAgentId: "agent-1" },
          runningRunsForAgent: 1,
        },
      ),
    ).toBeNull();
  });
});
