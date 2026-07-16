import { describe, expect, it } from "vitest";
import { isMeetingWorkflowWakeContext } from "./heartbeat-wake-context.js";

describe("heartbeat wake context classification", () => {
  it("treats first-class meeting workflow wakes as issue-context wakes", () => {
    expect(
      isMeetingWorkflowWakeContext({
        issueId: "issue-1",
        meetingId: "meeting-1",
        interactionId: "meeting-1",
        interactionKind: "agent_meeting",
        wakeReason: "agent_meeting_requested",
        source: "meeting_workflow.periodic",
      }),
    ).toBe(true);
  });

  it("does not treat ordinary issue assignment wakes as meeting workflow wakes", () => {
    expect(
      isMeetingWorkflowWakeContext({
        issueId: "issue-1",
        wakeReason: "issue_assigned",
      }),
    ).toBe(false);
  });

  it("requires both a meeting id and the meeting wake reason", () => {
    expect(
      isMeetingWorkflowWakeContext({
        issueId: "issue-1",
        wakeReason: "agent_meeting_requested",
        source: "meeting_workflow.periodic",
      }),
    ).toBe(false);

    expect(
      isMeetingWorkflowWakeContext({
        issueId: "issue-1",
        meetingId: "meeting-1",
        wakeReason: "issue_assigned",
        source: "meeting_workflow.periodic",
      }),
    ).toBe(false);
  });
});
