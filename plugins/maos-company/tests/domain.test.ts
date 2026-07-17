import { describe, expect, it } from "vitest";
import { assertCampaignPhaseTransition } from "../src/campaign-policy.js";
import { buildMeetingRecommendation, meetingWorkflowPolicy } from "../src/meeting-policy.js";

describe("MAOS company automation policy", () => {
  it("allows forward campaign phase transitions and rejects invalid regressions", () => {
    expect(() => assertCampaignPhaseTransition("planning", "plan_in_review")).not.toThrow();
    expect(() => assertCampaignPhaseTransition("approved", "in_progress")).not.toThrow();
    expect(() => assertCampaignPhaseTransition("completed", "planning")).toThrow(
      "Invalid campaign phase transition: completed -> planning",
    );
  });

  it("builds deterministic meeting recommendations from a trigger", () => {
    const recommendation = buildMeetingRecommendation({
      trigger: "campaign_phase_review",
      issueId: "issue-1",
      issueIdentifier: "REA-42",
      issueTitle: "Approve launch phase",
      participantAgentIds: ["agent-2", "agent-1", "agent-2"],
    });

    expect(recommendation).toMatchObject({
      trigger: "campaign_phase_review",
      severity: "warning",
      title: "Campaign phase review: REA-42 - Approve launch phase",
      issueId: "issue-1",
      participantAgentIds: ["agent-2", "agent-1"],
    });
    expect(recommendation.agenda.length).toBeGreaterThan(0);
    expect(recommendation.expectedOutputs).toContain("decisions");
  });

  it("publishes the operating meeting lifecycle as plugin policy", () => {
    expect(meetingWorkflowPolicy.triggerRules.map((rule) => rule.id)).toContain("blocked_without_edge");
    expect(meetingWorkflowPolicy.lifecycle.map((step) => step.status)).toEqual([
      "triggered",
      "pending",
      "answered",
      "operationalized",
    ]);
  });
});
