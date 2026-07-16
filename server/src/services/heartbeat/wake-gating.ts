// Wake-gating / auto-checkout predicate helpers extracted from heartbeat.ts.
//
// Given a wake's context snapshot (and, where relevant, the issue's status and
// assignee), these decide whether a wake requires an issue comment, may run as
// an issue-tree interaction, should reset the task session, should auto-checkout
// the issue (and against which statuses), should queue a follow-up for a running
// issue, or hit a checkout conflict. All pure.

import { HttpError } from "../../errors.js";
import { ISSUE_TREE_CONTROL_INTERACTION_WAKE_REASONS } from "../issue-tree-control.js";
import { FINISH_SUCCESSFUL_RUN_HANDOFF_REASON, SUCCESSFUL_RUN_MISSING_STATE_REASON } from "../recovery/index.js";
import { MAX_TURN_CONTINUATION_RETRY_REASON, readNonEmptyString } from "./shared.js";
import { deriveCommentId } from "./wake-context.js";

const RUNNING_ISSUE_WAKE_REASONS_REQUIRING_FOLLOWUP = new Set(["approval_approved"]);

export function shouldRequireIssueCommentForWake(
  contextSnapshot: Record<string, unknown> | null | undefined,
) {
  const wakeReason = readNonEmptyString(contextSnapshot?.wakeReason);
  return (
    wakeReason === "issue_assigned" ||
    wakeReason === "execution_review_requested" ||
    wakeReason === "execution_approval_requested" ||
    wakeReason === "execution_changes_requested"
  );
}

export function allowsIssueInteractionWake(
  contextSnapshot: Record<string, unknown> | null | undefined,
) {
  const wakeReason = readNonEmptyString(contextSnapshot?.wakeReason);
  if (!wakeReason || !ISSUE_TREE_CONTROL_INTERACTION_WAKE_REASONS.has(wakeReason)) return false;
  return Boolean(deriveCommentId(contextSnapshot, null));
}

export function describeSessionResetReason(
  contextSnapshot: Record<string, unknown> | null | undefined,
) {
  if (contextSnapshot?.forceFreshSession === true) return "forceFreshSession was requested";

  const wakeReason = readNonEmptyString(contextSnapshot?.wakeReason);
  if (wakeReason === "issue_assigned") return "wake reason is issue_assigned";
  if (wakeReason === "execution_review_requested") return "wake reason is execution_review_requested";
  if (wakeReason === "execution_approval_requested") return "wake reason is execution_approval_requested";
  if (wakeReason === "execution_changes_requested") return "wake reason is execution_changes_requested";
  return null;
}

export function shouldAutoCheckoutIssueForWake(input: {
  contextSnapshot: Record<string, unknown> | null | undefined;
  issueStatus: string | null;
  issueAssigneeAgentId: string | null;
  isDependencyReady: boolean;
  agentId: string;
}) {
  if (input.issueAssigneeAgentId !== input.agentId) return false;
  if (!input.isDependencyReady) return false;

  const issueStatus = readNonEmptyString(input.issueStatus);
  if (
    issueStatus !== "todo" &&
    issueStatus !== "backlog" &&
    issueStatus !== "blocked" &&
    issueStatus !== "in_progress"
  ) {
    return false;
  }

  const wakeReason = readNonEmptyString(input.contextSnapshot?.wakeReason);
  if (!wakeReason) return false;
  // Comment-driven interaction wakes are allowed to run against blocked issues for
  // triage/response, but they must not implicitly take the issue out of `blocked`
  // via auto-checkout (which transitions to `in_progress` + stamps locks).
  if (issueStatus === "blocked" && ISSUE_TREE_CONTROL_INTERACTION_WAKE_REASONS.has(wakeReason)) return false;
  if (wakeReason === "issue_comment_mentioned") return false;
  if (wakeReason.startsWith("execution_")) return false;
  if (issueStatus === "in_progress" && !allowsInProgressAutoCheckoutForWake(input.contextSnapshot)) return false;

  return true;
}

export function allowsInProgressAutoCheckoutForWake(contextSnapshot: Record<string, unknown> | null | undefined) {
  const wakeReason = readNonEmptyString(contextSnapshot?.wakeReason);
  const retryReason = readNonEmptyString(contextSnapshot?.retryReason);
  return (
    contextSnapshot?.resumeIntent === true ||
    contextSnapshot?.followUpRequested === true ||
    wakeReason === FINISH_SUCCESSFUL_RUN_HANDOFF_REASON ||
    wakeReason === "issue_continuation_needed" ||
    retryReason === "issue_continuation_needed" ||
    retryReason === MAX_TURN_CONTINUATION_RETRY_REASON ||
    contextSnapshot?.handoffRequired === true ||
    readNonEmptyString(contextSnapshot?.handoffReason) === SUCCESSFUL_RUN_MISSING_STATE_REASON
  );
}

export function autoCheckoutExpectedStatusesForWake(contextSnapshot: Record<string, unknown> | null | undefined) {
  const statuses = ["todo", "backlog", "blocked"];
  if (allowsInProgressAutoCheckoutForWake(contextSnapshot)) statuses.push("in_progress");
  return statuses;
}

export function shouldQueueFollowupForRunningIssueWake(input: {
  contextSnapshot: Record<string, unknown> | null | undefined;
  wakeCommentId: string | null;
}) {
  if (input.wakeCommentId) return true;
  const wakeReason = readNonEmptyString(input.contextSnapshot?.wakeReason);
  return Boolean(wakeReason && RUNNING_ISSUE_WAKE_REASONS_REQUIRING_FOLLOWUP.has(wakeReason));
}

export function isCheckoutConflictError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 409 && error.message === "Issue checkout conflict";
}
