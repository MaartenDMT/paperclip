// Run-summary helpers extracted from heartbeat.ts.
//
// These distill a heartbeat run / context snapshot into compact summaries for
// the board and issue threads: the whitelisted context-snapshot fields, the
// list-result JSON (text fields + parsed costs), a one-line failure summary for
// issue comments, and whether an automatic recovery attempt ultimately failed.
// All pure.

import { heartbeatRuns } from "@paperclipai/db";
import { parseObject } from "../../adapters/utils.js";
import { readNonEmptyString } from "./shared.js";

const UNSUCCESSFUL_HEARTBEAT_RUN_TERMINAL_STATUSES = ["failed", "cancelled", "timed_out"] as const;

export function summarizeHeartbeatRunContextSnapshot(
  contextSnapshot: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const summary: Record<string, unknown> = {};
  const allowedKeys = [
    "issueId",
    "taskId",
    "taskKey",
    "commentId",
    "wakeCommentId",
    "wakeReason",
    "wakeSource",
    "wakeTriggerDetail",
    "modelProfile",
  ] as const;

  for (const key of allowedKeys) {
    const value = readNonEmptyString(contextSnapshot?.[key]);
    if (value) summary[key] = value;
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

export function summarizeHeartbeatRunListResultJson(input: {
  summary?: string | null;
  result?: string | null;
  message?: string | null;
  error?: string | null;
  totalCostUsd?: string | null;
  costUsd?: string | null;
  costUsdCamel?: string | null;
}): Record<string, unknown> | null {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of [
    ["summary", input.summary],
    ["result", input.result],
    ["message", input.message],
    ["error", input.error],
  ] as const) {
    const normalized = readNonEmptyString(value);
    if (normalized) summary[key] = normalized;
  }

  for (const [key, value] of [
    ["total_cost_usd", input.totalCostUsd],
    ["cost_usd", input.costUsd],
    ["costUsd", input.costUsdCamel],
  ] as const) {
    const normalized = readNonEmptyString(value);
    if (!normalized) continue;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) summary[key] = parsed;
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

export function summarizeRunFailureForIssueComment(
  run: Pick<typeof heartbeatRuns.$inferSelect, "error" | "errorCode"> | null | undefined,
) {
  if (!run) return null;

  const errorCode = readNonEmptyString(run.errorCode)?.trim() ?? null;
  const rawError = readNonEmptyString(run.error)?.trim() ?? null;
  const apiMessageMatch = rawError?.match(/"message"\s*:\s*"([^"]+)"/);
  const firstLine = rawError
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;
  const summarySource = apiMessageMatch?.[1] ?? firstLine;
  const summary =
    summarySource && summarySource.length > 240
      ? `${summarySource.slice(0, 237)}...`
      : summarySource;

  if (errorCode && summary) return ` Latest retry failure: \`${errorCode}\` - ${summary}.`;
  if (errorCode) return ` Latest retry failure: \`${errorCode}\`.`;
  if (summary) return ` Latest retry failure: ${summary}.`;
  return null;
}

export function didAutomaticRecoveryFail(
  latestRun: Pick<typeof heartbeatRuns.$inferSelect, "status" | "contextSnapshot"> | null,
  expectedRetryReason: "assignment_recovery" | "issue_continuation_needed",
) {
  if (!latestRun) return false;

  const latestContext = parseObject(latestRun.contextSnapshot);
  const latestRetryReason = readNonEmptyString(latestContext.retryReason);
  return (
    latestRetryReason === expectedRetryReason &&
    UNSUCCESSFUL_HEARTBEAT_RUN_TERMINAL_STATUSES.includes(
      latestRun.status as (typeof UNSUCCESSFUL_HEARTBEAT_RUN_TERMINAL_STATUSES)[number],
    )
  );
}
