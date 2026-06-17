// Drizzle column-selection maps for heartbeat-run queries, extracted from
// heartbeat.ts. These define the projections used by the run list/detail/log
// queries, including JSON-extracted context fields and a size-bounded "safe"
// resultJson column that truncates oversized payloads at the database.

import { getTableColumns, sql } from "drizzle-orm";
import { heartbeatRuns } from "@paperclipai/db";
import {
  HEARTBEAT_RUN_RESULT_OUTPUT_MAX_CHARS,
  HEARTBEAT_RUN_RESULT_SUMMARY_MAX_CHARS,
  HEARTBEAT_RUN_SAFE_RESULT_JSON_MAX_BYTES,
} from "../heartbeat-run-summary.js";

export const heartbeatRunProcessGroupIdColumn =
  heartbeatRuns.processGroupId ?? sql<number | null>`NULL`.as("processGroupId");

export const heartbeatRunListColumns = {
  id: heartbeatRuns.id,
  companyId: heartbeatRuns.companyId,
  agentId: heartbeatRuns.agentId,
  invocationSource: heartbeatRuns.invocationSource,
  triggerDetail: heartbeatRuns.triggerDetail,
  status: heartbeatRuns.status,
  startedAt: heartbeatRuns.startedAt,
  finishedAt: heartbeatRuns.finishedAt,
  error: heartbeatRuns.error,
  wakeupRequestId: heartbeatRuns.wakeupRequestId,
  exitCode: heartbeatRuns.exitCode,
  signal: heartbeatRuns.signal,
  usageJson: heartbeatRuns.usageJson,
  sessionIdBefore: heartbeatRuns.sessionIdBefore,
  sessionIdAfter: heartbeatRuns.sessionIdAfter,
  logStore: heartbeatRuns.logStore,
  logRef: heartbeatRuns.logRef,
  logBytes: heartbeatRuns.logBytes,
  logSha256: heartbeatRuns.logSha256,
  logCompressed: heartbeatRuns.logCompressed,
  stdoutExcerpt: sql<string | null>`NULL`.as("stdoutExcerpt"),
  stderrExcerpt: sql<string | null>`NULL`.as("stderrExcerpt"),
  errorCode: heartbeatRuns.errorCode,
  externalRunId: heartbeatRuns.externalRunId,
  processPid: heartbeatRuns.processPid,
  processGroupId: heartbeatRunProcessGroupIdColumn,
  processStartedAt: heartbeatRuns.processStartedAt,
  lastOutputAt: heartbeatRuns.lastOutputAt,
  lastOutputSeq: heartbeatRuns.lastOutputSeq,
  lastOutputStream: heartbeatRuns.lastOutputStream,
  lastOutputBytes: heartbeatRuns.lastOutputBytes,
  retryOfRunId: heartbeatRuns.retryOfRunId,
  processLossRetryCount: heartbeatRuns.processLossRetryCount,
  scheduledRetryAt: heartbeatRuns.scheduledRetryAt,
  scheduledRetryAttempt: heartbeatRuns.scheduledRetryAttempt,
  scheduledRetryReason: heartbeatRuns.scheduledRetryReason,
  livenessState: heartbeatRuns.livenessState,
  livenessReason: heartbeatRuns.livenessReason,
  continuationAttempt: heartbeatRuns.continuationAttempt,
  lastUsefulActionAt: heartbeatRuns.lastUsefulActionAt,
  nextAction: heartbeatRuns.nextAction,
  createdAt: heartbeatRuns.createdAt,
  updatedAt: heartbeatRuns.updatedAt,
} as const;

export const heartbeatRunListContextColumns = {
  contextIssueId: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'issueId'`.as("contextIssueId"),
  contextTaskId: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'taskId'`.as("contextTaskId"),
  contextTaskKey: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'taskKey'`.as("contextTaskKey"),
  contextCommentId: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'commentId'`.as("contextCommentId"),
  contextWakeCommentId: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'wakeCommentId'`.as("contextWakeCommentId"),
  contextWakeReason: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'wakeReason'`.as("contextWakeReason"),
  contextWakeSource: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'wakeSource'`.as("contextWakeSource"),
  contextWakeTriggerDetail: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'wakeTriggerDetail'`.as("contextWakeTriggerDetail"),
} as const;

export const heartbeatRunListResultColumns = {
  resultSummary: sql<string | null>`left(${heartbeatRuns.resultJson} ->> 'summary', ${HEARTBEAT_RUN_RESULT_SUMMARY_MAX_CHARS})`.as("resultSummary"),
  resultResult: sql<string | null>`left(${heartbeatRuns.resultJson} ->> 'result', ${HEARTBEAT_RUN_RESULT_SUMMARY_MAX_CHARS})`.as("resultResult"),
  resultMessage: sql<string | null>`left(${heartbeatRuns.resultJson} ->> 'message', ${HEARTBEAT_RUN_RESULT_SUMMARY_MAX_CHARS})`.as("resultMessage"),
  resultError: sql<string | null>`left(${heartbeatRuns.resultJson} ->> 'error', ${HEARTBEAT_RUN_RESULT_SUMMARY_MAX_CHARS})`.as("resultError"),
  resultTotalCostUsd: sql<string | null>`${heartbeatRuns.resultJson} ->> 'total_cost_usd'`.as("resultTotalCostUsd"),
  resultCostUsd: sql<string | null>`${heartbeatRuns.resultJson} ->> 'cost_usd'`.as("resultCostUsd"),
  resultCostUsdCamel: sql<string | null>`${heartbeatRuns.resultJson} ->> 'costUsd'`.as("resultCostUsdCamel"),
} as const;

export const heartbeatRunSafeResultJsonColumn = sql<Record<string, unknown> | null>`
  case
    when ${heartbeatRuns.resultJson} is null then null
    when pg_column_size(${heartbeatRuns.resultJson}) <= ${HEARTBEAT_RUN_SAFE_RESULT_JSON_MAX_BYTES}
      then ${heartbeatRuns.resultJson}
    else jsonb_strip_nulls(
      jsonb_build_object(
        'summary', left(${heartbeatRuns.resultJson} ->> 'summary', ${HEARTBEAT_RUN_RESULT_SUMMARY_MAX_CHARS}),
        'result', left(${heartbeatRuns.resultJson} ->> 'result', ${HEARTBEAT_RUN_RESULT_SUMMARY_MAX_CHARS}),
        'message', left(${heartbeatRuns.resultJson} ->> 'message', ${HEARTBEAT_RUN_RESULT_SUMMARY_MAX_CHARS}),
        'error', left(${heartbeatRuns.resultJson} ->> 'error', ${HEARTBEAT_RUN_RESULT_SUMMARY_MAX_CHARS}),
        'stdout', left(${heartbeatRuns.resultJson} ->> 'stdout', ${HEARTBEAT_RUN_RESULT_OUTPUT_MAX_CHARS}),
        'stderr', left(${heartbeatRuns.resultJson} ->> 'stderr', ${HEARTBEAT_RUN_RESULT_OUTPUT_MAX_CHARS}),
        'stdoutTruncated', case
          when length(${heartbeatRuns.resultJson} ->> 'stdout') > ${HEARTBEAT_RUN_RESULT_OUTPUT_MAX_CHARS}
            then to_jsonb(true)
          else null
        end,
        'stderrTruncated', case
          when length(${heartbeatRuns.resultJson} ->> 'stderr') > ${HEARTBEAT_RUN_RESULT_OUTPUT_MAX_CHARS}
            then to_jsonb(true)
          else null
        end,
        'costUsd', coalesce(
          ${heartbeatRuns.resultJson} -> 'costUsd',
          ${heartbeatRuns.resultJson} -> 'cost_usd',
          ${heartbeatRuns.resultJson} -> 'total_cost_usd'
        ),
        'cost_usd', coalesce(
          ${heartbeatRuns.resultJson} -> 'cost_usd',
          ${heartbeatRuns.resultJson} -> 'costUsd',
          ${heartbeatRuns.resultJson} -> 'total_cost_usd'
        ),
        'total_cost_usd', coalesce(
          ${heartbeatRuns.resultJson} -> 'total_cost_usd',
          ${heartbeatRuns.resultJson} -> 'cost_usd',
          ${heartbeatRuns.resultJson} -> 'costUsd'
        ),
        'truncated', true,
        'truncationReason', 'oversized_result_json',
        'originalSizeBytes', pg_column_size(${heartbeatRuns.resultJson})
      )
    )
  end
`.as("resultJson");

export const heartbeatRunSafeColumns = {
  ...getTableColumns(heartbeatRuns),
  processGroupId: heartbeatRunProcessGroupIdColumn,
  resultJson: heartbeatRunSafeResultJsonColumn,
} as const;

export const heartbeatRunSqlAsciiSafeColumns = {
  ...getTableColumns(heartbeatRuns),
  processGroupId: heartbeatRunProcessGroupIdColumn,
  error: sql<string | null>`NULL`.as("error"),
  resultJson: sql<Record<string, unknown> | null>`NULL`.as("resultJson"),
  stdoutExcerpt: sql<string | null>`NULL`.as("stdoutExcerpt"),
  stderrExcerpt: sql<string | null>`NULL`.as("stderrExcerpt"),
} as const;

export const heartbeatRunLogAccessColumns = {
  id: heartbeatRuns.id,
  companyId: heartbeatRuns.companyId,
  logStore: heartbeatRuns.logStore,
  logRef: heartbeatRuns.logRef,
} as const;

export const heartbeatRunIssueSummaryColumns = {
  id: heartbeatRuns.id,
  status: heartbeatRuns.status,
  invocationSource: heartbeatRuns.invocationSource,
  triggerDetail: heartbeatRuns.triggerDetail,
  contextCommentId: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'commentId'`.as("contextCommentId"),
  contextWakeCommentId: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'wakeCommentId'`.as("contextWakeCommentId"),
  startedAt: heartbeatRuns.startedAt,
  finishedAt: heartbeatRuns.finishedAt,
  createdAt: heartbeatRuns.createdAt,
  agentId: heartbeatRuns.agentId,
  logBytes: heartbeatRuns.logBytes,
  processStartedAt: heartbeatRuns.processStartedAt,
  livenessState: heartbeatRuns.livenessState,
  livenessReason: heartbeatRuns.livenessReason,
  continuationAttempt: heartbeatRuns.continuationAttempt,
  lastUsefulActionAt: heartbeatRuns.lastUsefulActionAt,
  nextAction: heartbeatRuns.nextAction,
  lastOutputAt: heartbeatRuns.lastOutputAt,
  lastOutputSeq: heartbeatRuns.lastOutputSeq,
  lastOutputStream: heartbeatRuns.lastOutputStream,
  lastOutputBytes: heartbeatRuns.lastOutputBytes,
  issueId: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'issueId'`.as("issueId"),
} as const;
