import { describe, expect, it } from "vitest";
import { buildLiveRunQueueDiagnostic } from "../routes/live-run-queue-diagnostics.ts";

describe("buildLiveRunQueueDiagnostic", () => {
  it("keeps a queued run waiting on the agent slot below the backlog burst threshold", () => {
    const diagnostic = buildLiveRunQueueDiagnostic(
      {
        status: "queued",
        agentId: "agent-queued",
        issueId: null,
      },
      {
        runningRunsForAgent: 1,
        queuedRunsForAgent: 2,
        maxConcurrentRunsForAgent: 1,
      },
    );

    expect(diagnostic).toMatchObject({
      code: "waiting_for_agent_slot",
      label: "Agent busy",
    });
  });

  it("stops reporting agent busy when backlog burst capacity can start another run", () => {
    const diagnostic = buildLiveRunQueueDiagnostic(
      {
        status: "queued",
        agentId: "agent-queued",
        issueId: null,
      },
      {
        runningRunsForAgent: 1,
        queuedRunsForAgent: 3,
        maxConcurrentRunsForAgent: 1,
      },
    );

    expect(diagnostic).toMatchObject({
      code: "waiting_for_scheduler",
      label: "Waiting for scheduler",
    });
  });

  it("explains queued runs waiting on local execution capacity", () => {
    const diagnostic = buildLiveRunQueueDiagnostic(
      {
        status: "queued",
        agentId: "agent-queued",
        issueId: null,
      },
      {
        runningRunsForAgent: 0,
        runningRunsTotal: 6,
        maxLocalActiveRunExecutions: 6,
      },
    );

    expect(diagnostic).toMatchObject({
      code: "waiting_for_local_capacity",
      label: "Local capacity full",
    });
  });
});
