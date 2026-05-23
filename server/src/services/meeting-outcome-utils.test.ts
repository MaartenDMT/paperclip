import { describe, expect, it } from "vitest";
import { countUnlinkedMeetingOutcomes, setMeetingOutcomeIssueId } from "./meeting-outcome-utils.js";

describe("meeting outcome utils", () => {
  it("counts only performance reviews that need unlinked follow-up", () => {
    const counts = countUnlinkedMeetingOutcomes({
      version: 1 as const,
      summaryMarkdown: "Performance reviewed.",
      decisions: [],
      actionItems: [],
      blockers: [],
      openQuestions: [],
      agentPerformanceReviews: [
        {
          agentId: "11111111-1111-4111-8111-111111111111",
          assessment: "on_track",
          summary: "No follow-up needed.",
        },
        {
          agentId: "22222222-2222-4222-8222-222222222222",
          assessment: "needs_attention",
          summary: "Needs manager follow-up.",
        },
        {
          agentId: "33333333-3333-4333-8333-333333333333",
          assessment: "on_track",
          summary: "Mostly healthy but process correction is needed.",
          corrections: ["Pair before next handoff."],
        },
        {
          agentId: "44444444-4444-4444-8444-444444444444",
          assessment: "blocked",
          summary: "Blocked but already linked.",
          issueId: "55555555-5555-4555-8555-555555555555",
        },
      ],
    });

    expect(counts.unlinkedAgentPerformanceReviews).toBe(2);
    expect(counts.unlinkedOutcomeItems).toBe(2);
  });

  it("links an outcome issue without mutating the original meeting result", () => {
    const result = {
      version: 1 as const,
      summaryMarkdown: "Operationalize action.",
      decisions: [],
      actionItems: [{ title: "Create follow-up", ownerAgentId: null, issueId: null }],
      blockers: [],
      openQuestions: [],
    };

    const linked = setMeetingOutcomeIssueId(
      result,
      "action_item",
      0,
      "55555555-5555-4555-8555-555555555555",
    );

    expect(result.actionItems[0]?.issueId).toBeNull();
    expect(linked.actionItems[0]?.issueId).toBe("55555555-5555-4555-8555-555555555555");
  });
});
