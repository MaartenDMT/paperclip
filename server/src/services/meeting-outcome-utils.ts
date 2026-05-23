import type { AgentMeetingExpectedOutput, AgentMeetingResult } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";

export type MeetingOutcomeLinkType =
  | "action_item"
  | "blocker"
  | "workflow_correction"
  | "memory_correction"
  | "idea"
  | "agent_performance_review";

export function readIssueIdsFromMeetingResult(result: AgentMeetingResult | null) {
  if (!result) return [];
  const ids = [
    ...result.actionItems.map((item) => item.issueId ?? null),
    ...result.blockers.map((blocker) => blocker.issueId ?? null),
    ...(result.workflowCorrections ?? []).map((correction) => correction.issueId ?? null),
    ...(result.memoryCorrections ?? []).map((correction) => correction.issueId ?? null),
    ...(result.ideas ?? []).map((idea) => idea.issueId ?? null),
    ...(result.agentPerformanceReviews ?? []).map((review) => review.issueId ?? null),
  ];
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
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
  const next: AgentMeetingResult = {
    ...result,
    actionItems: result.actionItems.map((item) => ({ ...item })),
    blockers: result.blockers.map((blocker) => ({ ...blocker })),
    workflowCorrections: result.workflowCorrections?.map((correction) => ({ ...correction })),
    memoryCorrections: result.memoryCorrections?.map((correction) => ({ ...correction })),
    ideas: result.ideas?.map((idea) => ({ ...idea })),
    agentPerformanceReviews: result.agentPerformanceReviews?.map((review) => ({ ...review })),
  };
  const update = (items: Array<{ issueId?: string | null }> | undefined, label: string) => {
    const item = items?.[index];
    if (!item) {
      throw unprocessable(`Meeting ${label} outcome was not found`, { outcomeType, index });
    }
    if (item.issueId && item.issueId !== issueId) {
      throw unprocessable(`Meeting ${label} outcome is already linked to another issue`, {
        outcomeType,
        index,
        existingIssueId: item.issueId,
      });
    }
    item.issueId = issueId;
  };

  if (outcomeType === "action_item") update(next.actionItems, "action item");
  else if (outcomeType === "blocker") update(next.blockers, "blocker");
  else if (outcomeType === "workflow_correction") update(next.workflowCorrections, "workflow correction");
  else if (outcomeType === "memory_correction") update(next.memoryCorrections, "memory correction");
  else if (outcomeType === "idea") update(next.ideas, "idea");
  else update(next.agentPerformanceReviews, "agent performance review");
  return next;
}

export function countUnlinkedMeetingOutcomes(result: AgentMeetingResult | null) {
  const unlinkedActionItems = result?.actionItems.filter((item) => !item.issueId).length ?? 0;
  const unlinkedBlockers = result?.blockers.filter((blocker) => !blocker.issueId).length ?? 0;
  const unlinkedWorkflowCorrections =
    result?.workflowCorrections?.filter((correction) => !correction.issueId).length ?? 0;
  const unlinkedMemoryCorrections =
    result?.memoryCorrections?.filter((correction) => !correction.issueId).length ?? 0;
  const unlinkedIdeas = result?.ideas?.filter((idea) => !idea.issueId).length ?? 0;
  const unlinkedAgentPerformanceReviews =
    result?.agentPerformanceReviews?.filter((review) => {
      const needsFollowUp =
        review.assessment === "at_risk" ||
        review.assessment === "blocked" ||
        review.assessment === "needs_attention" ||
        (review.corrections?.length ?? 0) > 0;
      return needsFollowUp && !review.issueId;
    }).length ?? 0;
  const unlinkedOutcomeItems =
    unlinkedActionItems +
    unlinkedBlockers +
    unlinkedWorkflowCorrections +
    unlinkedMemoryCorrections +
    unlinkedIdeas +
    unlinkedAgentPerformanceReviews;
  return {
    unlinkedActionItems,
    unlinkedBlockers,
    unlinkedWorkflowCorrections,
    unlinkedMemoryCorrections,
    unlinkedIdeas,
    unlinkedAgentPerformanceReviews,
    unlinkedOutcomeItems,
  };
}

export function validateBusinessMeetingResult(input: {
  result: AgentMeetingResult;
  expectedOutputs: AgentMeetingExpectedOutput[];
  participantAgentIds: string[];
}) {
  const expectedOutputs = new Set(input.expectedOutputs);
  const requiresBusinessReview =
    expectedOutputs.has("business_requirements") ||
    expectedOutputs.has("goals") ||
    expectedOutputs.has("targets") ||
    expectedOutputs.has("kpis") ||
    expectedOutputs.has("finance");
  if (requiresBusinessReview && !input.result.businessReview) {
    throw unprocessable("Meeting result must include businessReview for business operating meetings", {
      expectedOutputs: input.expectedOutputs,
    });
  }

  if (!expectedOutputs.has("agent_performance")) return;
  const participantAgentIds = [...new Set(input.participantAgentIds)];
  const reviews = input.result.agentPerformanceReviews ?? [];
  if (participantAgentIds.length === 0) return;
  if (reviews.length === 0) {
    throw unprocessable("Meeting result must include agentPerformanceReviews for business operating meetings", {
      participantAgentIds,
    });
  }
  const participantSet = new Set(participantAgentIds);
  const reviewedAgentIds = new Set(reviews.map((review) => review.agentId));
  const missingAgentIds = participantAgentIds.filter((agentId) => !reviewedAgentIds.has(agentId));
  if (missingAgentIds.length > 0) {
    throw unprocessable("Meeting result must review every meeting participant", {
      missingAgentIds,
    });
  }
  const nonParticipantAgentIds = [...reviewedAgentIds].filter((agentId) => !participantSet.has(agentId));
  if (nonParticipantAgentIds.length > 0) {
    throw unprocessable("Meeting result includes performance reviews for non-participants", {
      nonParticipantAgentIds,
    });
  }
}
