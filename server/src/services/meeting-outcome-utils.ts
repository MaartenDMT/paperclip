import { agentMeetingResultSchema, type AgentMeetingExpectedOutput, type AgentMeetingResult } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";

export type MeetingOutcomeLinkType =
  | "action_item"
  | "blocker"
  | "workflow_correction"
  | "memory_correction"
  | "idea"
  | "agent_performance_review";

const outcomeCollections = {
  action_item: ["actionItems", "action item"],
  blocker: ["blockers", "blocker"],
  workflow_correction: ["workflowCorrections", "workflow correction"],
  memory_correction: ["memoryCorrections", "memory correction"],
  idea: ["ideas", "idea"],
  agent_performance_review: ["agentPerformanceReviews", "agent performance review"],
} as const;

type OutcomeCollectionKey = (typeof outcomeCollections)[MeetingOutcomeLinkType][0];
type LinkableOutcome = { issueId?: string | null };

export function parseStoredMeetingResult(result: unknown): AgentMeetingResult | null {
  if (!result) return null;
  const parsed = agentMeetingResultSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

function linkableOutcomes(result: AgentMeetingResult | null): LinkableOutcome[] {
  if (!result) return [];
  return Object.values(outcomeCollections).flatMap(([key]) =>
    ((result[key as OutcomeCollectionKey] ?? []) as LinkableOutcome[]),
  );
}

export function readIssueIdsFromMeetingResult(result: AgentMeetingResult | null) {
  return [...new Set(linkableOutcomes(result).flatMap((item) => item.issueId ? [item.issueId] : []))];
}

export function setMeetingOutcomeIssueId(
  result: AgentMeetingResult,
  outcomeType: MeetingOutcomeLinkType,
  index: number,
  issueId: string,
): AgentMeetingResult {
  if (!Number.isInteger(index) || index < 0) {
    throw unprocessable("Meeting outcome index must be a non-negative integer");
  }
  const [key, label] = outcomeCollections[outcomeType];
  const items = ((result[key] ?? []) as LinkableOutcome[]).map((item) => ({ ...item }));
  const item = items[index];
  if (!item) throw unprocessable(`Meeting ${label} outcome was not found`, { outcomeType, index });
  if (item.issueId && item.issueId !== issueId) {
    throw unprocessable(`Meeting ${label} outcome is already linked to another issue`, {
      outcomeType,
      index,
      existingIssueId: item.issueId,
    });
  }
  item.issueId = issueId;
  return { ...result, [key]: items } as AgentMeetingResult;
}

export function countUnlinkedMeetingOutcomes(result: AgentMeetingResult | null) {
  const count = (key: OutcomeCollectionKey) =>
    ((result?.[key] ?? []) as LinkableOutcome[]).filter((item) => !item.issueId).length;
  const unlinkedActionItems = count("actionItems");
  const unlinkedBlockers = count("blockers");
  const unlinkedWorkflowCorrections = count("workflowCorrections");
  const unlinkedMemoryCorrections = count("memoryCorrections");
  const unlinkedIdeas = count("ideas");
  const unlinkedAgentPerformanceReviews = (result?.agentPerformanceReviews ?? []).filter((review) =>
    !review.issueId && (
      ["at_risk", "blocked", "needs_attention"].includes(review.assessment) ||
      (review.corrections?.length ?? 0) > 0
    ),
  ).length;
  return {
    unlinkedActionItems,
    unlinkedBlockers,
    unlinkedWorkflowCorrections,
    unlinkedMemoryCorrections,
    unlinkedIdeas,
    unlinkedAgentPerformanceReviews,
    unlinkedOutcomeItems:
      unlinkedActionItems + unlinkedBlockers + unlinkedWorkflowCorrections +
      unlinkedMemoryCorrections + unlinkedIdeas + unlinkedAgentPerformanceReviews,
  };
}

export function validateBusinessMeetingResult(input: {
  result: AgentMeetingResult;
  expectedOutputs: AgentMeetingExpectedOutput[];
  participantAgentIds: string[];
}) {
  const expected = new Set(input.expectedOutputs);
  if (["business_requirements", "goals", "targets", "kpis", "finance"].some((key) => expected.has(key as AgentMeetingExpectedOutput)) && !input.result.businessReview) {
    throw unprocessable("Meeting result must include businessReview for business operating meetings", {
      expectedOutputs: input.expectedOutputs,
    });
  }
  if (!expected.has("agent_performance")) return;
  const participants = [...new Set(input.participantAgentIds)];
  if (participants.length === 0) return;
  const reviews = input.result.agentPerformanceReviews ?? [];
  if (reviews.length === 0) {
    throw unprocessable("Meeting result must include agentPerformanceReviews for business operating meetings", {
      participantAgentIds: participants,
    });
  }
  const reviewed = new Set(reviews.map((review) => review.agentId));
  const missingAgentIds = participants.filter((agentId) => !reviewed.has(agentId));
  if (missingAgentIds.length > 0) {
    throw unprocessable("Meeting result must review every meeting participant", { missingAgentIds });
  }
  const participantSet = new Set(participants);
  const nonParticipantAgentIds = [...reviewed].filter((agentId) => !participantSet.has(agentId));
  if (nonParticipantAgentIds.length > 0) {
    throw unprocessable("Meeting result includes performance reviews for non-participants", { nonParticipantAgentIds });
  }
}
