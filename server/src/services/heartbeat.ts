import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, getTableColumns, gt, inArray, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
  defaultAgentMaxConcurrentRuns,
  ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY,
  MODEL_PROFILE_KEYS,
  isEnvironmentDriverSupportedForAdapter,
  type BillingType,
  type EnvironmentLeaseStatus,
  type ExecutionWorkspace,
  type ExecutionWorkspaceConfig,
  type IssueExecutionMonitorClearReason,
  type IssueExecutionMonitorPolicy,
  type IssueExecutionMonitorRecoveryPolicy,
  type ModelProfileKey,
  type RunLivenessState,
} from "@paperclipai/shared";
import {
  agents,
  agentRuntimeState,
  agentTaskSessions,
  agentWakeupRequests,
  activityLog,
  approvals,
  companySkills as companySkillsTable,
  documentRevisions,
  issueDocuments,
  heartbeatRunSkillEvents,
  heartbeatRunEvents,
  heartbeatRuns,
  issueApprovals,
  issueComments,
  issueRelations,
  issueThreadInteractions,
  issues,
  issueWorkProducts,
  projects,
  projectWorkspaces,
  workspaceOperations,
} from "@paperclipai/db";
import { conflict, HttpError, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { publishLiveEvent } from "./live-events.js";
import { lifecycleHooks } from "./lifecycle-hooks.js";
import { getRunLogStore, type RunLogHandle } from "./run-log-store.js";
import { getServerAdapter, listAdapterModelProfiles, runningProcesses } from "../adapters/index.js";
import type {
  AdapterExecutionResult,
  AdapterInvocationMeta,
  AdapterModelProfileDefinition,
  AdapterSessionCodec,
  UsageSummary,
} from "../adapters/index.js";
import { createLocalAgentJwt } from "../agent-auth-jwt.js";
import { parseObject, asBoolean, asNumber } from "../adapters/utils.js";
import {
  appendExcerpt,
  boundHeartbeatRunEventPayloadForStorage,
  compactRunLogChunk,
  formatRuntimeWorkspaceWarningLog,
} from "./heartbeat/run-log.js";
export { formatRuntimeWorkspaceWarningLog };
import { listUnresolvedBlockerSummaries } from "./heartbeat/blocker-summaries.js";
import { resolveExecutionRunAdapterConfig } from "./heartbeat/adapter-config.js";
export { resolveExecutionRunAdapterConfig };
import { readNonEmptyString } from "./heartbeat/shared.js";
import {
  consumeWakeContextModelProfile,
  mergeModelProfileAdapterConfig,
  mergeModelProfileRunMetadata,
  modelProfileRunMetadata,
  normalizeModelProfileWakeContext,
  parseIssueAssigneeAdapterOverrides,
  resolveModelProfileApplication,
  type ModelProfileApplication,
} from "./heartbeat/model-profile.js";
// Re-exported for callers (and tests) that import these from the heartbeat module.
export { boundHeartbeatRunEventPayloadForStorage, compactRunLogChunk };
export {
  consumeWakeContextModelProfile,
  mergeModelProfileAdapterConfig,
  normalizeModelProfileWakeContext,
  parseIssueAssigneeAdapterOverrides,
  resolveModelProfileApplication,
};
export type { ModelProfileApplication };
import {
  applyRunScopedMentionedSkillKeys,
  normalizeAdapterSkillActivations,
  resolveRunScopedMentionedSkillKeys,
} from "./heartbeat/skill-activations.js";
export { applyRunScopedMentionedSkillKeys, normalizeAdapterSkillActivations };
export { extractMentionedSkillIdsFromSources } from "./heartbeat/skill-activations.js";
import {
  applyPersistedExecutionWorkspaceConfig,
  buildExecutionWorkspaceConfigSnapshot,
  buildRealizedExecutionWorkspaceFromPersisted,
  ensureManagedProjectWorkspace,
  mergeExecutionWorkspaceMetadataForPersistence,
  prioritizeProjectWorkspaceCandidatesForRun,
  resolveRuntimeSessionParamsForWorkspace,
  stripWorkspaceRuntimeFromExecutionRunConfig,
  type ResolvedWorkspaceForRun,
} from "./heartbeat/execution-workspace.js";
export {
  applyPersistedExecutionWorkspaceConfig,
  buildRealizedExecutionWorkspaceFromPersisted,
  mergeExecutionWorkspaceMetadataForPersistence,
  prioritizeProjectWorkspaceCandidatesForRun,
  resolveRuntimeSessionParamsForWorkspace,
  stripWorkspaceRuntimeFromExecutionRunConfig,
};
export type { ResolvedWorkspaceForRun };
import {
  HEARTBEAT_RUN_TERMINAL_STATUSES,
  MAX_TURN_CONTINUATION_RETRY_REASON,
  PAPERCLIP_HARNESS_CHECKOUT_KEY,
  PAPERCLIP_WAKE_PAYLOAD_KEY,
  truncateDisplayId,
} from "./heartbeat/shared.js";
import { buildPaperclipWakePayload } from "./heartbeat/wake-payload.js";
import {
  heartbeatRunIssueSummaryColumns,
  heartbeatRunListColumns,
  heartbeatRunListContextColumns,
  heartbeatRunListResultColumns,
  heartbeatRunLogAccessColumns,
  heartbeatRunProcessGroupIdColumn,
  heartbeatRunSafeColumns,
  heartbeatRunSafeResultJsonColumn,
  heartbeatRunSqlAsciiSafeColumns,
} from "./heartbeat/run-columns.js";
export { MAX_TURN_CONTINUATION_RETRY_REASON };
import {
  allowsInProgressAutoCheckoutForWake,
  allowsIssueInteractionWake,
  autoCheckoutExpectedStatusesForWake,
  describeSessionResetReason,
  isCheckoutConflictError,
  shouldAutoCheckoutIssueForWake,
  shouldQueueFollowupForRunningIssueWake,
  shouldRequireIssueCommentForWake,
} from "./heartbeat/wake-gating.js";
import {
  isHeartbeatRunTerminalStatus,
  isSameTaskScope,
  isTrackedLocalChildProcessAdapter,
  leaseReleaseStatusForRunStatus,
  normalizeAgentNameKey,
  runTaskKey,
} from "./heartbeat/run-predicates.js";
import {
  normalizeBilledCostCents,
  normalizeLedgerBillingType,
  resolveLedgerBiller,
  resolveLedgerScopeForRun,
} from "./heartbeat/ledger.js";
import {
  didAutomaticRecoveryFail,
  summarizeHeartbeatRunContextSnapshot,
  summarizeHeartbeatRunListResultJson,
  summarizeRunFailureForIssueComment,
} from "./heartbeat/run-summary.js";
export {
  didAutomaticRecoveryFail,
  summarizeHeartbeatRunContextSnapshot,
  summarizeHeartbeatRunListResultJson,
  summarizeRunFailureForIssueComment,
};
import { buildPaperclipTaskMarkdown } from "./heartbeat/task-markdown.js";
export { buildPaperclipTaskMarkdown };
import {
  buildExplicitResumeSessionOverride,
  getAdapterSessionCodec,
  normalizeSessionParams,
  parseSessionCompactionPolicy,
  resolveNextSessionState,
} from "./heartbeat/session-codec.js";
export { buildExplicitResumeSessionOverride, parseSessionCompactionPolicy };
import {
  deriveNormalizedUsageDelta,
  formatCount,
  normalizeUsageTotals,
  readRawUsageTotals,
  type UsageTotals,
} from "./heartbeat/usage-totals.js";
import {
  buildProcessLossMessage,
  isProcessAlive,
  terminateHeartbeatRunProcess,
} from "./heartbeat/process.js";
import {
  BOUNDED_TRANSIENT_HEARTBEAT_RETRY_DELAYS_MS,
  BOUNDED_TRANSIENT_HEARTBEAT_RETRY_MAX_ATTEMPTS,
  chooseScheduledRetryModelProfile,
  computeBoundedTransientHeartbeatRetrySchedule,
  isMaxTurnExhaustionRun,
  mergeAdapterRecoveryMetadata,
  readTransientRecoveryContractFromRun,
  resolveCodexTransientFallbackMode,
} from "./heartbeat/retry-scheduling.js";
export { BOUNDED_TRANSIENT_HEARTBEAT_RETRY_DELAYS_MS, computeBoundedTransientHeartbeatRetrySchedule };
import {
  deriveCommentId,
  deriveTaskKey,
  deriveTaskKeyWithHeartbeatFallback,
  extractWakeCommentIds,
  mergeCoalescedContextSnapshot,
  normalizeWakeupContext,
  shouldResetTaskSessionForWake,
  type WakeupOptions,
} from "./heartbeat/wake-context.js";
export {
  deriveTaskKeyWithHeartbeatFallback,
  extractWakeCommentIds,
  mergeCoalescedContextSnapshot,
  normalizeWakeupContext,
  shouldResetTaskSessionForWake,
};
import { costService } from "./costs.js";
import { trackAgentFirstHeartbeat } from "@paperclipai/shared/telemetry";
import { getTelemetryClient } from "../telemetry.js";
import { companySkillService } from "./company-skills.js";
import { agentInstructionsService } from "./agent-instructions.js";
import {
  isManagerLikeAgent,
  loadDefaultAgentInstructionsBundle,
  resolveDefaultAgentInstructionsBundleRole,
} from "./default-agent-instructions.js";
import { budgetService, type BudgetEnforcementScope } from "./budgets.js";
import { secretService } from "./secrets.js";
import { resolveDefaultAgentWorkspaceDir, resolveManagedProjectWorkspaceDir } from "../home-paths.js";
import {
  buildHeartbeatRunIssueComment,
  HEARTBEAT_RUN_RESULT_OUTPUT_MAX_CHARS,
  HEARTBEAT_RUN_RESULT_SUMMARY_MAX_CHARS,
  HEARTBEAT_RUN_SAFE_RESULT_JSON_MAX_BYTES,
  mergeHeartbeatRunResultJson,
} from "./heartbeat-run-summary.js";
import {
  buildHeartbeatRunStopMetadata,
  mergeHeartbeatRunStopMetadata,
  normalizeMaxTurnStopReason,
} from "./heartbeat-stop-metadata.js";
import { buildTimerWakeupAssignmentContext } from "./heartbeat-timer-context.js";
import { isMeetingWorkflowWakeContext } from "./heartbeat-wake-context.js";
import {
  classifyRunLiveness,
  type RunLivenessClassificationInput,
} from "./run-liveness.js";
import { logActivity, publishPluginDomainEvent, type LogActivityInput } from "./activity-log.js";
import {
  buildWorkspaceReadyComment,
  cleanupExecutionWorkspaceArtifacts,
  ensureRuntimeServicesForRun,
  persistAdapterManagedRuntimeServices,
  realizeExecutionWorkspace,
  releaseRuntimeServicesForRun,
  type ExecutionWorkspaceInput,
  type RealizedExecutionWorkspace,
  sanitizeRuntimeServiceBaseEnv,
} from "./workspace-runtime.js";
import { issueService } from "./issues.js";
import {
  buildIssueMonitorClearedPatch,
  buildIssueMonitorTriggeredPatch,
  normalizeIssueExecutionPolicy,
  parseIssueExecutionState,
} from "./issue-execution-policy.js";
import {
  ISSUE_TREE_CONTROL_INTERACTION_WAKE_REASONS,
  isVerifiedIssueTreeControlInteractionWake,
  issueTreeControlService,
} from "./issue-tree-control.js";
import {
  continuationSummaryParksExecutor,
  getIssueContinuationSummaryDocument,
  refreshIssueContinuationSummary,
} from "./issue-continuation-summary.js";
import { executionWorkspaceService, mergeExecutionWorkspaceConfig } from "./execution-workspaces.js";
import { workspaceOperationService } from "./workspace-operations.js";
import { isProcessGroupAlive } from "./local-service-supervisor.js";
import {
  buildExecutionWorkspaceAdapterConfig,
  gateProjectExecutionWorkspacePolicy,
  issueExecutionWorkspaceModeForPersistedWorkspace,
  parseIssueExecutionWorkspaceSettings,
  parseProjectExecutionWorkspacePolicy,
  resolveExecutionWorkspaceEnvironmentId,
  resolveExecutionWorkspaceMode,
} from "./execution-workspace-policy.js";
import { instanceSettingsService } from "./instance-settings.js";
import {
  RECOVERY_ORIGIN_KINDS,
  FINISH_SUCCESSFUL_RUN_HANDOFF_REASON,
  SUCCESSFUL_RUN_MISSING_STATE_REASON,
  RUN_LIVENESS_CONTINUATION_REASON,
  buildRunLivenessContinuationIdempotencyKey,
  buildFinishSuccessfulRunHandoffIdempotencyKey,
  buildSuccessfulRunHandoffRequiredNotice,
  decideSuccessfulRunHandoffCompletion,
  decideRunLivenessContinuation,
  decideSuccessfulRunHandoff,
  findExistingFinishSuccessfulRunHandoffWake,
  findExistingRunLivenessContinuationWake,
  isSuccessfulRunHandoffRun,
  SUCCESSFUL_RUN_HANDOFF_REQUIRED_NOTICE_BODY,
  readContinuationAttempt,
} from "./recovery/index.js";
import { isAutomaticRecoverySuppressedByPauseHold } from "./recovery/pause-hold-guard.js";
import {
  recoveryAssigneeAdapterOverrides,
  withRecoveryModelProfileHint,
} from "./recovery/model-profile-hint.js";
import {
  ACTIVE_RUN_OUTPUT_CONTINUE_REARM_MS,
  ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS,
  ACTIVE_RUN_OUTPUT_SUSPICION_THRESHOLD_MS,
  recoveryService,
} from "./recovery/service.js";
import { productivityReviewService } from "./productivity-review.js";
import { withAgentStartLock } from "./agent-start-lock.js";
import {
  redactCurrentUserText,
  redactCurrentUserValue,
  type CurrentUserRedactionOptions,
} from "../log-redaction.js";
import { redactEventPayload, redactSensitiveText } from "../redaction.js";
import {
  computeLocalActiveRunExecutionsMax,
  computeLocalAvailableRunExecutionSlots,
  computeLocalQueuedRunsMax,
} from "./heartbeat-capacity.js";
import {
  hasSessionCompactionThresholds,
  resolveSessionCompactionPolicy,
  type SessionCompactionPolicy,
} from "@paperclipai/adapter-utils";
import { environmentService } from "./environments.js";
import { environmentRuntimeService } from "./environment-runtime.js";
import { environmentRunOrchestrator } from "./environment-run-orchestrator.js";
import type { PluginWorkerManager } from "./plugin-worker-manager.js";
import { readBlockedCheckoutUnresolvedBlockerIssueIds } from "./heartbeat-checkout-errors.js";
import { effectiveMaxConcurrentRunsForQueuedBacklog } from "./heartbeat-backlog-concurrency.js";

const MAX_LIVE_LOG_CHUNK_BYTES = 8 * 1024;

export function redactDetectedSuccessfulRunProgressSummaryForBoard(
  summary: string,
  currentUserRedactionOptions?: CurrentUserRedactionOptions,
) {
  const normalized = summary.replace(/\s+/g, " ").trim();
  const redacted = redactSensitiveText(redactCurrentUserText(normalized, currentUserRedactionOptions));
  return redacted.length <= 280 ? redacted : `${redacted.slice(0, 277)}...`;
}

const HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT = AGENT_DEFAULT_MAX_CONCURRENT_RUNS;
const HEARTBEAT_MAX_CONCURRENT_RUNS_MIN = 1;
const HEARTBEAT_MAX_CONCURRENT_RUNS_MAX = 50;
const MANAGEMENT_AGENT_LIVE_RUN_CAP = 4;
const LIVENESS_BOOKKEEPING_ACTIVITY_ACTIONS = [
  "environment.lease_acquired",
  "environment.lease_released",
];
const DEFERRED_WAKE_CONTEXT_KEY = "_paperclipWakeContext";
const ISSUE_TREE_HOLD_WAKEUP_DEFERRED_ACTION = "issue.tree_hold_wakeup_deferred";
const PAPERCLIP_PRE_CHECKOUT_STATUS_KEY = "paperclipPreCheckoutStatus";
const DETACHED_PROCESS_ERROR_CODE = "process_detached";
const REPO_ONLY_CWD_SENTINEL = "/__paperclip_repo_only__";
const execFile = promisify(execFileCallback);
const EXECUTION_PATH_HEARTBEAT_RUN_STATUSES = ["queued", "running", "scheduled_retry"] as const;
const CANCELLABLE_HEARTBEAT_RUN_STATUSES = ["queued", "running", "scheduled_retry"] as const;
export {
  ACTIVE_RUN_OUTPUT_CONTINUE_REARM_MS,
  ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS,
  ACTIVE_RUN_OUTPUT_SUSPICION_THRESHOLD_MS,
};
export const ACTIVE_RUN_OUTPUT_PROGRESS_FLUSH_INTERVAL_MS = 60 * 1000;
const BOUNDED_TRANSIENT_HEARTBEAT_RETRY_REASON = "transient_failure";
const BOUNDED_TRANSIENT_HEARTBEAT_RETRY_WAKE_REASON = "transient_failure_retry";
const PROCESS_LOSS_RETRY_WINDOW_MS = Math.max(
  60_000,
  Number.parseInt(process.env.PAPERCLIP_PROCESS_LOSS_RETRY_WINDOW_MS ?? "", 10) || 60 * 60 * 1000,
);
const PROCESS_LOSS_RETRY_AGENT_ISSUE_CAP = Math.max(
  0,
  Number.parseInt(process.env.PAPERCLIP_PROCESS_LOSS_RETRY_AGENT_ISSUE_CAP ?? "", 10) || 2,
);
const MANAGER_TAKEOVER_FAILURE_WINDOW_MS = Math.max(
  60_000,
  Number.parseInt(process.env.PAPERCLIP_MANAGER_TAKEOVER_FAILURE_WINDOW_MS ?? "", 10) || 60 * 60 * 1000,
);
const MANAGER_TAKEOVER_FAILURE_COUNT = Math.max(
  1,
  Number.parseInt(process.env.PAPERCLIP_MANAGER_TAKEOVER_FAILURE_COUNT ?? "", 10) || 2,
);

async function logIssueTreeHoldWakeupDeferredOnce(
  db: Db,
  input: {
    companyId: string;
    issueId: string;
    agentId: string;
    holdId: string;
    rootIssueId: string;
    requestedReason: string;
    source: string;
    triggerDetail: string | null;
  },
) {
  const existing = await db
    .select({ id: activityLog.id })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.companyId, input.companyId),
        eq(activityLog.action, ISSUE_TREE_HOLD_WAKEUP_DEFERRED_ACTION),
        eq(activityLog.entityType, "issue"),
        eq(activityLog.entityId, input.issueId),
        eq(activityLog.agentId, input.agentId),
        sql`${activityLog.details} ->> 'holdId' = ${input.holdId}`,
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (existing) return false;

  await logActivity(db, {
    companyId: input.companyId,
    actorType: "system",
    actorId: "system",
    agentId: input.agentId,
    runId: null,
    action: ISSUE_TREE_HOLD_WAKEUP_DEFERRED_ACTION,
    entityType: "issue",
    entityId: input.issueId,
    details: {
      holdId: input.holdId,
      rootIssueId: input.rootIssueId,
      requestedReason: input.requestedReason,
      source: input.source,
      triggerDetail: input.triggerDetail,
      dedupeKey: `${input.holdId}:${input.issueId}:${input.agentId}`,
      securityPrinciples: ["Complete Mediation", "Fail Securely", "Secure Defaults"],
    },
  });

  return true;
}

const LOCAL_AGENT_PRE_SPAWN_STALE_MS = 2 * 60 * 1000;
const STALE_UNSCOPED_QUEUED_RUN_MS = Math.max(
  60_000,
  Number.parseInt(process.env.PAPERCLIP_STALE_UNSCOPED_QUEUED_RUN_MS ?? "", 10) || 2 * 60 * 60 * 1000,
);
const QUEUED_RUN_RECONCILIATION_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.PAPERCLIP_QUEUED_RUN_RECONCILIATION_LIMIT ?? "", 10) || 500,
);
const HEARTBEAT_GLOBAL_RUNNING_RUNS_MAX = Math.max(
  1,
  Math.floor(Number(process.env.PAPERCLIP_HEARTBEAT_GLOBAL_MAX_RUNNING ?? 20)),
);
const HEARTBEAT_GLOBAL_PRIORITY_BURST_MAX = Math.max(
  0,
  Math.floor(Number(process.env.PAPERCLIP_HEARTBEAT_GLOBAL_PRIORITY_BURST_MAX ?? 1)),
);
export const MAX_TURN_CONTINUATION_WAKE_REASON = "max_turns_continuation_retry";
const MAX_TURN_CONTINUATION_DEFAULT_MAX_ATTEMPTS = 2;
const MAX_TURN_CONTINUATION_MAX_ATTEMPTS_CAP = 10;
const MAX_TURN_CONTINUATION_DEFAULT_DELAY_MS = 1_000;
const MAX_TURN_CONTINUATION_MAX_DELAY_MS = 5 * 60 * 1000;
const MAX_TURN_CONTINUATION_LIVE_RUN_STATUSES = ["scheduled_retry", "queued", "running"] as const;
const LOCAL_ACTIVE_RUN_EXECUTIONS_MAX = computeLocalActiveRunExecutionsMax(
  process.env.PAPERCLIP_LOCAL_ACTIVE_RUN_EXECUTIONS_MAX,
  undefined,
  HEARTBEAT_GLOBAL_RUNNING_RUNS_MAX,
);
const LOCAL_QUEUED_RUNS_MAX = computeLocalQueuedRunsMax(
  process.env.PAPERCLIP_LOCAL_QUEUED_RUNS_MAX,
);

type ActiveRunExecution = {
  runId: string;
  agentId: string;
  companyId: string;
  promise: Promise<void>;
};

const activeRunExecutions = new Map<string, ActiveRunExecution>();

interface MaxTurnContinuationPolicy {
  enabled: boolean;
  maxAttempts: number;
  delayMs: number;
}



function normalizeMaxConcurrentRuns(value: unknown) {
  const parsed = Math.floor(asNumber(value, HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT));
  if (!Number.isFinite(parsed)) return HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT;
  return Math.max(HEARTBEAT_MAX_CONCURRENT_RUNS_MIN, Math.min(HEARTBEAT_MAX_CONCURRENT_RUNS_MAX, parsed));
}

type SessionCompactionDecision = {
  rotate: boolean;
  reason: string | null;
  handoffMarkdown: string | null;
  previousRunId: string | null;
};



export type HeartbeatEnvironmentRuntime = ReturnType<typeof environmentRuntimeService>;

export interface HeartbeatServiceOptions {
  pluginWorkerManager?: PluginWorkerManager;
  environmentRuntime?: HeartbeatEnvironmentRuntime;
}

export function heartbeatService(db: Db, options: HeartbeatServiceOptions = {}) {
  const instanceSettings = instanceSettingsService(db);
  const getCurrentUserRedactionOptions = async () => ({
    enabled: (await instanceSettings.getGeneral()).censorUsernameInLogs,
  });

  const runLogStore = getRunLogStore();
  const secretsSvc = secretService(db);
  const companySkills = companySkillService(db);
  const agentInstructions = agentInstructionsService();
  const issuesSvc = issueService(db);
  const treeControlSvc = issueTreeControlService(db);
  const executionWorkspacesSvc = executionWorkspaceService(db);
  const environmentsSvc = environmentService(db);
  const environmentRuntime = options.environmentRuntime ?? environmentRuntimeService(db, {
    pluginWorkerManager: options.pluginWorkerManager,
  });
  const envOrchestrator = environmentRunOrchestrator(db, {
    pluginWorkerManager: options.pluginWorkerManager,
    environmentRuntime,
  });
  const workspaceOperationsSvc = workspaceOperationService(db);
  const budgetHooks = {
    cancelWorkForScope: cancelBudgetScopeWork,
  };
  const budgets = budgetService(db, budgetHooks);
  const recovery = recoveryService(db, { enqueueWakeup });
  const productivityReviews = productivityReviewService(db, { enqueueWakeup });
  let unsafeTextProjectionPromise: Promise<boolean> | null = null;

  async function releaseEnvironmentLeasesForRun(input: {
    runId: string;
    companyId: string;
    agentId: string;
    status: string | null | undefined;
    failureReason?: string | null;
  }) {
    const releaseResult = await envOrchestrator.releaseForRun({
      heartbeatRunId: input.runId,
      companyId: input.companyId,
      agentId: input.agentId,
      status: leaseReleaseStatusForRunStatus(input.status),
      failureReason: input.failureReason ?? undefined,
    }).catch((err) => {
      logger.warn({ err, runId: input.runId }, "failed to release environment leases for heartbeat run");
      return null;
    });
    for (const releaseError of releaseResult?.errors ?? []) {
      logger.warn(
        { err: releaseError.error, leaseId: releaseError.leaseId, runId: input.runId },
        "failed to release environment lease for heartbeat run",
      );
    }
  }

  async function hasUnsafeTextProjectionDatabase() {
    if (!unsafeTextProjectionPromise) {
      unsafeTextProjectionPromise = db
        .execute(sql`select current_setting('server_encoding') as server_encoding`)
        .then((rows) => {
          const first = Array.isArray(rows) ? rows[0] : null;
          const serverEncoding = typeof first === "object" && first !== null
            ? (first as Record<string, unknown>).server_encoding
            : null;
          return typeof serverEncoding === "string" && serverEncoding.toUpperCase() === "SQL_ASCII";
        })
        .catch((err) => {
          logger.warn({ err }, "failed to inspect database server encoding; using conservative heartbeat result projection");
          return true;
        });
    }
    return unsafeTextProjectionPromise;
  }

  async function getAgent(agentId: string) {
    return db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);
  }

  async function getRun(runId: string, opts?: { unsafeFullResultJson?: boolean }) {
    const safeForLegacyEncoding = !opts?.unsafeFullResultJson && await hasUnsafeTextProjectionDatabase();
    return db
      .select(
        opts?.unsafeFullResultJson
          ? getTableColumns(heartbeatRuns)
          : safeForLegacyEncoding
            ? heartbeatRunSqlAsciiSafeColumns
            : heartbeatRunSafeColumns,
      )
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
  }

  async function getRunLogAccess(runId: string) {
    return db
      .select(heartbeatRunLogAccessColumns)
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
  }

  async function getIssueExecutionContext(companyId: string, issueId: string) {
    return db
      .select({
        id: issues.id,
        identifier: issues.identifier,
        title: issues.title,
        description: issues.description,
        status: issues.status,
        workMode: issues.workMode,
        priority: issues.priority,
        projectId: issues.projectId,
        projectWorkspaceId: issues.projectWorkspaceId,
        executionWorkspaceId: issues.executionWorkspaceId,
        executionWorkspacePreference: issues.executionWorkspacePreference,
        assigneeAgentId: issues.assigneeAgentId,
        assigneeAdapterOverrides: issues.assigneeAdapterOverrides,
        executionWorkspaceSettings: issues.executionWorkspaceSettings,
      })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
  }

  async function getRuntimeState(agentId: string) {
    return db
      .select()
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agentId, agentId))
      .then((rows) => rows[0] ?? null);
  }

  async function getTaskSession(
    companyId: string,
    agentId: string,
    adapterType: string,
    taskKey: string,
  ) {
    return db
      .select()
      .from(agentTaskSessions)
      .where(
        and(
          eq(agentTaskSessions.companyId, companyId),
          eq(agentTaskSessions.agentId, agentId),
          eq(agentTaskSessions.adapterType, adapterType),
          eq(agentTaskSessions.taskKey, taskKey),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function getLatestRunForSession(
    agentId: string,
    sessionId: string,
    opts?: { excludeRunId?: string | null },
  ) {
    const conditions = [
      eq(heartbeatRuns.agentId, agentId),
      eq(heartbeatRuns.sessionIdAfter, sessionId),
    ];
    if (opts?.excludeRunId) {
      conditions.push(sql`${heartbeatRuns.id} <> ${opts.excludeRunId}`);
    }
    return db
      .select({
        id: heartbeatRuns.id,
        usageJson: heartbeatRuns.usageJson,
      })
      .from(heartbeatRuns)
      .where(and(...conditions))
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  const issueMonitorDispatchColumns = {
    id: issues.id,
    companyId: issues.companyId,
    projectId: issues.projectId,
    goalId: issues.goalId,
    identifier: issues.identifier,
    title: issues.title,
    status: issues.status,
    priority: issues.priority,
    assigneeAgentId: issues.assigneeAgentId,
    assigneeUserId: issues.assigneeUserId,
    billingCode: issues.billingCode,
    executionPolicy: issues.executionPolicy,
    executionState: issues.executionState,
    monitorNextCheckAt: issues.monitorNextCheckAt,
    monitorWakeRequestedAt: issues.monitorWakeRequestedAt,
    monitorLastTriggeredAt: issues.monitorLastTriggeredAt,
    monitorAttemptCount: issues.monitorAttemptCount,
    monitorNotes: issues.monitorNotes,
    monitorScheduledBy: issues.monitorScheduledBy,
  };

  interface IssueMonitorDispatchRow {
    id: string;
    companyId: string;
    projectId: string | null;
    goalId: string | null;
    identifier: string | null;
    title: string;
    status: string;
    priority: string;
    assigneeAgentId: string | null;
    assigneeUserId: string | null;
    billingCode: string | null;
    executionPolicy: Record<string, unknown> | null;
    executionState: Record<string, unknown> | null;
    monitorNextCheckAt: Date | null;
    monitorWakeRequestedAt: Date | null;
    monitorLastTriggeredAt: Date | null;
    monitorAttemptCount: number | null;
    monitorNotes: string | null;
    monitorScheduledBy: string | null;
  }

  function parseMonitorDate(value: string | null | undefined) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function issueMonitorLimitClearReason(input: {
    monitor: IssueExecutionMonitorPolicy | null;
    nextAttemptCount: number;
    now: Date;
  }): IssueExecutionMonitorClearReason | null {
    const timeoutAt = parseMonitorDate(input.monitor?.timeoutAt ?? null);
    if (timeoutAt && input.now.getTime() >= timeoutAt.getTime()) {
      return "timeout_exceeded";
    }
    const maxAttempts = input.monitor?.maxAttempts ?? null;
    if (maxAttempts !== null && input.nextAttemptCount > maxAttempts) {
      return "max_attempts_exhausted";
    }
    return null;
  }

  function monitorRecoveryPolicy(
    monitor: IssueExecutionMonitorPolicy | null,
  ): IssueExecutionMonitorRecoveryPolicy {
    return monitor?.recoveryPolicy ?? "wake_owner";
  }

  function monitorRecoveryDetails(input: {
    claimed: IssueMonitorDispatchRow;
    scheduledAtIso: string;
    nextAttemptCount: number;
    clearReason: IssueExecutionMonitorClearReason;
    recoveryPolicy: IssueExecutionMonitorRecoveryPolicy;
    monitor: IssueExecutionMonitorPolicy | null;
    source: "manual" | "scheduled";
  }) {
    return {
      identifier: input.claimed.identifier,
      nextCheckAt: input.scheduledAtIso,
      attemptedAttemptCount: input.nextAttemptCount,
      notes: input.claimed.monitorNotes ?? null,
      serviceName: input.monitor?.serviceName ?? null,
      timeoutAt: input.monitor?.timeoutAt ?? null,
      maxAttempts: input.monitor?.maxAttempts ?? null,
      clearReason: input.clearReason,
      recoveryPolicy: input.recoveryPolicy,
      source: input.source,
    };
  }

  function formatIssueIdentifierLink(identifier: string | null, fallback: string) {
    if (!identifier) return fallback;
    const prefix = identifier.split("-")[0];
    if (!prefix || !/^[A-Z][A-Z0-9]*-\d+$/.test(identifier)) return identifier;
    return `[${identifier}](/${prefix}/issues/${identifier})`;
  }

  function monitorRecoveryComment(input: {
    issue: IssueMonitorDispatchRow;
    clearReason: IssueExecutionMonitorClearReason;
    recoveryPolicy: IssueExecutionMonitorRecoveryPolicy;
    nextAttemptCount: number;
  }) {
    const label = formatIssueIdentifierLink(input.issue.identifier, input.issue.id);
    const reason =
      input.clearReason === "timeout_exceeded"
        ? "its timeout was reached"
        : "its maximum attempt count was reached";
    return [
      `Paperclip cleared the scheduled external-service monitor for ${label} because ${reason}.`,
      "",
      `- Attempt count: ${input.nextAttemptCount}`,
      `- Recovery policy: ${input.recoveryPolicy}`,
      "",
      "Next action: inspect the external service state, record the result on this issue, and restore an explicit execution or waiting path if more work remains.",
    ].join("\n");
  }

  async function findOpenIssueMonitorRecoveryIssue(claimed: IssueMonitorDispatchRow) {
    return db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, claimed.companyId),
          eq(issues.originKind, RECOVERY_ORIGIN_KINDS.strandedIssueRecovery),
          eq(issues.originId, claimed.id),
          isNull(issues.hiddenAt),
          notInArray(issues.status, ["done", "cancelled"]),
        ),
      )
      .orderBy(desc(issues.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function performIssueMonitorRecovery(input: {
    claimed: IssueMonitorDispatchRow;
    scheduledAtIso: string;
    nextAttemptCount: number;
    clearReason: IssueExecutionMonitorClearReason;
    recoveryPolicy: IssueExecutionMonitorRecoveryPolicy;
    monitor: IssueExecutionMonitorPolicy | null;
    actorType: "user" | "agent" | "system";
    actorId: string;
    agentId: string | null;
    runId: string | null;
    activitySource: "manual" | "scheduled";
  }) {
    const details = monitorRecoveryDetails({
      claimed: input.claimed,
      scheduledAtIso: input.scheduledAtIso,
      nextAttemptCount: input.nextAttemptCount,
      clearReason: input.clearReason,
      recoveryPolicy: input.recoveryPolicy,
      monitor: input.monitor,
      source: input.activitySource,
    });

    if (input.recoveryPolicy === "create_recovery_issue") {
      let recoveryIssue = await findOpenIssueMonitorRecoveryIssue(input.claimed);
      if (!recoveryIssue) {
        recoveryIssue = await issuesSvc.create(input.claimed.companyId, {
          title: `Recover external-service monitor for ${input.claimed.identifier ?? input.claimed.title}`,
          description: monitorRecoveryComment({
            issue: input.claimed,
            clearReason: input.clearReason,
            recoveryPolicy: input.recoveryPolicy,
            nextAttemptCount: input.nextAttemptCount,
          }),
          status: "todo",
          priority: "high",
          parentId: input.claimed.id,
          projectId: input.claimed.projectId,
          goalId: input.claimed.goalId,
          assigneeAgentId: input.claimed.assigneeAgentId,
          assigneeAdapterOverrides: recoveryAssigneeAdapterOverrides(),
          originKind: RECOVERY_ORIGIN_KINDS.strandedIssueRecovery,
          originId: input.claimed.id,
          originFingerprint: `issue_monitor:${input.clearReason}`,
          billingCode: input.claimed.billingCode,
        });
      }

      if (recoveryIssue.assigneeAgentId) {
        await enqueueWakeup(recoveryIssue.assigneeAgentId, {
          source: "automation",
          triggerDetail: "system",
          reason: "issue_monitor_recovery_issue",
          idempotencyKey: `issue-monitor-recovery-issue:${input.claimed.id}:${input.clearReason}:${input.scheduledAtIso}`,
          payload: withRecoveryModelProfileHint({ issueId: recoveryIssue.id, sourceIssueId: input.claimed.id }),
          requestedByActorType: input.actorType,
          requestedByActorId: input.actorId,
          contextSnapshot: withRecoveryModelProfileHint({
            issueId: recoveryIssue.id,
            sourceIssueId: input.claimed.id,
            source: "issue.monitor.recovery_issue",
            wakeReason: "issue_monitor_recovery_issue",
          }),
        });
      }

      await logActivity(db, {
        companyId: input.claimed.companyId,
        actorType: input.actorType,
        actorId: input.actorId,
        agentId: input.agentId,
        runId: input.runId,
        action: "issue.monitor_recovery_issue_created",
        entityType: "issue",
        entityId: input.claimed.id,
        details: {
          ...details,
          recoveryIssueId: recoveryIssue.id,
          recoveryIdentifier: recoveryIssue.identifier,
        },
      });
      return;
    }

    if (input.recoveryPolicy === "escalate_to_board") {
      await db.insert(issueComments).values({
        companyId: input.claimed.companyId,
        issueId: input.claimed.id,
        body: monitorRecoveryComment({
          issue: input.claimed,
          clearReason: input.clearReason,
          recoveryPolicy: input.recoveryPolicy,
          nextAttemptCount: input.nextAttemptCount,
        }),
      });

      await logActivity(db, {
        companyId: input.claimed.companyId,
        actorType: input.actorType,
        actorId: input.actorId,
        agentId: input.agentId,
        runId: input.runId,
        action: "issue.monitor_escalated_to_board",
        entityType: "issue",
        entityId: input.claimed.id,
        details,
      });
      return;
    }

    await enqueueWakeup(input.claimed.assigneeAgentId!, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_monitor_recovery",
      idempotencyKey: `issue-monitor-recovery:${input.claimed.id}:${input.clearReason}:${input.scheduledAtIso}`,
      payload: withRecoveryModelProfileHint({
        issueId: input.claimed.id,
        monitorAttemptCount: input.nextAttemptCount,
        monitorNotes: input.claimed.monitorNotes ?? null,
        clearReason: input.clearReason,
        serviceName: input.monitor?.serviceName ?? null,
        timeoutAt: input.monitor?.timeoutAt ?? null,
        maxAttempts: input.monitor?.maxAttempts ?? null,
      }),
      requestedByActorType: input.actorType,
      requestedByActorId: input.actorId,
      contextSnapshot: withRecoveryModelProfileHint({
        issueId: input.claimed.id,
        source: "issue.monitor.recovery",
        wakeReason: "issue_monitor_recovery",
        monitorAttemptCount: input.nextAttemptCount,
        monitorNotes: input.claimed.monitorNotes ?? null,
        clearReason: input.clearReason,
        serviceName: input.monitor?.serviceName ?? null,
        timeoutAt: input.monitor?.timeoutAt ?? null,
        maxAttempts: input.monitor?.maxAttempts ?? null,
      }),
    });

    await logActivity(db, {
      companyId: input.claimed.companyId,
      actorType: input.actorType,
      actorId: input.actorId,
      agentId: input.agentId,
      runId: input.runId,
      action: "issue.monitor_recovery_wake_queued",
      entityType: "issue",
      entityId: input.claimed.id,
      details,
    });
  }

  async function clearIssueMonitorAndRecover(input: {
    claimed: IssueMonitorDispatchRow;
    policy: ReturnType<typeof normalizeIssueExecutionPolicy>;
    scheduledAtIso: string;
    nextAttemptCount: number;
    clearReason: IssueExecutionMonitorClearReason;
    recoveryPolicy: IssueExecutionMonitorRecoveryPolicy;
    monitor: IssueExecutionMonitorPolicy | null;
    now: Date;
    actorType: "user" | "agent" | "system";
    actorId: string;
    agentId: string | null;
    runId: string | null;
    activitySource: "manual" | "scheduled";
  }) {
    await db
      .update(issues)
      .set({
        ...buildIssueMonitorClearedPatch({
          issue: input.claimed,
          policy: input.policy,
          clearReason: input.clearReason,
          clearedAt: input.now,
        }),
        updatedAt: input.now,
      })
      .where(eq(issues.id, input.claimed.id));

    await logActivity(db, {
      companyId: input.claimed.companyId,
      actorType: input.actorType,
      actorId: input.actorId,
      agentId: input.agentId,
      runId: input.runId,
      action: "issue.monitor_exhausted",
      entityType: "issue",
      entityId: input.claimed.id,
      details: monitorRecoveryDetails({
        claimed: input.claimed,
        scheduledAtIso: input.scheduledAtIso,
        nextAttemptCount: input.nextAttemptCount,
        clearReason: input.clearReason,
        recoveryPolicy: input.recoveryPolicy,
        monitor: input.monitor,
        source: input.activitySource,
      }),
    });

    await performIssueMonitorRecovery({
      claimed: input.claimed,
      scheduledAtIso: input.scheduledAtIso,
      nextAttemptCount: input.nextAttemptCount,
      clearReason: input.clearReason,
      recoveryPolicy: input.recoveryPolicy,
      monitor: input.monitor,
      actorType: input.actorType,
      actorId: input.actorId,
      agentId: input.agentId,
      runId: input.runId,
      activitySource: input.activitySource,
    });

    return { outcome: "skipped" as const, reason: input.clearReason };
  }

  async function dispatchClaimedIssueMonitor(
    claimed: IssueMonitorDispatchRow,
    input: {
      now: Date;
      source: "automation" | "on_demand";
      triggerDetail: "manual" | "system";
      wakeReason: string;
      actorType: "user" | "agent" | "system";
      actorId: string;
      agentId: string | null;
      runId: string | null;
      clearOnClientError: boolean;
      activitySource: "manual" | "scheduled";
    },
  ) {
    if (!claimed.assigneeAgentId || !claimed.monitorNextCheckAt) {
      throw conflict("Issue monitor is not ready to dispatch");
    }

    const scheduledAtIso = claimed.monitorNextCheckAt.toISOString();
    const nextAttemptCount = (claimed.monitorAttemptCount ?? 0) + 1;
    const policy = normalizeIssueExecutionPolicy(claimed.executionPolicy ?? null);
    const monitor = policy?.monitor ?? null;
    const clearReason = issueMonitorLimitClearReason({ monitor, nextAttemptCount, now: input.now });
    const recoveryPolicy = monitorRecoveryPolicy(monitor);
    const monitorMetadata = {
      serviceName: monitor?.serviceName ?? null,
      timeoutAt: monitor?.timeoutAt ?? null,
      maxAttempts: monitor?.maxAttempts ?? null,
      recoveryPolicy: monitor?.recoveryPolicy ?? null,
    };

    if (clearReason) {
      return clearIssueMonitorAndRecover({
        claimed,
        policy,
        scheduledAtIso,
        nextAttemptCount,
        clearReason,
        recoveryPolicy,
        monitor,
        now: input.now,
        actorType: input.actorType,
        actorId: input.actorId,
        agentId: input.agentId,
        runId: input.runId,
        activitySource: input.activitySource,
      });
    }

    try {
      await enqueueWakeup(claimed.assigneeAgentId, {
        source: input.source,
        triggerDetail: input.triggerDetail,
        reason: input.wakeReason,
        idempotencyKey: `issue-monitor:${claimed.id}:${scheduledAtIso}`,
        payload: {
          issueId: claimed.id,
          nextCheckAt: scheduledAtIso,
          monitorAttemptCount: nextAttemptCount,
          monitorNotes: claimed.monitorNotes ?? null,
          ...monitorMetadata,
          source: input.activitySource,
        },
        requestedByActorType: input.actorType,
        requestedByActorId: input.actorId,
        contextSnapshot: {
          issueId: claimed.id,
          source: "issue.monitor",
          wakeReason: input.wakeReason,
          nextCheckAt: scheduledAtIso,
          monitorAttemptCount: nextAttemptCount,
          monitorNotes: claimed.monitorNotes ?? null,
          ...monitorMetadata,
          manualTrigger: input.activitySource === "manual",
        },
      });

      await db
        .update(issues)
        .set({
          ...buildIssueMonitorTriggeredPatch({
            issue: claimed,
            policy,
            triggeredAt: input.now,
          }),
          updatedAt: new Date(),
        })
        .where(eq(issues.id, claimed.id));

      await logActivity(db, {
        companyId: claimed.companyId,
        actorType: input.actorType,
        actorId: input.actorId,
        agentId: input.agentId,
        runId: input.runId,
        action: "issue.monitor_triggered",
        entityType: "issue",
        entityId: claimed.id,
        details: {
          identifier: claimed.identifier,
          nextCheckAt: scheduledAtIso,
          lastTriggeredAt: input.now.toISOString(),
          attemptCount: nextAttemptCount,
          notes: claimed.monitorNotes ?? null,
          ...monitorMetadata,
          source: input.activitySource,
        },
      });

      return { outcome: "triggered" as const };
    } catch (err) {
      if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
        if (input.clearOnClientError) {
          await db
            .update(issues)
            .set({
              ...buildIssueMonitorClearedPatch({
                issue: claimed,
                policy,
                clearReason: "dispatch_skipped",
                clearedAt: input.now,
              }),
              updatedAt: new Date(),
            })
            .where(eq(issues.id, claimed.id));

          await logActivity(db, {
            companyId: claimed.companyId,
            actorType: input.actorType,
            actorId: input.actorId,
            agentId: input.agentId,
            runId: input.runId,
            action: "issue.monitor_skipped",
            entityType: "issue",
            entityId: claimed.id,
            details: {
              identifier: claimed.identifier,
              nextCheckAt: scheduledAtIso,
              attemptCount: nextAttemptCount,
              notes: claimed.monitorNotes ?? null,
              reason: err.message,
              source: input.activitySource,
            },
          });

          return { outcome: "skipped" as const, reason: err.message };
        }

        await db
          .update(issues)
          .set({
            monitorWakeRequestedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(issues.id, claimed.id));
      } else {
        await db
          .update(issues)
          .set({
            monitorWakeRequestedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(issues.id, claimed.id));
      }

      throw err;
    }
  }

  async function triggerIssueMonitor(issueId: string, input?: {
    now?: Date;
    actorType?: "user" | "agent" | "system";
    actorId?: string | null;
    agentId?: string | null;
    runId?: string | null;
    wakeReason?: string;
  }) {
    const now = input?.now ?? new Date();
    const actorType = input?.actorType ?? "system";
    const actorId = input?.actorId ?? (actorType === "system" ? "heartbeat_scheduler" : null);
    if (!actorId) {
      throw conflict("Issue monitor trigger requires an actor");
    }

    const issue = await db
      .select(issueMonitorDispatchColumns)
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!issue) {
      throw notFound("Issue not found");
    }
    if (!issue.monitorNextCheckAt) {
      throw conflict("Issue has no scheduled monitor");
    }
    if (!issue.assigneeAgentId || issue.assigneeUserId) {
      throw conflict("Issue monitor requires an agent assignee");
    }
    if (!["in_progress", "in_review"].includes(issue.status)) {
      throw conflict("Issue monitor can only run while the issue is in progress or in review");
    }

    const staleClaimThreshold = new Date(now.getTime() - 5 * 60 * 1000);
    const claimed = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(issues)
        .set({
          monitorWakeRequestedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(issues.id, issueId),
            sql`${issues.monitorNextCheckAt} is not null`,
            isNull(issues.assigneeUserId),
            sql`${issues.assigneeAgentId} is not null`,
            inArray(issues.status, ["in_progress", "in_review"]),
            or(
              isNull(issues.monitorWakeRequestedAt),
              lt(issues.monitorWakeRequestedAt, staleClaimThreshold),
            ),
          ),
        )
        .returning();
      return (updated ?? null) as IssueMonitorDispatchRow | null;
    });

    if (!claimed) {
      throw conflict("Issue monitor check is already in progress");
    }

    return dispatchClaimedIssueMonitor(claimed, {
      now,
      source: "on_demand",
      triggerDetail: "manual",
      wakeReason: input?.wakeReason ?? "issue_monitor_due",
      actorType,
      actorId,
      agentId: input?.agentId ?? null,
      runId: input?.runId ?? null,
      clearOnClientError: false,
      activitySource: "manual",
    });
  }

  async function tickDueIssueMonitors(now = new Date()) {
    const staleClaimThreshold = new Date(now.getTime() - 5 * 60 * 1000);
    const dueMonitors = await db
      .select(issueMonitorDispatchColumns)
      .from(issues)
      .where(
        and(
          sql`${issues.monitorNextCheckAt} is not null`,
          lte(issues.monitorNextCheckAt, now),
          isNull(issues.assigneeUserId),
          sql`${issues.assigneeAgentId} is not null`,
          inArray(issues.status, ["in_progress", "in_review"]),
          or(
            isNull(issues.monitorWakeRequestedAt),
            lt(issues.monitorWakeRequestedAt, staleClaimThreshold),
          ),
        ),
      )
      .orderBy(asc(issues.monitorNextCheckAt), asc(issues.updatedAt))
      .limit(50);

    let triggered = 0;
    let skipped = 0;

    for (const due of dueMonitors) {
      const claimed = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(issues)
          .set({
            monitorWakeRequestedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(issues.id, due.id),
              sql`${issues.monitorNextCheckAt} is not null`,
              lte(issues.monitorNextCheckAt, now),
              isNull(issues.assigneeUserId),
              sql`${issues.assigneeAgentId} is not null`,
              inArray(issues.status, ["in_progress", "in_review"]),
              or(
                isNull(issues.monitorWakeRequestedAt),
                lt(issues.monitorWakeRequestedAt, staleClaimThreshold),
              ),
            ),
          )
          .returning();
        return (updated ?? null) as IssueMonitorDispatchRow | null;
      });

      if (!claimed) continue;

      try {
        const result = await dispatchClaimedIssueMonitor(claimed, {
          now,
          source: "automation",
          triggerDetail: "system",
          wakeReason: "issue_monitor_due",
          actorType: "system",
          actorId: "heartbeat_scheduler",
          agentId: null,
          runId: null,
          clearOnClientError: true,
          activitySource: "scheduled",
        });
        if (result.outcome === "triggered") triggered += 1;
        if (result.outcome === "skipped") skipped += 1;
      } catch (err) {
        logger.error({ err, issueId: claimed.id }, "issue monitor tick failed");
      }
    }

    return {
      checked: dueMonitors.length,
      triggered,
      skipped,
    };
  }

  async function getOldestRunForSession(agentId: string, sessionId: string) {
    return db
      .select({
        id: heartbeatRuns.id,
        createdAt: heartbeatRuns.createdAt,
      })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.sessionIdAfter, sessionId)))
      .orderBy(asc(heartbeatRuns.createdAt), asc(heartbeatRuns.id))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function resolveNormalizedUsageForSession(input: {
    agentId: string;
    runId: string;
    sessionId: string | null;
    rawUsage: UsageTotals | null;
  }) {
    const { agentId, runId, sessionId, rawUsage } = input;
    if (!sessionId || !rawUsage) {
      return {
        normalizedUsage: rawUsage,
        previousRawUsage: null as UsageTotals | null,
        derivedFromSessionTotals: false,
      };
    }

    const previousRun = await getLatestRunForSession(agentId, sessionId, { excludeRunId: runId });
    const previousRawUsage = readRawUsageTotals(previousRun?.usageJson);
    return {
      normalizedUsage: deriveNormalizedUsageDelta(rawUsage, previousRawUsage),
      previousRawUsage,
      derivedFromSessionTotals: previousRawUsage !== null,
    };
  }

  async function evaluateSessionCompaction(input: {
    agent: typeof agents.$inferSelect;
    sessionId: string | null;
    issueId: string | null;
    continuationSummaryBody?: string | null;
  }): Promise<SessionCompactionDecision> {
    const { agent, sessionId, issueId } = input;
    if (!sessionId) {
      return {
        rotate: false,
        reason: null,
        handoffMarkdown: null,
        previousRunId: null,
      };
    }

    const policy = parseSessionCompactionPolicy(agent);
    if (!policy.enabled || !hasSessionCompactionThresholds(policy)) {
      return {
        rotate: false,
        reason: null,
        handoffMarkdown: null,
        previousRunId: null,
      };
    }

    const fetchLimit = Math.max(policy.maxSessionRuns > 0 ? policy.maxSessionRuns + 1 : 0, 4);
    const runs = await db
      .select({
        id: heartbeatRuns.id,
        createdAt: heartbeatRuns.createdAt,
        usageJson: heartbeatRuns.usageJson,
        error: heartbeatRuns.error,
        ...heartbeatRunListResultColumns,
      })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agent.id), eq(heartbeatRuns.sessionIdAfter, sessionId)))
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(fetchLimit);

    if (runs.length === 0) {
      return {
        rotate: false,
        reason: null,
        handoffMarkdown: null,
        previousRunId: null,
      };
    }

    const latestRun = runs[0] ?? null;
    const oldestRun =
      policy.maxSessionAgeHours > 0
        ? await getOldestRunForSession(agent.id, sessionId)
        : runs[runs.length - 1] ?? latestRun;
    const latestRawUsage = readRawUsageTotals(latestRun?.usageJson);
    const sessionAgeHours =
      latestRun && oldestRun
        ? Math.max(
            0,
            (new Date(latestRun.createdAt).getTime() - new Date(oldestRun.createdAt).getTime()) / (1000 * 60 * 60),
          )
        : 0;

    let reason: string | null = null;
    if (policy.maxSessionRuns > 0 && runs.length > policy.maxSessionRuns) {
      reason = `session exceeded ${policy.maxSessionRuns} runs`;
    } else if (
      policy.maxRawInputTokens > 0 &&
      latestRawUsage &&
      latestRawUsage.inputTokens >= policy.maxRawInputTokens
    ) {
      reason =
        `session raw input reached ${formatCount(latestRawUsage.inputTokens)} tokens ` +
        `(threshold ${formatCount(policy.maxRawInputTokens)})`;
    } else if (policy.maxSessionAgeHours > 0 && sessionAgeHours >= policy.maxSessionAgeHours) {
      reason = `session age reached ${Math.floor(sessionAgeHours)} hours`;
    }

    if (!reason || !latestRun) {
      return {
        rotate: false,
        reason: null,
        handoffMarkdown: null,
        previousRunId: latestRun?.id ?? null,
      };
    }

    const latestSummary = summarizeHeartbeatRunListResultJson({
      summary: latestRun?.resultSummary,
      result: latestRun?.resultResult,
      message: latestRun?.resultMessage,
      error: latestRun?.resultError,
      totalCostUsd: latestRun?.resultTotalCostUsd,
      costUsd: latestRun?.resultCostUsd,
      costUsdCamel: latestRun?.resultCostUsdCamel,
    });
    const latestTextSummary =
      readNonEmptyString(latestSummary?.summary) ??
      readNonEmptyString(latestSummary?.result) ??
      readNonEmptyString(latestSummary?.message) ??
      readNonEmptyString(latestRun.error);

    const handoffMarkdown = [
      "Paperclip session handoff:",
      `- Previous session: ${sessionId}`,
      issueId ? `- Issue: ${issueId}` : "",
      `- Rotation reason: ${reason}`,
      latestTextSummary ? `- Last run summary: ${latestTextSummary}` : "",
      input.continuationSummaryBody
        ? `- Issue continuation summary: ${input.continuationSummaryBody.slice(0, 1_500)}`
        : "",
      "Continue from the current task state. Rebuild only the minimum context you need.",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      rotate: true,
      reason,
      handoffMarkdown,
      previousRunId: latestRun.id,
    };
  }

  async function resolveSessionBeforeForWakeup(
    agent: typeof agents.$inferSelect,
    taskKey: string | null,
  ) {
    if (taskKey) {
      const codec = getAdapterSessionCodec(agent.adapterType);
      const existingTaskSession = await getTaskSession(
        agent.companyId,
        agent.id,
        agent.adapterType,
        taskKey,
      );
      const parsedParams = normalizeSessionParams(
        codec.deserialize(existingTaskSession?.sessionParamsJson ?? null),
      );
      return truncateDisplayId(
        existingTaskSession?.sessionDisplayId ??
          (codec.getDisplayId ? codec.getDisplayId(parsedParams) : null) ??
          readNonEmptyString(parsedParams?.sessionId),
      );
    }

    const runtimeForRun = await getRuntimeState(agent.id);
    return runtimeForRun?.sessionId ?? null;
  }

  async function resolveExplicitResumeSessionOverride(
    agent: typeof agents.$inferSelect,
    payload: Record<string, unknown> | null,
    taskKey: string | null,
  ) {
    const resumeFromRunId = readNonEmptyString(payload?.resumeFromRunId);
    if (!resumeFromRunId) return null;

    const resumeRun = await db
      .select({
        id: heartbeatRuns.id,
        contextSnapshot: heartbeatRuns.contextSnapshot,
        sessionIdBefore: heartbeatRuns.sessionIdBefore,
        sessionIdAfter: heartbeatRuns.sessionIdAfter,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.id, resumeFromRunId),
          eq(heartbeatRuns.companyId, agent.companyId),
          eq(heartbeatRuns.agentId, agent.id),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!resumeRun) return null;

    const resumeContext = parseObject(resumeRun.contextSnapshot);
    const resumeTaskKey = deriveTaskKey(resumeContext, null) ?? taskKey;
    const resumeTaskSession = resumeTaskKey
      ? await getTaskSession(agent.companyId, agent.id, agent.adapterType, resumeTaskKey)
      : null;
    const sessionCodec = getAdapterSessionCodec(agent.adapterType);
    const sessionOverride = buildExplicitResumeSessionOverride({
      resumeFromRunId,
      resumeRunSessionIdBefore: resumeRun.sessionIdBefore,
      resumeRunSessionIdAfter: resumeRun.sessionIdAfter,
      taskSession: resumeTaskSession,
      sessionCodec,
    });
    if (!sessionOverride) return null;

    return {
      resumeFromRunId,
      taskKey: resumeTaskKey,
      issueId: readNonEmptyString(resumeContext.issueId),
      taskId: readNonEmptyString(resumeContext.taskId) ?? readNonEmptyString(resumeContext.issueId),
      sessionDisplayId: sessionOverride.sessionDisplayId,
      sessionParams: sessionOverride.sessionParams,
    };
  }

  async function resolveWorkspaceForRun(
    agent: typeof agents.$inferSelect,
    context: Record<string, unknown>,
    previousSessionParams: Record<string, unknown> | null,
    opts?: { useProjectWorkspace?: boolean | null },
  ): Promise<ResolvedWorkspaceForRun> {
    const issueId = readNonEmptyString(context.issueId);
    const contextProjectId = readNonEmptyString(context.projectId);
    const contextProjectWorkspaceId = readNonEmptyString(context.projectWorkspaceId);
    const issueProjectRef = issueId
      ? await db
          .select({
            projectId: issues.projectId,
            projectWorkspaceId: issues.projectWorkspaceId,
          })
          .from(issues)
          .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
          .then((rows) => rows[0] ?? null)
      : null;
    const preferredProjectWorkspaceId =
      issueProjectRef?.projectWorkspaceId ?? contextProjectWorkspaceId ?? null;
    let issueProjectId = issueProjectRef?.projectId ?? null;
    if (!issueProjectId && preferredProjectWorkspaceId) {
      issueProjectId = await db
        .select({ projectId: projectWorkspaces.projectId })
        .from(projectWorkspaces)
        .where(
          and(
            eq(projectWorkspaces.id, preferredProjectWorkspaceId),
            eq(projectWorkspaces.companyId, agent.companyId),
          ),
        )
        .then((rows) => rows[0]?.projectId ?? null);
    }
    const resolvedProjectId = issueProjectId ?? contextProjectId;
    const useProjectWorkspace = opts?.useProjectWorkspace !== false;
    const workspaceProjectId = useProjectWorkspace ? resolvedProjectId : null;

    const unorderedProjectWorkspaceRows = workspaceProjectId
      ? await db
          .select()
          .from(projectWorkspaces)
          .where(
            and(
              eq(projectWorkspaces.companyId, agent.companyId),
              eq(projectWorkspaces.projectId, workspaceProjectId),
            ),
          )
          .orderBy(asc(projectWorkspaces.createdAt), asc(projectWorkspaces.id))
      : [];
    const projectWorkspaceRows = prioritizeProjectWorkspaceCandidatesForRun(
      unorderedProjectWorkspaceRows,
      preferredProjectWorkspaceId,
    );

    const workspaceHints = projectWorkspaceRows.map((workspace) => ({
      workspaceId: workspace.id,
      cwd: readNonEmptyString(workspace.cwd),
      repoUrl: readNonEmptyString(workspace.repoUrl),
      repoRef: readNonEmptyString(workspace.repoRef),
    }));

    if (projectWorkspaceRows.length > 0) {
      const preferredWorkspace = preferredProjectWorkspaceId
        ? projectWorkspaceRows.find((workspace) => workspace.id === preferredProjectWorkspaceId) ?? null
        : null;
      const missingProjectCwds: string[] = [];
      let hasConfiguredProjectCwd = false;
      let preferredWorkspaceWarning: string | null = null;
      if (preferredProjectWorkspaceId && !preferredWorkspace) {
        preferredWorkspaceWarning =
          `Selected project workspace "${preferredProjectWorkspaceId}" is not available on this project.`;
      }
      for (const workspace of projectWorkspaceRows) {
        let projectCwd = readNonEmptyString(workspace.cwd);
        let managedWorkspaceWarning: string | null = null;
        if (!projectCwd || projectCwd === REPO_ONLY_CWD_SENTINEL) {
          try {
            const managedWorkspace = await ensureManagedProjectWorkspace({
              companyId: agent.companyId,
              projectId: workspaceProjectId ?? resolvedProjectId ?? workspace.projectId,
              repoUrl: readNonEmptyString(workspace.repoUrl),
            });
            projectCwd = managedWorkspace.cwd;
            managedWorkspaceWarning = managedWorkspace.warning;
          } catch (error) {
            if (preferredWorkspace?.id === workspace.id) {
              preferredWorkspaceWarning = error instanceof Error ? error.message : String(error);
            }
            continue;
          }
        }
        hasConfiguredProjectCwd = true;
        const projectCwdExists = await fs
          .stat(projectCwd)
          .then((stats) => stats.isDirectory())
          .catch(() => false);
        if (projectCwdExists) {
          return {
            cwd: projectCwd,
            source: "project_primary" as const,
            projectId: resolvedProjectId,
            workspaceId: workspace.id,
            repoUrl: workspace.repoUrl,
            repoRef: workspace.repoRef,
            workspaceHints,
            warnings: [preferredWorkspaceWarning, managedWorkspaceWarning].filter(
              (value): value is string => Boolean(value),
            ),
          };
        }
        if (preferredWorkspace?.id === workspace.id) {
          preferredWorkspaceWarning =
            `Selected project workspace path "${projectCwd}" is not available yet.`;
        }
        missingProjectCwds.push(projectCwd);
      }

      const fallbackCwd = resolveDefaultAgentWorkspaceDir(agent.id);
      await fs.mkdir(fallbackCwd, { recursive: true });
      const warnings: string[] = [];
      if (preferredWorkspaceWarning) {
        warnings.push(preferredWorkspaceWarning);
      }
      if (missingProjectCwds.length > 0) {
        const firstMissing = missingProjectCwds[0];
        const extraMissingCount = Math.max(0, missingProjectCwds.length - 1);
        warnings.push(
          extraMissingCount > 0
            ? `Project workspace path "${firstMissing}" and ${extraMissingCount} other configured path(s) are not available yet. Using fallback workspace "${fallbackCwd}" for this run.`
            : `Project workspace path "${firstMissing}" is not available yet. Using fallback workspace "${fallbackCwd}" for this run.`,
        );
      } else if (!hasConfiguredProjectCwd) {
        warnings.push(
          `Project workspace has no local cwd configured. Using fallback workspace "${fallbackCwd}" for this run.`,
        );
      }
      return {
        cwd: fallbackCwd,
        source: "project_primary" as const,
        projectId: resolvedProjectId,
        workspaceId: projectWorkspaceRows[0]?.id ?? null,
        repoUrl: projectWorkspaceRows[0]?.repoUrl ?? null,
        repoRef: projectWorkspaceRows[0]?.repoRef ?? null,
        workspaceHints,
        warnings,
      };
    }

    if (workspaceProjectId) {
      const managedWorkspace = await ensureManagedProjectWorkspace({
        companyId: agent.companyId,
        projectId: workspaceProjectId,
        repoUrl: null,
      });
      return {
        cwd: managedWorkspace.cwd,
        source: "project_primary" as const,
        projectId: resolvedProjectId,
        workspaceId: null,
        repoUrl: null,
        repoRef: null,
        workspaceHints,
        warnings: managedWorkspace.warning ? [managedWorkspace.warning] : [],
      };
    }

    const sessionCwd = readNonEmptyString(previousSessionParams?.cwd);
    if (sessionCwd) {
      const sessionCwdExists = await fs
        .stat(sessionCwd)
        .then((stats) => stats.isDirectory())
        .catch(() => false);
      if (sessionCwdExists) {
        return {
          cwd: sessionCwd,
          source: "task_session" as const,
          projectId: resolvedProjectId,
          workspaceId: readNonEmptyString(previousSessionParams?.workspaceId),
          repoUrl: readNonEmptyString(previousSessionParams?.repoUrl),
          repoRef: readNonEmptyString(previousSessionParams?.repoRef),
          workspaceHints,
          warnings: [],
        };
      }
    }

    const cwd = resolveDefaultAgentWorkspaceDir(agent.id);
    await fs.mkdir(cwd, { recursive: true });
    const warnings: string[] = [];
    if (sessionCwd) {
      warnings.push(
        `Saved session workspace "${sessionCwd}" is not available. Using fallback workspace "${cwd}" for this run.`,
      );
    } else if (resolvedProjectId) {
      warnings.push(
        `No project workspace directory is currently available for this issue. Using fallback workspace "${cwd}" for this run.`,
      );
    } else {
      warnings.push(
        `No project or prior session workspace was available. Using fallback workspace "${cwd}" for this run.`,
      );
    }
    return {
      cwd,
      source: "agent_home" as const,
      projectId: resolvedProjectId,
      workspaceId: null,
      repoUrl: null,
      repoRef: null,
      workspaceHints,
      warnings,
    };
  }

  async function upsertTaskSession(input: {
    companyId: string;
    agentId: string;
    adapterType: string;
    taskKey: string;
    sessionParamsJson: Record<string, unknown> | null;
    sessionDisplayId: string | null;
    lastRunId: string | null;
    lastError: string | null;
  }) {
    const existing = await getTaskSession(
      input.companyId,
      input.agentId,
      input.adapterType,
      input.taskKey,
    );
    if (existing) {
      return db
        .update(agentTaskSessions)
        .set({
          sessionParamsJson: input.sessionParamsJson,
          sessionDisplayId: input.sessionDisplayId,
          lastRunId: input.lastRunId,
          lastError: input.lastError,
          updatedAt: new Date(),
        })
        .where(eq(agentTaskSessions.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? null);
    }

    return db
      .insert(agentTaskSessions)
      .values({
        companyId: input.companyId,
        agentId: input.agentId,
        adapterType: input.adapterType,
        taskKey: input.taskKey,
        sessionParamsJson: input.sessionParamsJson,
        sessionDisplayId: input.sessionDisplayId,
        lastRunId: input.lastRunId,
        lastError: input.lastError,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function clearTaskSessions(
    companyId: string,
    agentId: string,
    opts?: { taskKey?: string | null; adapterType?: string | null },
  ) {
    const conditions = [
      eq(agentTaskSessions.companyId, companyId),
      eq(agentTaskSessions.agentId, agentId),
    ];
    if (opts?.taskKey) {
      conditions.push(eq(agentTaskSessions.taskKey, opts.taskKey));
    }
    if (opts?.adapterType) {
      conditions.push(eq(agentTaskSessions.adapterType, opts.adapterType));
    }

    return db
      .delete(agentTaskSessions)
      .where(and(...conditions))
      .returning()
      .then((rows) => rows.length);
  }

  async function ensureRuntimeState(agent: typeof agents.$inferSelect) {
    const existing = await getRuntimeState(agent.id);
    if (existing) return existing;

    const inserted = await db
      .insert(agentRuntimeState)
      .values({
        agentId: agent.id,
        companyId: agent.companyId,
        adapterType: agent.adapterType,
        stateJson: {},
      })
      .onConflictDoNothing({
        target: agentRuntimeState.agentId,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
    if (inserted) return inserted;

    const ensured = await getRuntimeState(agent.id);
    if (!ensured) {
      throw new Error(`Failed to ensure runtime state for agent ${agent.id}`);
    }
    return ensured;
  }

  function noOpenRoutineExecutionDuplicateForIssue() {
    return sql`not exists (
      select 1
      from issues routine_duplicate
      where routine_duplicate.company_id = ${issues.companyId}
        and routine_duplicate.origin_kind = 'routine_execution'
        and routine_duplicate.origin_id = ${issues.originId}
        and routine_duplicate.origin_fingerprint = ${issues.originFingerprint}
        and routine_duplicate.hidden_at is null
        and routine_duplicate.execution_run_id is not null
        and routine_duplicate.status in ('backlog', 'todo', 'in_progress', 'in_review', 'blocked')
        and routine_duplicate.id <> ${issues.id}
    )`;
  }
  async function setRunStatus(
    runId: string,
    status: string,
    patch?: Partial<typeof heartbeatRuns.$inferInsert>,
  ) {
    // Defense-in-depth: clamp `exitCode` to signed int32 range before
    // Drizzle/Postgres rejects it. Windows reports unsigned 32-bit exit
    // codes, so a crashed/signal-killed subprocess (-1) reaches us as
    // 4294967295, which overflows the INT4 column and leaves the run row
    // stuck in `running` forever. Individual adapters normalize at their
    // boundary too (e.g. codex-local/execute.ts normalizeExitCode), but
    // this safeguard ensures any future adapter that forgets cannot
    // wedge the run lifecycle.
    let safePatch = patch;
    if (patch && "exitCode" in patch) {
      const raw = patch.exitCode;
      let safe: number | null | undefined = raw as number | null | undefined;
      if (typeof raw === "number" && Number.isFinite(raw)) {
        const INT32_MAX = 2147483647;
        const INT32_MIN = -2147483648;
        if (raw > INT32_MAX) safe = raw - 4294967296;
        else if (raw < INT32_MIN) safe = INT32_MIN;
      } else if (typeof raw === "number" && !Number.isFinite(raw)) {
        safe = null;
      }
      if (safe !== raw) {
        logger.warn(
          { runId, rawExitCode: raw, normalizedExitCode: safe },
          "clamped out-of-range exit code before run-status update",
        );
        safePatch = { ...patch, exitCode: safe };
      }
    }

    const updated = await db
      .update(heartbeatRuns)
      .set({ status, ...safePatch, updatedAt: new Date() })
      .where(eq(heartbeatRuns.id, runId))
      .returning()
      .then((rows) => rows[0] ?? null);

    if (updated) {
      publishLiveEvent({
        companyId: updated.companyId,
        type: "heartbeat.run.status",
        payload: {
          runId: updated.id,
          agentId: updated.agentId,
          status: updated.status,
          invocationSource: updated.invocationSource,
          triggerDetail: updated.triggerDetail,
          error: updated.error ?? null,
          errorCode: updated.errorCode ?? null,
          startedAt: updated.startedAt ? new Date(updated.startedAt).toISOString() : null,
          finishedAt: updated.finishedAt ? new Date(updated.finishedAt).toISOString() : null,
        },
      });
      publishRunLifecyclePluginEvent(updated);
      // Fire internal lifecycle hooks (vault memory writer, etc).
      // Registry isolates per-hook errors; we fire-and-forget so the hot
      // path is not blocked by filesystem writes.
      // Paperclip's heartbeat run terminal statuses (mirrors
      // publishRunLifecyclePluginEvent above): `succeeded` is the canonical
      // success state; older / alternative values are accepted defensively.
      const lifecycleEvent =
        status === "succeeded" || status === "completed" || status === "success" || status === "done"
          ? "run.after.success"
          : status === "failed" || status === "timed_out"
            ? "run.after.failure"
            : status === "cancelled"
              ? "run.after.cancelled"
              : null;
      if (lifecycleEvent) {
        void (async () => {
          try {
            const agent = await db.query.agents.findFirst({ where: eq(agents.id, updated.agentId) });
            if (agent) {
              await lifecycleHooks.firePost(lifecycleEvent, { db, agent, run: updated });
            }
          } catch (err) {
            logger.warn({ err, event: lifecycleEvent, runId: updated.id }, "lifecycle hook dispatch failed");
          }
        })();
      }
    }

    return updated;
  }

  function publishRunLifecyclePluginEvent(run: typeof heartbeatRuns.$inferSelect) {
    const eventType =
      run.status === "running"
        ? "agent.run.started"
        : run.status === "succeeded"
          ? "agent.run.finished"
          : run.status === "failed" || run.status === "timed_out"
            ? "agent.run.failed"
            : run.status === "cancelled"
              ? "agent.run.cancelled"
              : null;
    if (!eventType) return;
    publishPluginDomainEvent({
      eventId: randomUUID(),
      eventType,
      occurredAt: new Date().toISOString(),
      actorId: run.agentId,
      actorType: "agent",
      entityId: run.id,
      entityType: "heartbeat_run",
      companyId: run.companyId,
      payload: {
        runId: run.id,
        agentId: run.agentId,
        status: run.status,
        invocationSource: run.invocationSource,
        triggerDetail: run.triggerDetail,
        error: run.error ?? null,
        errorCode: run.errorCode ?? null,
        issueId: typeof run.contextSnapshot === "object" && run.contextSnapshot !== null
          ? (run.contextSnapshot as Record<string, unknown>).issueId ?? null
          : null,
        startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : null,
        finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
      },
    });
  }

  async function setWakeupStatus(
    wakeupRequestId: string | null | undefined,
    status: string,
    patch?: Partial<typeof agentWakeupRequests.$inferInsert>,
  ) {
    if (!wakeupRequestId) return;
    await db
      .update(agentWakeupRequests)
      .set({ status, ...patch, updatedAt: new Date() })
      .where(eq(agentWakeupRequests.id, wakeupRequestId));
  }

  async function addContinuationExhaustedCommentOnce(input: {
    run: typeof heartbeatRuns.$inferSelect;
    issueId: string;
    comment: string;
  }) {
    const existing = await db
      .select({ id: issueComments.id })
      .from(issueComments)
      .where(
        and(
          eq(issueComments.companyId, input.run.companyId),
          eq(issueComments.issueId, input.issueId),
          eq(issueComments.createdByRunId, input.run.id),
          sql`${issueComments.body} like 'Bounded liveness continuation exhausted%'`,
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (existing) return;
    await issuesSvc.addComment(input.issueId, input.comment, {
      agentId: input.run.agentId,
      runId: input.run.id,
    });
  }

  async function handleRunLivenessContinuation(run: typeof heartbeatRuns.$inferSelect) {
    const livenessState = run.livenessState as RunLivenessState | null;
    if (livenessState !== "plan_only" && livenessState !== "empty_response") return;

    const context = parseObject(run.contextSnapshot);
    const issueId = readNonEmptyString(context.issueId);
    if (!issueId) return;

    const [issue, agent] = await Promise.all([
      db
        .select({
          id: issues.id,
          companyId: issues.companyId,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          assigneeAgentId: issues.assigneeAgentId,
          executionState: issues.executionState,
          projectId: issues.projectId,
        })
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.companyId, run.companyId)))
        .then((rows) => rows[0] ?? null),
      db
        .select({
          id: agents.id,
          companyId: agents.companyId,
          status: agents.status,
        })
        .from(agents)
        .where(eq(agents.id, run.agentId))
        .then((rows) => rows[0] ?? null),
    ]);

    const budgetBlock =
      issue && agent
        ? await budgets.getInvocationBlock(issue.companyId, agent.id, {
          issueId: issue.id,
          projectId: issue.projectId,
        })
        : null;
    if (issue) {
      const productivityHold = await productivityReviews.isProductivityReviewContinuationHoldActive({
        companyId: issue.companyId,
        issueId: issue.id,
        agentId: run.agentId,
      });
      if (productivityHold.held) {
        await setRunStatus(run.id, run.status, {
          livenessReason:
            `${run.livenessReason ?? "Run ended without concrete progress"}; continuation held by productivity review ${productivityHold.reviewIdentifier ?? productivityHold.reviewIssueId}`,
        });
        await productivityReviews.recordContinuationHold({
          companyId: issue.companyId,
          issueId: issue.id,
          runId: run.id,
          agentId: run.agentId,
          reviewIssueId: productivityHold.reviewIssueId,
          trigger: productivityHold.trigger,
          reason: productivityHold.reason,
        });
        return;
      }
    }

    const nextAttempt = readContinuationAttempt(run.continuationAttempt) + 1;
    const idempotencyKey = issue
      ? buildRunLivenessContinuationIdempotencyKey({
        issueId: issue.id,
        sourceRunId: run.id,
        livenessState,
        nextAttempt,
      })
      : null;
    const existingWake = idempotencyKey
      ? await findExistingRunLivenessContinuationWake(db, {
        companyId: run.companyId,
        idempotencyKey,
      })
      : null;

    const decision = decideRunLivenessContinuation({
      run,
      issue,
      agent,
      livenessState,
      livenessReason: run.livenessReason,
      nextAction: run.nextAction,
      budgetBlocked: Boolean(budgetBlock),
      idempotentWakeExists: Boolean(existingWake),
    });

    if (decision.kind === "exhausted") {
      await setRunStatus(run.id, run.status, {
        livenessReason: `${run.livenessReason ?? "Run ended without concrete progress"}; continuation attempts exhausted`,
      });
      await addContinuationExhaustedCommentOnce({
        run,
        issueId,
        comment: decision.comment,
      });
      return;
    }

    if (decision.kind !== "enqueue") return;

    const continuationRun = await enqueueWakeup(run.agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: RUN_LIVENESS_CONTINUATION_REASON,
      payload: decision.payload,
      contextSnapshot: decision.contextSnapshot,
      idempotencyKey: decision.idempotencyKey,
      requestedByActorType: "system",
      requestedByActorId: "heartbeat",
    });

    if (continuationRun) {
      await db
        .update(heartbeatRuns)
        .set({
          continuationAttempt: decision.nextAttempt,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, continuationRun.id));
    }
  }

  function issueUiLink(issue: Pick<typeof issues.$inferSelect, "id" | "identifier">) {
    const label = issue.identifier ?? issue.id;
    const prefix = issue.identifier?.split("-")[0] || "PAP";
    return `[${label}](/${prefix}/issues/${label})`;
  }

  async function buildDetectedSuccessfulRunProgressSummary(run: typeof heartbeatRuns.$inferSelect) {
    const resultJson = parseObject(run.resultJson);
    const candidates = [
      readNonEmptyString(run.nextAction) ? `Next action noted: ${readNonEmptyString(run.nextAction)}` : null,
      readNonEmptyString(run.livenessReason),
      readNonEmptyString(resultJson.summary),
      readNonEmptyString(resultJson.result),
      readNonEmptyString(resultJson.message),
    ].filter((value): value is string => Boolean(value));
    const summary = candidates[0];
    if (!summary) return null;
    return redactDetectedSuccessfulRunProgressSummaryForBoard(
      summary,
      await getCurrentUserRedactionOptions(),
    );
  }

  async function addSuccessfulRunHandoffCommentOnce(input: {
    issue: Pick<typeof issues.$inferSelect, "id" | "identifier" | "title" | "status">;
    run: typeof heartbeatRuns.$inferSelect;
    agent: Pick<typeof agents.$inferSelect, "id" | "name">;
    detectedProgressSummary: string;
  }) {
    const existing = await db
      .select({ id: issueComments.id })
      .from(issueComments)
      .where(
        and(
          eq(issueComments.companyId, input.run.companyId),
          eq(issueComments.issueId, input.issue.id),
          eq(issueComments.createdByRunId, input.run.id),
          sql`(${issueComments.body} = ${SUCCESSFUL_RUN_HANDOFF_REQUIRED_NOTICE_BODY} or ${issueComments.body} like '## This issue still needs a next step%' or ${issueComments.body} like '## Successful run missing issue disposition%')`,
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (existing) return null;
    const notice = buildSuccessfulRunHandoffRequiredNotice(input);
    return issuesSvc.addComment(
      input.issue.id,
      notice.body,
      { runId: input.run.id },
      {
        authorType: "system",
        presentation: notice.presentation,
        metadata: notice.metadata,
      },
    );
  }

  async function handleSuccessfulRunHandoff(run: typeof heartbeatRuns.$inferSelect, agent: typeof agents.$inferSelect) {
    if (run.status !== "succeeded") return;
    const context = parseObject(run.contextSnapshot);
    const issueId = readNonEmptyString(context.issueId) ?? readNonEmptyString(context.taskId);
    if (!issueId) return;

    const issue = await db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        identifier: issues.identifier,
        title: issues.title,
        status: issues.status,
        assigneeAgentId: issues.assigneeAgentId,
        assigneeUserId: issues.assigneeUserId,
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
        executionState: issues.executionState,
        projectId: issues.projectId,
      })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.companyId, run.companyId)))
      .then((rows) => rows[0] ?? null);
    const idempotencyKey = issue
      ? buildFinishSuccessfulRunHandoffIdempotencyKey({
        issueId: issue.id,
        sourceRunId: run.id,
      })
      : null;
    if (
      issue &&
      issue.status === "in_progress" &&
      issue.assigneeAgentId === run.agentId &&
      issue.executionRunId === run.id &&
      readNonEmptyString(context[PAPERCLIP_PRE_CHECKOUT_STATUS_KEY]) === "blocked"
    ) {
      await db
        .update(issues)
        .set({
          status: "blocked",
          checkoutRunId: null,
          executionRunId: null,
          executionAgentNameKey: null,
          executionLockedAt: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(issues.id, issue.id),
          eq(issues.companyId, issue.companyId),
          eq(issues.executionRunId, run.id),
        ));
      return;
    }
    const taskKey = deriveTaskKeyWithHeartbeatFallback(context, null);
    const detectedProgressSummary = await buildDetectedSuccessfulRunProgressSummary(run);

    const [
      activeExecutionPath,
      queuedWake,
      pendingInteraction,
      pendingApproval,
      explicitBlocker,
      openRecoveryIssue,
      existingWake,
      budgetBlock,
      pauseHold,
    ] = await Promise.all([
      issue
        ? db
          .select({ id: heartbeatRuns.id })
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, issue.companyId),
              eq(heartbeatRuns.agentId, run.agentId),
              inArray(heartbeatRuns.status, [...EXECUTION_PATH_HEARTBEAT_RUN_STATUSES]),
              sql`(
                ${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issue.id}
                or ${heartbeatRuns.contextSnapshot} ->> 'taskId' = ${issue.id}
              )`,
              sql`${heartbeatRuns.id} <> ${run.id}`,
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      issue
        ? db
          .select({ id: agentWakeupRequests.id })
          .from(agentWakeupRequests)
          .where(
            and(
              eq(agentWakeupRequests.companyId, issue.companyId),
              eq(agentWakeupRequests.agentId, run.agentId),
              inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution", "claimed"]),
              sql`(
                ${agentWakeupRequests.payload} ->> 'issueId' = ${issue.id}
                or ${agentWakeupRequests.payload} ->> 'taskId' = ${issue.id}
                or ${agentWakeupRequests.payload} -> '_paperclipWakeContext' ->> 'issueId' = ${issue.id}
                or ${agentWakeupRequests.payload} -> '_paperclipWakeContext' ->> 'taskId' = ${issue.id}
              )`,
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      issue
        ? db
          .select({ id: issueThreadInteractions.id })
          .from(issueThreadInteractions)
          .where(
            and(
              eq(issueThreadInteractions.companyId, issue.companyId),
              eq(issueThreadInteractions.issueId, issue.id),
              eq(issueThreadInteractions.status, "pending"),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      issue
        ? db
          .select({ id: issueApprovals.approvalId })
          .from(issueApprovals)
          .innerJoin(approvals, eq(issueApprovals.approvalId, approvals.id))
          .where(
            and(
              eq(issueApprovals.companyId, issue.companyId),
              eq(issueApprovals.issueId, issue.id),
              inArray(approvals.status, ["pending", "revision_requested"]),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      issue
        ? db
          .select({ id: issueRelations.issueId })
          .from(issueRelations)
          .where(
            and(
              eq(issueRelations.companyId, issue.companyId),
              eq(issueRelations.relatedIssueId, issue.id),
              eq(issueRelations.type, "blocks"),
              sql`exists (
                select 1
                from issues blocker
                where blocker.id = ${issueRelations.issueId}
                  and blocker.company_id = ${issue.companyId}
                  and blocker.status not in ('done', 'cancelled')
                  and blocker.hidden_at is null
              )`,
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      issue
        ? db
          .select({ id: issues.id })
          .from(issues)
          .where(
            and(
              eq(issues.companyId, issue.companyId),
              inArray(issues.originKind, [
                RECOVERY_ORIGIN_KINDS.strandedIssueRecovery,
                RECOVERY_ORIGIN_KINDS.issueGraphLivenessEscalation,
              ]),
              eq(issues.originId, issue.id),
              isNull(issues.hiddenAt),
              notInArray(issues.status, ["done", "cancelled"]),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      idempotencyKey
        ? findExistingFinishSuccessfulRunHandoffWake(db, {
          companyId: run.companyId,
          idempotencyKey,
        })
        : Promise.resolve(null),
      issue
        ? budgets.getInvocationBlock(issue.companyId, run.agentId, {
          issueId: issue.id,
          projectId: issue.projectId,
        })
        : Promise.resolve(null),
      issue
        ? treeControlSvc.getActivePauseHoldGate(issue.companyId, issue.id)
        : Promise.resolve(null),
    ]);

    const decision = decideSuccessfulRunHandoff({
      run,
      issue,
      agent,
      livenessState: run.livenessState as RunLivenessState | null,
      detectedProgressSummary,
      taskKey,
      hasActiveExecutionPath: Boolean(activeExecutionPath),
      hasQueuedWake: Boolean(queuedWake),
      hasPendingInteractionOrApproval: Boolean(pendingInteraction || pendingApproval),
      hasExplicitBlockerPath: Boolean(explicitBlocker),
      hasOpenRecoveryIssue: Boolean(openRecoveryIssue),
      hasPauseHold: Boolean(pauseHold),
      budgetBlocked: Boolean(budgetBlock),
      idempotentWakeExists: Boolean(existingWake),
    });

    if (decision.kind !== "enqueue" || !issue) return;

    const handoffRun = await enqueueWakeup(run.agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: FINISH_SUCCESSFUL_RUN_HANDOFF_REASON,
      payload: decision.payload,
      contextSnapshot: decision.contextSnapshot,
      idempotencyKey: decision.idempotencyKey,
      requestedByActorType: "system",
      requestedByActorId: "heartbeat",
    });
    if (!handoffRun) return;

    await addSuccessfulRunHandoffCommentOnce({
      issue,
      run,
      agent,
      detectedProgressSummary: detectedProgressSummary ?? "The run reported progress, but did not choose a next step.",
    });
    await logActivity(db, {
      companyId: issue.companyId,
      actorType: "system",
      actorId: "heartbeat",
      agentId: run.agentId,
      runId: run.id,
      action: "issue.successful_run_handoff_required",
      entityType: "issue",
      entityId: issue.id,
      details: {
        label: "Successful run missing issue disposition",
        sourceRunId: run.id,
        correctiveRunId: handoffRun.id,
        handoffReason: SUCCESSFUL_RUN_MISSING_STATE_REASON,
        missingDisposition: "clear_next_step",
        detectedProgressSummary,
        issue: issueUiLink(issue),
      },
    });
  }

  async function validateSuccessfulRunHandoffCompletion(
    run: typeof heartbeatRuns.$inferSelect,
    correctiveSummary?: string | null,
  ) {
    const handoffWake = run.wakeupRequestId
      ? await db
        .select({ reason: agentWakeupRequests.reason })
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.id, run.wakeupRequestId))
        .then((rows) => rows[0] ?? null)
      : null;
    if (
      !isSuccessfulRunHandoffRun(run) &&
      handoffWake?.reason !== FINISH_SUCCESSFUL_RUN_HANDOFF_REASON
    ) {
      return { kind: "not_applicable" as const, reason: "run is not a successful-run handoff" };
    }

    const context = parseObject(run.contextSnapshot);
    const issueId = readNonEmptyString(context.issueId) ?? readNonEmptyString(context.taskId);
    const issue = issueId
      ? await db
        .select({
          id: issues.id,
          companyId: issues.companyId,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          assigneeAgentId: issues.assigneeAgentId,
          assigneeUserId: issues.assigneeUserId,
          executionState: issues.executionState,
        })
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.companyId, run.companyId)))
        .then((rows) => rows[0] ?? null)
      : null;

    const [
      activeExecutionPath,
      queuedWake,
      pendingInteraction,
      pendingApproval,
      explicitBlocker,
    ] = await Promise.all([
      issue
        ? db
          .select({ id: heartbeatRuns.id })
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, issue.companyId),
              inArray(heartbeatRuns.status, [...EXECUTION_PATH_HEARTBEAT_RUN_STATUSES]),
              sql`(
                ${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issue.id}
                or ${heartbeatRuns.contextSnapshot} ->> 'taskId' = ${issue.id}
              )`,
              sql`${heartbeatRuns.id} <> ${run.id}`,
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      issue
        ? db
          .select({ id: agentWakeupRequests.id })
          .from(agentWakeupRequests)
          .where(
            and(
              eq(agentWakeupRequests.companyId, issue.companyId),
              inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution", "claimed"]),
              sql`(
                ${agentWakeupRequests.payload} ->> 'issueId' = ${issue.id}
                or ${agentWakeupRequests.payload} ->> 'taskId' = ${issue.id}
                or ${agentWakeupRequests.payload} -> '_paperclipWakeContext' ->> 'issueId' = ${issue.id}
                or ${agentWakeupRequests.payload} -> '_paperclipWakeContext' ->> 'taskId' = ${issue.id}
              )`,
              run.wakeupRequestId
                ? sql`${agentWakeupRequests.id} <> ${run.wakeupRequestId}`
                : sql`true`,
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      issue
        ? db
          .select({ id: issueThreadInteractions.id })
          .from(issueThreadInteractions)
          .where(
            and(
              eq(issueThreadInteractions.companyId, issue.companyId),
              eq(issueThreadInteractions.issueId, issue.id),
              eq(issueThreadInteractions.status, "pending"),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      issue
        ? db
          .select({ id: issueApprovals.approvalId })
          .from(issueApprovals)
          .innerJoin(approvals, eq(issueApprovals.approvalId, approvals.id))
          .where(
            and(
              eq(issueApprovals.companyId, issue.companyId),
              eq(issueApprovals.issueId, issue.id),
              inArray(approvals.status, ["pending", "revision_requested"]),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      issue
        ? db
          .select({ id: issueRelations.issueId })
          .from(issueRelations)
          .where(
            and(
              eq(issueRelations.companyId, issue.companyId),
              eq(issueRelations.relatedIssueId, issue.id),
              eq(issueRelations.type, "blocks"),
              sql`exists (
                select 1
                from issues blocker
                where blocker.id = ${issueRelations.issueId}
                  and blocker.company_id = ${issue.companyId}
                  and blocker.status not in ('done', 'cancelled')
                  and blocker.hidden_at is null
              )`,
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
    ]);

    return decideSuccessfulRunHandoffCompletion({
      run,
      issue,
      hasActiveExecutionPath: Boolean(activeExecutionPath),
      hasQueuedWake: Boolean(queuedWake),
      hasPendingInteractionOrApproval: Boolean(pendingInteraction || pendingApproval),
      hasExplicitBlockerPath: Boolean(explicitBlocker),
      correctiveSummary: correctiveSummary ??
        (typeof run.resultJson === "object" && run.resultJson !== null && "summary" in run.resultJson
          ? String((run.resultJson as { summary?: unknown }).summary ?? "")
          : null),
    });
  }

  async function appendRunEvent(
    run: typeof heartbeatRuns.$inferSelect,
    seq: number,
    event: {
      eventType: string;
      stream?: "system" | "stdout" | "stderr";
      level?: "info" | "warn" | "error";
      color?: string;
      message?: string;
      payload?: Record<string, unknown>;
    },
  ) {
    const currentUserRedactionOptions = await getCurrentUserRedactionOptions();
    const sanitizedMessage = event.message
      ? redactCurrentUserText(event.message, currentUserRedactionOptions)
      : event.message;
    const boundedPayload = event.payload
      ? boundHeartbeatRunEventPayloadForStorage(event.payload)
      : event.payload;
    const secretSanitizedPayload = boundedPayload ? redactEventPayload(boundedPayload) : boundedPayload;
    const sanitizedPayload = secretSanitizedPayload
      ? redactCurrentUserValue(secretSanitizedPayload, currentUserRedactionOptions)
      : secretSanitizedPayload;

    await db.insert(heartbeatRunEvents).values({
      companyId: run.companyId,
      runId: run.id,
      agentId: run.agentId,
      seq,
      eventType: event.eventType,
      stream: event.stream,
      level: event.level,
      color: event.color,
      message: sanitizedMessage,
      payload: sanitizedPayload,
    });

    publishLiveEvent({
      companyId: run.companyId,
      type: "heartbeat.run.event",
      payload: {
        runId: run.id,
        agentId: run.agentId,
        seq,
        eventType: event.eventType,
        stream: event.stream ?? null,
        level: event.level ?? null,
        color: event.color ?? null,
        message: sanitizedMessage ?? null,
        payload: sanitizedPayload ?? null,
      },
    });
  }

  async function nextRunEventSeq(runId: string) {
    const [row] = await db
      .select({ maxSeq: sql<number | null>`max(${heartbeatRunEvents.seq})` })
      .from(heartbeatRunEvents)
      .where(eq(heartbeatRunEvents.runId, runId));
    return Number(row?.maxSeq ?? 0) + 1;
  }

  async function persistRunProcessMetadata(
    runId: string,
    meta: { pid: number; processGroupId: number | null; startedAt: string },
  ) {
    const startedAt = new Date(meta.startedAt);
    return db
      .update(heartbeatRuns)
      .set({
        processPid: meta.pid,
        processGroupId: meta.processGroupId,
        processStartedAt: Number.isNaN(startedAt.getTime()) ? new Date() : startedAt,
        updatedAt: new Date(),
      })
      .where(eq(heartbeatRuns.id, runId))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function clearDetachedRunWarning(runId: string) {
    const updated = await db
      .update(heartbeatRuns)
      .set({
        error: null,
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.status, "running"), eq(heartbeatRuns.errorCode, DETACHED_PROCESS_ERROR_CODE)))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!updated) return null;

    await appendRunEvent(updated, await nextRunEventSeq(updated.id), {
      eventType: "lifecycle",
      stream: "system",
      level: "info",
      message: "Detached child process reported activity; cleared detached warning",
    });
    return updated;
  }

  async function patchRunIssueCommentStatus(
    runId: string,
    patch: Partial<Pick<typeof heartbeatRuns.$inferInsert, "issueCommentStatus" | "issueCommentSatisfiedByCommentId" | "issueCommentRetryQueuedAt">>,
  ) {
    return db
      .update(heartbeatRuns)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(heartbeatRuns.id, runId))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function findRunIssueComment(runId: string, companyId: string, issueId: string) {
    return db
      .select({
        id: issueComments.id,
      })
      .from(issueComments)
      .where(
        and(
          eq(issueComments.companyId, companyId),
          eq(issueComments.issueId, issueId),
          eq(issueComments.createdByRunId, runId),
        ),
      )
      .orderBy(desc(issueComments.createdAt), desc(issueComments.id))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function refreshContinuationSummaryForRun(
    run: typeof heartbeatRuns.$inferSelect,
    agent: typeof agents.$inferSelect,
  ) {
    const contextSnapshot = parseObject(run.contextSnapshot);
    const issueId = readNonEmptyString(contextSnapshot.issueId);
    if (!issueId) return null;
    try {
      return await refreshIssueContinuationSummary({
        db,
        issueId,
        run: {
          id: run.id,
          status: run.status,
          error: run.error,
          errorCode: run.errorCode,
          resultJson: run.resultJson as Record<string, unknown> | null,
          stdoutExcerpt: run.stdoutExcerpt,
          stderrExcerpt: run.stderrExcerpt,
          finishedAt: run.finishedAt,
        },
        agent: {
          id: agent.id,
          name: agent.name,
          adapterType: agent.adapterType,
        },
      });
    } catch (err) {
      logger.warn(
        {
          err,
          runId: run.id,
          issueId,
          agentId: agent.id,
        },
        "failed to refresh issue continuation summary",
      );
      return null;
    }
  }

  async function enqueueMissingIssueCommentRetry(
    run: typeof heartbeatRuns.$inferSelect,
    agent: typeof agents.$inferSelect,
    issueId: string,
  ) {
    const contextSnapshot = parseObject(run.contextSnapshot);
    const taskKey = deriveTaskKeyWithHeartbeatFallback(contextSnapshot, null);
    const sessionBefore = await resolveSessionBeforeForWakeup(agent, taskKey);
    const retryContextSnapshot = withRecoveryModelProfileHint({
      ...contextSnapshot,
      retryOfRunId: run.id,
      wakeReason: "missing_issue_comment",
      retryReason: "missing_issue_comment",
      missingIssueCommentForRunId: run.id,
    });
    const now = new Date();

    const retryRun = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from issues where company_id = ${run.companyId} and execution_run_id = ${run.id} for update`,
      );

      const issue = await tx
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.companyId, run.companyId), eq(issues.executionRunId, run.id)))
        .then((rows) => rows[0] ?? null);
      if (!issue) return null;

      const wakeupRequest = await tx
        .insert(agentWakeupRequests)
        .values({
          companyId: run.companyId,
          agentId: run.agentId,
          source: "automation",
          triggerDetail: "system",
          reason: "missing_issue_comment",
          payload: withRecoveryModelProfileHint({
            issueId,
            retryOfRunId: run.id,
            retryReason: "missing_issue_comment",
          }),
          status: "queued",
          requestedByActorType: "system",
          requestedByActorId: null,
          updatedAt: now,
        })
        .returning()
        .then((rows) => rows[0]);

      const queuedRun = await tx
        .insert(heartbeatRuns)
        .values({
          companyId: run.companyId,
          agentId: run.agentId,
          invocationSource: "automation",
          triggerDetail: "system",
          status: "queued",
          wakeupRequestId: wakeupRequest.id,
          contextSnapshot: retryContextSnapshot,
          sessionIdBefore: sessionBefore,
          retryOfRunId: run.id,
          issueCommentStatus: "not_applicable",
          updatedAt: now,
        })
        .returning()
        .then((rows) => rows[0]);

      await tx
        .update(agentWakeupRequests)
        .set({
          runId: queuedRun.id,
          updatedAt: now,
        })
        .where(eq(agentWakeupRequests.id, wakeupRequest.id));

      await tx
        .update(issues)
        .set({
          executionRunId: null,
          executionAgentNameKey: null,
          executionLockedAt: null,
          updatedAt: now,
        })
        .where(and(eq(issues.id, issue.id), eq(issues.executionRunId, run.id)));

      await tx
        .update(heartbeatRuns)
        .set({
          issueCommentStatus: "retry_queued",
          issueCommentRetryQueuedAt: now,
          updatedAt: now,
        })
        .where(eq(heartbeatRuns.id, run.id));

      return queuedRun;
    });

    if (!retryRun) return null;

    publishLiveEvent({
      companyId: retryRun.companyId,
      type: "heartbeat.run.queued",
      payload: {
        runId: retryRun.id,
        agentId: retryRun.agentId,
        invocationSource: retryRun.invocationSource,
        triggerDetail: retryRun.triggerDetail,
        wakeupRequestId: retryRun.wakeupRequestId,
      },
    });

    return retryRun;
  }

  async function hasDeferredIssueCommentWake(companyId: string, issueId: string, agentId: string) {
    const deferredPayloads = await db
      .select({ payload: agentWakeupRequests.payload })
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, companyId),
          eq(agentWakeupRequests.agentId, agentId),
          eq(agentWakeupRequests.status, "deferred_issue_execution"),
          sql`${agentWakeupRequests.payload} ->> 'issueId' = ${issueId}`,
        ),
      );

    return deferredPayloads.some(({ payload }) => {
      const parsedPayload = parseObject(payload);
      const deferredContext = parseObject(parsedPayload[DEFERRED_WAKE_CONTEXT_KEY]);
      return Boolean(deriveCommentId(deferredContext, parsedPayload));
    });
  }

  async function finalizeIssueCommentPolicy(
    run: typeof heartbeatRuns.$inferSelect,
    agent: typeof agents.$inferSelect,
  ) {
    const contextSnapshot = parseObject(run.contextSnapshot);
    const issueId = readNonEmptyString(contextSnapshot.issueId);
    if (!issueId) {
      if (run.issueCommentStatus !== "not_applicable") {
        await patchRunIssueCommentStatus(run.id, {
          issueCommentStatus: "not_applicable",
          issueCommentSatisfiedByCommentId: null,
          issueCommentRetryQueuedAt: null,
        });
      }
      return { outcome: "not_applicable" as const, queuedRun: null };
    }

    const postedComment = await findRunIssueComment(run.id, run.companyId, issueId);
    if (postedComment) {
      await patchRunIssueCommentStatus(run.id, {
        issueCommentStatus: "satisfied",
        issueCommentSatisfiedByCommentId: postedComment.id,
        issueCommentRetryQueuedAt: null,
      });
      return { outcome: "satisfied" as const, queuedRun: null };
    }

    if (readNonEmptyString(contextSnapshot.retryReason) === "missing_issue_comment") {
      await patchRunIssueCommentStatus(run.id, {
        issueCommentStatus: "retry_exhausted",
        issueCommentSatisfiedByCommentId: null,
      });
      await appendRunEvent(run, await nextRunEventSeq(run.id), {
        eventType: "lifecycle",
        stream: "system",
        level: "warn",
        message: "Run ended without an issue comment after one retry; no further comment wake will be queued",
      });
      return { outcome: "retry_exhausted" as const, queuedRun: null };
    }

    if (!shouldRequireIssueCommentForWake(contextSnapshot)) {
      if (run.issueCommentStatus !== "not_applicable") {
        await patchRunIssueCommentStatus(run.id, {
          issueCommentStatus: "not_applicable",
          issueCommentSatisfiedByCommentId: null,
          issueCommentRetryQueuedAt: null,
        });
      }
      return { outcome: "not_applicable" as const, queuedRun: null };
    }

    if (await hasDeferredIssueCommentWake(run.companyId, issueId, run.agentId)) {
      await patchRunIssueCommentStatus(run.id, {
        issueCommentStatus: "not_applicable",
        issueCommentSatisfiedByCommentId: null,
        issueCommentRetryQueuedAt: null,
      });
      await appendRunEvent(run, await nextRunEventSeq(run.id), {
        eventType: "lifecycle",
        stream: "system",
        level: "info",
        message: "Run ended without an issue comment; a deferred comment wake already exists for this issue",
      });
      return { outcome: "not_applicable" as const, queuedRun: null };
    }

    const queuedRun = await enqueueMissingIssueCommentRetry(run, agent, issueId);
    if (queuedRun) {
      await appendRunEvent(run, await nextRunEventSeq(run.id), {
        eventType: "lifecycle",
        stream: "system",
        level: "warn",
        message: "Run ended without an issue comment; queued one follow-up wake to require a comment",
      });
      return { outcome: "retry_queued" as const, queuedRun };
    }

    await patchRunIssueCommentStatus(run.id, {
      issueCommentStatus: "retry_exhausted",
      issueCommentSatisfiedByCommentId: null,
    });
    return { outcome: "retry_exhausted" as const, queuedRun: null };
  }

  async function enqueueProcessLossRetry(
    run: typeof heartbeatRuns.$inferSelect,
    agent: typeof agents.$inferSelect,
    now: Date,
  ) {
    const contextSnapshot = parseObject(run.contextSnapshot);
    const issueId = readNonEmptyString(contextSnapshot.issueId);
    const taskKey = deriveTaskKeyWithHeartbeatFallback(contextSnapshot, null);
    const sessionBefore = await resolveSessionBeforeForWakeup(agent, taskKey);
    const retryContextSnapshot = {
      ...contextSnapshot,
      retryOfRunId: run.id,
      wakeReason: "process_lost_retry",
      retryReason: "process_lost",
    };

    const queued = await db.transaction(async (tx) => {
      const wakeupRequest = await tx
        .insert(agentWakeupRequests)
        .values({
          companyId: run.companyId,
          agentId: run.agentId,
          source: "automation",
          triggerDetail: "system",
          reason: "process_lost_retry",
          payload: {
            ...(issueId ? { issueId } : {}),
            retryOfRunId: run.id,
          },
          status: "queued",
          requestedByActorType: "system",
          requestedByActorId: null,
          updatedAt: now,
        })
        .returning()
        .then((rows) => rows[0]);

      const retryRun = await tx
        .insert(heartbeatRuns)
        .values({
          companyId: run.companyId,
          agentId: run.agentId,
          invocationSource: "automation",
          triggerDetail: "system",
          status: "queued",
          wakeupRequestId: wakeupRequest.id,
          contextSnapshot: retryContextSnapshot,
          sessionIdBefore: sessionBefore,
          retryOfRunId: run.id,
          processLossRetryCount: (run.processLossRetryCount ?? 0) + 1,
          updatedAt: now,
        })
        .returning()
        .then((rows) => rows[0]);

      await tx
        .update(agentWakeupRequests)
        .set({
          runId: retryRun.id,
          updatedAt: now,
        })
        .where(eq(agentWakeupRequests.id, wakeupRequest.id));

      if (issueId) {
        await tx
          .update(issues)
          .set({
            executionRunId: null,
            executionAgentNameKey: null,
            executionLockedAt: null,
            updatedAt: now,
          })
          .where(and(eq(issues.id, issueId), eq(issues.companyId, run.companyId), eq(issues.executionRunId, run.id)));
      }

      return retryRun;
    });

    publishLiveEvent({
      companyId: queued.companyId,
      type: "heartbeat.run.queued",
      payload: {
        runId: queued.id,
        agentId: queued.agentId,
        invocationSource: queued.invocationSource,
        triggerDetail: queued.triggerDetail,
        wakeupRequestId: queued.wakeupRequestId,
      },
    });

    await appendRunEvent(queued, 1, {
      eventType: "lifecycle",
      stream: "system",
      level: "warn",
      message: "Queued automatic retry after orphaned child process was confirmed dead",
      payload: {
        retryOfRunId: run.id,
      },
    });

    return queued;
  }

  async function processLossRetryCapReached(input: {
    companyId: string;
    agentId: string;
    issueId: string | null;
    now: Date;
  }) {
    if (!input.issueId || PROCESS_LOSS_RETRY_AGENT_ISSUE_CAP <= 0) return false;
    const windowStart = new Date(input.now.getTime() - PROCESS_LOSS_RETRY_WINDOW_MS);
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, input.companyId),
          eq(heartbeatRuns.agentId, input.agentId),
          eq(heartbeatRuns.invocationSource, "automation"),
          sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${input.issueId}`,
          sql`${heartbeatRuns.contextSnapshot} ->> 'retryReason' = 'process_lost'`,
          gt(heartbeatRuns.createdAt, windowStart),
        ),
      );
    return Number(row?.count ?? 0) >= PROCESS_LOSS_RETRY_AGENT_ISSUE_CAP;
  }

  async function hasRepeatedRecentRunFailures(input: {
    companyId: string;
    agentId: string;
    issueId: string;
    now: Date;
  }) {
    const windowStart = new Date(input.now.getTime() - MANAGER_TAKEOVER_FAILURE_WINDOW_MS);
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, input.companyId),
          eq(heartbeatRuns.agentId, input.agentId),
          inArray(heartbeatRuns.status, ["failed", "cancelled", "timed_out"]),
          sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${input.issueId}`,
          gt(heartbeatRuns.createdAt, windowStart),
        ),
      );
    return Number(row?.count ?? 0) >= MANAGER_TAKEOVER_FAILURE_COUNT;
  }

  async function getUnresolvedBlockerManagerTakeover(input: {
    companyId: string;
    managerAgentId: string;
    issueId: string;
    unresolvedBlockerIssueIds: string[];
    now?: Date;
  }) {
    if (input.unresolvedBlockerIssueIds.length === 0) return null;
    const now = input.now ?? new Date();
    const [manager, sourceIssue, directReportCountRow] = await Promise.all([
      db
        .select({ id: agents.id, role: agents.role, title: agents.title })
        .from(agents)
        .where(and(eq(agents.id, input.managerAgentId), eq(agents.companyId, input.companyId)))
        .then((rows) => rows[0] ?? null),
      db
        .select({ assigneeAgentId: issues.assigneeAgentId })
        .from(issues)
        .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)))
        .then((rows) => rows[0] ?? null),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(agents)
        .where(and(eq(agents.companyId, input.companyId), eq(agents.reportsTo, input.managerAgentId)))
        .then((rows) => rows[0] ?? null),
    ]);
    const hasDirectReports = Number(directReportCountRow?.count ?? 0) > 0;
    if (
      !manager ||
      sourceIssue?.assigneeAgentId !== input.managerAgentId ||
      !isManagerLikeAgent({ role: manager.role, title: manager.title, hasDirectReports })
    ) {
      return null;
    }

    const blockerRows = await db
      .select({
        issueId: issues.id,
        assigneeAgentId: issues.assigneeAgentId,
        assigneeStatus: agents.status,
        assigneeReportsTo: agents.reportsTo,
      })
      .from(issues)
      .leftJoin(agents, eq(issues.assigneeAgentId, agents.id))
      .where(and(eq(issues.companyId, input.companyId), inArray(issues.id, input.unresolvedBlockerIssueIds)));

    for (const blocker of blockerRows) {
      if (!blocker.assigneeAgentId || blocker.assigneeReportsTo !== input.managerAgentId) continue;
      const assigneeNotInvokable =
        blocker.assigneeStatus === "paused" ||
        blocker.assigneeStatus === "terminated" ||
        blocker.assigneeStatus === "pending_approval";
      const assigneeRepeatedlyFailing = await hasRepeatedRecentRunFailures({
        companyId: input.companyId,
        agentId: blocker.assigneeAgentId,
        issueId: blocker.issueId,
        now,
      });
      if (!assigneeNotInvokable && !assigneeRepeatedlyFailing) continue;
      return {
        issueId: blocker.issueId,
        assigneeAgentId: blocker.assigneeAgentId,
        assigneeStatus: blocker.assigneeStatus,
        reason: assigneeNotInvokable ? "assignee_not_invokable" : "assignee_repeatedly_failing",
      };
    }

    return null;
  }

  type ScheduledRetryGate =
    | { allowed: true }
    | {
        allowed: false;
        reason: string;
        errorCode:
          | "agent_not_invokable"
          | "budget_blocked"
          | "issue_not_found"
          | "issue_hidden"
          | "issue_reassigned"
          | "issue_cancelled"
          | "issue_terminal_status"
          | "issue_not_in_progress"
          | "issue_execution_lock_changed"
          | "issue_review_participant_changed"
          | "issue_paused"
          | "issue_dependencies_blocked";
        issueId: string | null;
        details: Record<string, unknown>;
      };
  type BlockedScheduledRetryGate = Extract<ScheduledRetryGate, { allowed: false }>;

  async function evaluateScheduledRetryGate(input: {
    run: typeof heartbeatRuns.$inferSelect;
    agent: typeof agents.$inferSelect;
    contextSnapshot: Record<string, unknown>;
    retryReason?: string | null;
    enforceIssueExecutionLock?: boolean;
  }): Promise<ScheduledRetryGate> {
    const { run, agent, contextSnapshot } = input;
    const retryReason =
      input.retryReason ?? readNonEmptyString(contextSnapshot.retryReason) ?? run.scheduledRetryReason ?? null;
    const issueId = readNonEmptyString(contextSnapshot.issueId);
    const projectId = readNonEmptyString(contextSnapshot.projectId);

    const budgetBlock = await budgets.getInvocationBlock(run.companyId, run.agentId, {
      issueId,
      projectId,
    });
    if (budgetBlock) {
      return {
        allowed: false,
        reason: budgetBlock.reason,
        errorCode: "budget_blocked",
        issueId,
        details: {
          scopeType: budgetBlock.scopeType,
          scopeId: budgetBlock.scopeId,
        },
      };
    }

    if (agent.status === "paused" || agent.status === "terminated" || agent.status === "pending_approval") {
      return {
        allowed: false,
        reason: "Scheduled retry suppressed because the agent is not invokable",
        errorCode: "agent_not_invokable",
        issueId,
        details: {
          agentId: agent.id,
          agentStatus: agent.status,
        },
      };
    }

    if (!issueId) return { allowed: true };

    const issue = await db
      .select({
        id: issues.id,
        status: issues.status,
        hiddenAt: issues.hiddenAt,
        assigneeAgentId: issues.assigneeAgentId,
        executionRunId: issues.executionRunId,
        executionState: issues.executionState,
      })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.companyId, run.companyId)))
      .then((rows) => rows[0] ?? null);

    if (!issue) {
      return {
        allowed: false,
        reason: "Scheduled retry suppressed because the target issue no longer exists",
        errorCode: "issue_not_found",
        issueId,
        details: { issueId },
      };
    }

    if (issue.hiddenAt) {
      return {
        allowed: false,
        reason: "Scheduled retry suppressed because the target issue is hidden",
        errorCode: "issue_hidden",
        issueId,
        details: { issueId, hiddenAt: issue.hiddenAt.toISOString() },
      };
    }

    if (issue.assigneeAgentId !== run.agentId) {
      return {
        allowed: false,
        reason: "Scheduled retry suppressed because issue ownership changed",
        errorCode: "issue_reassigned",
        issueId,
        details: {
          issueId,
          previousAssigneeAgentId: run.agentId,
          currentAssigneeAgentId: issue.assigneeAgentId,
        },
      };
    }

    if (issue.status === "cancelled" || issue.status === "done") {
      return {
        allowed: false,
        reason: `Scheduled retry suppressed because issue reached terminal status (${issue.status})`,
        errorCode: issue.status === "cancelled" ? "issue_cancelled" : "issue_terminal_status",
        issueId,
        details: { issueId, currentStatus: issue.status },
      };
    }

    const requiresInProgressScheduledRetry =
      retryReason === MAX_TURN_CONTINUATION_RETRY_REASON || retryReason === "issue_continuation_needed";
    if (requiresInProgressScheduledRetry && issue.status !== "in_progress") {
      return {
        allowed: false,
        reason:
          retryReason === "issue_continuation_needed"
            ? `Scheduled continuation suppressed because issue is no longer in_progress (current status: ${issue.status})`
            : `Scheduled max-turn continuation suppressed because issue is no longer in_progress (current status: ${issue.status})`,
        errorCode: "issue_not_in_progress",
        issueId,
        details: { issueId, currentStatus: issue.status, requiredStatus: "in_progress", retryReason },
      };
    }

    if (
      retryReason === MAX_TURN_CONTINUATION_RETRY_REASON &&
      input.enforceIssueExecutionLock &&
      issue.executionRunId !== run.id
    ) {
      return {
        allowed: false,
        reason: "Scheduled max-turn continuation suppressed because the issue execution lock belongs to a different run",
        errorCode: "issue_execution_lock_changed",
        issueId,
        details: {
          issueId,
          expectedExecutionRunId: run.id,
          currentExecutionRunId: issue.executionRunId,
        },
      };
    }

    if (issue.status === "in_review") {
      const executionState = parseIssueExecutionState(issue.executionState);
      const currentParticipant = executionState?.currentParticipant ?? null;
      if (currentParticipant) {
        const participantMatches =
          currentParticipant.type === "agent" && currentParticipant.agentId === run.agentId;
        if (!participantMatches) {
          return {
            allowed: false,
            reason: "Scheduled retry suppressed because the issue is waiting on another review participant",
            errorCode: "issue_review_participant_changed",
            issueId,
            details: {
              issueId,
              currentStageType: executionState?.currentStageType ?? null,
              currentParticipant,
            },
          };
        }
      }
    }

    const activePauseHold = await treeControlSvc.getActivePauseHoldGate(run.companyId, issueId);
    if (activePauseHold) {
      return {
        allowed: false,
        reason: "Scheduled retry suppressed because the issue is held by an active subtree pause hold",
        errorCode: "issue_paused",
        issueId,
        details: {
          issueId,
          holdId: activePauseHold.holdId,
          rootIssueId: activePauseHold.rootIssueId,
        },
      };
    }

    const dependencyReadiness = await issuesSvc.listDependencyReadiness(run.companyId, [issueId]);
    const readiness = dependencyReadiness.get(issueId);
    if (readiness && !readiness.isDependencyReady) {
      const managerTakeover = await getUnresolvedBlockerManagerTakeover({
        companyId: run.companyId,
        managerAgentId: run.agentId,
        issueId,
        unresolvedBlockerIssueIds: readiness.unresolvedBlockerIssueIds,
      });
      if (managerTakeover) return { allowed: true };
      return {
        allowed: false,
        reason: "Scheduled retry suppressed because issue dependencies are still blocked",
        errorCode: "issue_dependencies_blocked",
        issueId,
        details: {
          issueId,
          unresolvedBlockerIssueIds: readiness.unresolvedBlockerIssueIds,
          unresolvedBlockerCount: readiness.unresolvedBlockerCount,
        },
      };
    }

    return { allowed: true };
  }

  async function cancelScheduledRetryForGate(
    run: typeof heartbeatRuns.$inferSelect,
    gate: Extract<ScheduledRetryGate, { allowed: false }>,
    now: Date,
  ) {
    const cancelled = await db
      .update(heartbeatRuns)
      .set({
        status: "cancelled",
        finishedAt: now,
        error: gate.reason,
        errorCode: gate.errorCode,
        updatedAt: now,
      })
      .where(
        and(
          eq(heartbeatRuns.id, run.id),
          eq(heartbeatRuns.status, "scheduled_retry"),
          lte(heartbeatRuns.scheduledRetryAt, now),
        ),
      )
      .returning()
      .then((rows) => rows[0] ?? null);

    if (!cancelled) return null;

    if (cancelled.wakeupRequestId) {
      await db
        .update(agentWakeupRequests)
        .set({
          status: "cancelled",
          finishedAt: now,
          error: gate.reason,
          updatedAt: now,
        })
        .where(eq(agentWakeupRequests.id, cancelled.wakeupRequestId));
    }

    if (gate.issueId) {
      await db
        .update(issues)
        .set({
          executionRunId: null,
          executionAgentNameKey: null,
          executionLockedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(issues.companyId, cancelled.companyId),
            eq(issues.id, gate.issueId),
            eq(issues.executionRunId, cancelled.id),
          ),
        );
    }

    await appendRunEvent(cancelled, await nextRunEventSeq(cancelled.id), {
      eventType: "lifecycle",
      stream: "system",
      level: "warn",
      message: gate.reason,
      payload: {
        ...gate.details,
        scheduledRetryAttempt: cancelled.scheduledRetryAttempt,
        scheduledRetryAt: cancelled.scheduledRetryAt ? new Date(cancelled.scheduledRetryAt).toISOString() : null,
        scheduledRetryReason: cancelled.scheduledRetryReason,
      },
    });

    return cancelled;
  }

  async function promoteScheduledRetryRun(
    dueRun: typeof heartbeatRuns.$inferSelect,
    now: Date,
  ): Promise<
    | { outcome: "promoted"; run: typeof heartbeatRuns.$inferSelect }
    | {
        outcome: "gate_suppressed";
        run: typeof heartbeatRuns.$inferSelect;
        reason: string;
        errorCode: BlockedScheduledRetryGate["errorCode"];
      }
    | { outcome: "not_promoted"; run: typeof heartbeatRuns.$inferSelect | null }
  > {
    const agent = await getAgent(dueRun.agentId);
    if (!agent) {
      const gate = {
        allowed: false as const,
        reason: "Scheduled retry suppressed because the agent no longer exists",
        errorCode: "agent_not_invokable" as const,
        issueId: readNonEmptyString(parseObject(dueRun.contextSnapshot).issueId),
        details: { agentId: dueRun.agentId },
      };
      const cancelled = await cancelScheduledRetryForGate(dueRun, gate, now);
      return cancelled
        ? {
            outcome: "gate_suppressed",
            run: cancelled,
            reason: gate.reason,
            errorCode: gate.errorCode,
          }
        : { outcome: "not_promoted", run: null };
    }

    const contextSnapshot = parseObject(dueRun.contextSnapshot);
    const gate = await evaluateScheduledRetryGate({
      run: dueRun,
      agent,
      contextSnapshot,
      retryReason: dueRun.scheduledRetryReason,
      enforceIssueExecutionLock: dueRun.scheduledRetryReason === MAX_TURN_CONTINUATION_RETRY_REASON,
    });
    if (!gate.allowed) {
      if (
        gate.errorCode === "issue_not_found" &&
        dueRun.scheduledRetryReason !== MAX_TURN_CONTINUATION_RETRY_REASON
      ) {
        // Preserve legacy transient retry behavior for runs that only carry a
        // loose task context rather than a persisted issue row.
      } else {
        const cancelled = await cancelScheduledRetryForGate(dueRun, gate, now);
        return cancelled
          ? {
              outcome: "gate_suppressed",
              run: cancelled,
              reason: gate.reason,
              errorCode: gate.errorCode,
            }
          : { outcome: "not_promoted", run: null };
      }
    }

    const promoted = await db
      .update(heartbeatRuns)
      .set({
        status: "queued",
        updatedAt: now,
      })
      .where(
        and(
          eq(heartbeatRuns.id, dueRun.id),
          eq(heartbeatRuns.status, "scheduled_retry"),
          lte(heartbeatRuns.scheduledRetryAt, now),
        ),
      )
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!promoted) return { outcome: "not_promoted", run: null };

    await appendRunEvent(promoted, await nextRunEventSeq(promoted.id), {
      eventType: "lifecycle",
      stream: "system",
      level: "info",
      message: "Scheduled retry became due and was promoted to the queued run pool",
      payload: {
        scheduledRetryAttempt: promoted.scheduledRetryAttempt,
        scheduledRetryAt: promoted.scheduledRetryAt ? new Date(promoted.scheduledRetryAt).toISOString() : null,
        scheduledRetryReason: promoted.scheduledRetryReason,
      },
    });

    publishLiveEvent({
      companyId: promoted.companyId,
      type: "heartbeat.run.queued",
      payload: {
        runId: promoted.id,
        agentId: promoted.agentId,
        invocationSource: promoted.invocationSource,
        triggerDetail: promoted.triggerDetail,
        wakeupRequestId: promoted.wakeupRequestId,
      },
    });

    return { outcome: "promoted", run: promoted };
  }

  async function scheduleBoundedRetryForRun(
    run: typeof heartbeatRuns.$inferSelect,
    agent: typeof agents.$inferSelect,
    opts?: {
      now?: Date;
      random?: () => number;
      retryReason?: string;
      wakeReason?: string;
      maxAttempts?: number;
      delayMs?: number;
    },
  ) {
    const now = opts?.now ?? new Date();
    const retryReason = opts?.retryReason ?? BOUNDED_TRANSIENT_HEARTBEAT_RETRY_REASON;
    const wakeReason = opts?.wakeReason ?? BOUNDED_TRANSIENT_HEARTBEAT_RETRY_WAKE_REASON;
    const maxAttempts = Math.max(0, Math.floor(opts?.maxAttempts ?? BOUNDED_TRANSIENT_HEARTBEAT_RETRY_MAX_ATTEMPTS));
    const nextAttempt = (run.scheduledRetryAttempt ?? 0) + 1;
    const baseSchedule = opts?.delayMs != null
      ? nextAttempt <= maxAttempts
        ? {
            attempt: nextAttempt,
            baseDelayMs: Math.max(0, Math.floor(opts.delayMs)),
            delayMs: Math.max(0, Math.floor(opts.delayMs)),
            dueAt: new Date(now.getTime() + Math.max(0, Math.floor(opts.delayMs))),
            maxAttempts,
          }
        : null
      : nextAttempt <= maxAttempts
        ? computeBoundedTransientHeartbeatRetrySchedule(nextAttempt, now, opts?.random)
        : null;
    const transientRecovery =
      retryReason === BOUNDED_TRANSIENT_HEARTBEAT_RETRY_REASON
        ? readTransientRecoveryContractFromRun(run)
        : null;
    const codexTransientFallbackMode =
      agent.adapterType === "codex_local" && transientRecovery
        ? resolveCodexTransientFallbackMode(nextAttempt)
        : null;
    const transientRetryNotBefore = transientRecovery?.retryNotBefore ?? null;
    const retryModelProfile =
      transientRecovery?.modelProfile != null
        ? chooseScheduledRetryModelProfile(agent, transientRecovery.modelProfile)
        : "cheap";

    if (!baseSchedule) {
      await appendRunEvent(run, await nextRunEventSeq(run.id), {
        eventType: "lifecycle",
        stream: "system",
        level: "warn",
        message: `Bounded retry exhausted after ${run.scheduledRetryAttempt ?? 0} scheduled attempts; no further automatic retry will be queued`,
        payload: {
          retryReason,
          scheduledRetryAttempt: run.scheduledRetryAttempt ?? 0,
          maxAttempts,
        },
      });
      return {
        outcome: "retry_exhausted" as const,
        attempt: nextAttempt,
        maxAttempts,
      };
    }
    const schedule =
      transientRetryNotBefore && transientRetryNotBefore.getTime() > baseSchedule.dueAt.getTime()
        ? {
            ...baseSchedule,
            dueAt: transientRetryNotBefore,
            delayMs: Math.max(0, transientRetryNotBefore.getTime() - now.getTime()),
          }
        : baseSchedule;

    const contextSnapshot = parseObject(run.contextSnapshot);
    const issueId = readNonEmptyString(contextSnapshot.issueId);
    if (retryReason === MAX_TURN_CONTINUATION_RETRY_REASON) {
      const gate = await evaluateScheduledRetryGate({ run, agent, contextSnapshot, retryReason });
      if (!gate.allowed) {
        await appendRunEvent(run, await nextRunEventSeq(run.id), {
          eventType: "lifecycle",
          stream: "system",
          level: "warn",
          message: gate.reason,
          payload: {
            retryReason,
            scheduledRetryAttempt: nextAttempt,
            maxAttempts,
            ...gate.details,
          },
        });
        return {
          outcome: "not_scheduled" as const,
          reason: gate.reason,
          errorCode: gate.errorCode,
          issueId: gate.issueId,
        };
      }
    }
    const taskKey = deriveTaskKeyWithHeartbeatFallback(contextSnapshot, null);
    const sessionBefore = await resolveSessionBeforeForWakeup(agent, taskKey);
    const retryContextSnapshot: Record<string, unknown> = withRecoveryModelProfileHint(
      {
        ...contextSnapshot,
        retryOfRunId: run.id,
        wakeReason,
        retryReason,
        ...(transientRecovery ? { errorFamily: transientRecovery.errorFamily } : {}),
        scheduledRetryAttempt: schedule.attempt,
        scheduledRetryAt: schedule.dueAt.toISOString(),
        ...(transientRetryNotBefore ? { transientRetryNotBefore: transientRetryNotBefore.toISOString() } : {}),
        ...(codexTransientFallbackMode ? { codexTransientFallbackMode } : {}),
      },
      retryModelProfile,
    );
    const maxTurnContinuationIdempotencyKey = retryReason === MAX_TURN_CONTINUATION_RETRY_REASON
      ? `max-turn-continuation:${run.companyId}:${issueId ?? "no-issue"}:${run.id}:${schedule.attempt}`
      : null;

    type ScheduledRetryTransactionResult =
      | {
          outcome: "scheduled";
          run: typeof heartbeatRuns.$inferSelect;
          reusedExisting: boolean;
        }
      | {
          outcome: "not_scheduled";
          reason: string;
          errorCode:
            | "issue_not_found"
            | "issue_reassigned"
            | "issue_cancelled"
            | "issue_terminal_status"
            | "issue_not_in_progress"
            | "issue_execution_lock_changed";
          issueId: string | null;
          details: Record<string, unknown>;
        };

    const scheduleResult = await db.transaction(async (tx): Promise<ScheduledRetryTransactionResult> => {
      if (retryReason === MAX_TURN_CONTINUATION_RETRY_REASON) {
        if (issueId) {
          await tx.execute(
            sql`select id from issues where company_id = ${run.companyId} and id = ${issueId} for update`,
          );
        } else {
          await tx.execute(
            sql`select id from heartbeat_runs where company_id = ${run.companyId} and id = ${run.id} for update`,
          );
        }

        const existingContinuation = await tx
          .select()
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, run.companyId),
              eq(heartbeatRuns.retryOfRunId, run.id),
              eq(heartbeatRuns.scheduledRetryReason, retryReason),
              eq(heartbeatRuns.scheduledRetryAttempt, schedule.attempt),
              inArray(heartbeatRuns.status, [...MAX_TURN_CONTINUATION_LIVE_RUN_STATUSES]),
              issueId
                ? sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`
                : sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' is null`,
            ),
          )
          .orderBy(asc(heartbeatRuns.createdAt), asc(heartbeatRuns.id))
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (existingContinuation) {
          if (existingContinuation.wakeupRequestId) {
            const existingWakeup = await tx
              .select({ coalescedCount: agentWakeupRequests.coalescedCount })
              .from(agentWakeupRequests)
              .where(eq(agentWakeupRequests.id, existingContinuation.wakeupRequestId))
              .then((rows) => rows[0] ?? null);

            await tx
              .update(agentWakeupRequests)
              .set({
                coalescedCount: (existingWakeup?.coalescedCount ?? 0) + 1,
                updatedAt: now,
              })
              .where(eq(agentWakeupRequests.id, existingContinuation.wakeupRequestId));
          }

          return {
            outcome: "scheduled",
            run: existingContinuation,
            reusedExisting: true,
          };
        }

        if (issueId) {
          const lockedIssue = await tx
            .select({
              id: issues.id,
              status: issues.status,
              assigneeAgentId: issues.assigneeAgentId,
              executionRunId: issues.executionRunId,
            })
            .from(issues)
            .where(and(eq(issues.id, issueId), eq(issues.companyId, run.companyId)))
            .then((rows) => rows[0] ?? null);

          if (!lockedIssue) {
            return {
              outcome: "not_scheduled",
              reason: "Scheduled max-turn continuation suppressed because the target issue no longer exists",
              errorCode: "issue_not_found",
              issueId,
              details: { issueId },
            };
          }

          if (lockedIssue.assigneeAgentId !== run.agentId) {
            return {
              outcome: "not_scheduled",
              reason: "Scheduled max-turn continuation suppressed because issue ownership changed",
              errorCode: "issue_reassigned",
              issueId,
              details: {
                issueId,
                previousAssigneeAgentId: run.agentId,
                currentAssigneeAgentId: lockedIssue.assigneeAgentId,
              },
            };
          }

          if (lockedIssue.status === "cancelled" || lockedIssue.status === "done") {
            return {
              outcome: "not_scheduled",
              reason: `Scheduled max-turn continuation suppressed because issue reached terminal status (${lockedIssue.status})`,
              errorCode: lockedIssue.status === "cancelled" ? "issue_cancelled" : "issue_terminal_status",
              issueId,
              details: { issueId, currentStatus: lockedIssue.status },
            };
          }

          if (lockedIssue.status !== "in_progress") {
            return {
              outcome: "not_scheduled",
              reason: `Scheduled max-turn continuation suppressed because issue is no longer in_progress (current status: ${lockedIssue.status})`,
              errorCode: "issue_not_in_progress",
              issueId,
              details: { issueId, currentStatus: lockedIssue.status, requiredStatus: "in_progress" },
            };
          }

          if (lockedIssue.executionRunId !== run.id) {
            return {
              outcome: "not_scheduled",
              reason:
                "Scheduled max-turn continuation suppressed because the issue execution lock belongs to a different run",
              errorCode: "issue_execution_lock_changed",
              issueId,
              details: {
                issueId,
                expectedExecutionRunId: run.id,
                currentExecutionRunId: lockedIssue.executionRunId,
              },
            };
          }
        }
      }

      const wakeupRequest = await tx
        .insert(agentWakeupRequests)
        .values({
          companyId: run.companyId,
          agentId: run.agentId,
          source: "automation",
          triggerDetail: "system",
          reason: wakeReason,
          payload: withRecoveryModelProfileHint(
            {
              ...(issueId ? { issueId } : {}),
              retryOfRunId: run.id,
              retryReason,
              ...(transientRecovery ? { errorFamily: transientRecovery.errorFamily } : {}),
              scheduledRetryAttempt: schedule.attempt,
              scheduledRetryAt: schedule.dueAt.toISOString(),
              ...(transientRetryNotBefore ? { transientRetryNotBefore: transientRetryNotBefore.toISOString() } : {}),
              ...(codexTransientFallbackMode ? { codexTransientFallbackMode } : {}),
            },
            retryModelProfile,
          ),
          status: "queued",
          requestedByActorType: "system",
          requestedByActorId: null,
          idempotencyKey: maxTurnContinuationIdempotencyKey,
          updatedAt: now,
        })
        .returning()
        .then((rows) => rows[0]);

      const scheduledRun = await tx
        .insert(heartbeatRuns)
        .values({
          companyId: run.companyId,
          agentId: run.agentId,
          invocationSource: "automation",
          triggerDetail: "system",
          status: "scheduled_retry",
          wakeupRequestId: wakeupRequest.id,
          contextSnapshot: retryContextSnapshot,
          sessionIdBefore: sessionBefore,
          retryOfRunId: run.id,
          scheduledRetryAt: schedule.dueAt,
          scheduledRetryAttempt: schedule.attempt,
          scheduledRetryReason: retryReason,
          continuationAttempt: readContinuationAttempt(retryContextSnapshot.livenessContinuationAttempt),
          updatedAt: now,
        })
        .returning()
        .then((rows) => rows[0]);

      await tx
        .update(agentWakeupRequests)
        .set({
          runId: scheduledRun.id,
          updatedAt: now,
        })
        .where(eq(agentWakeupRequests.id, wakeupRequest.id));

      if (issueId) {
        await tx
          .update(issues)
          .set({
            executionRunId: null,
            executionAgentNameKey: null,
            executionLockedAt: null,
            updatedAt: now,
          })
          .where(and(eq(issues.id, issueId), eq(issues.companyId, run.companyId), eq(issues.executionRunId, run.id)));
      }

      return {
        outcome: "scheduled",
        run: scheduledRun,
        reusedExisting: false,
      };
    });

    if (scheduleResult.outcome === "not_scheduled") {
      await appendRunEvent(run, await nextRunEventSeq(run.id), {
        eventType: "lifecycle",
        stream: "system",
        level: "warn",
        message: scheduleResult.reason,
        payload: {
          retryReason,
          scheduledRetryAttempt: nextAttempt,
          maxAttempts,
          ...scheduleResult.details,
        },
      });
      return {
        outcome: "not_scheduled" as const,
        reason: scheduleResult.reason,
        errorCode: scheduleResult.errorCode,
        issueId: scheduleResult.issueId,
      };
    }

    const retryRun = scheduleResult.run;
    const dueAt = retryRun.scheduledRetryAt ? new Date(retryRun.scheduledRetryAt) : schedule.dueAt;

    if (scheduleResult.reusedExisting) {
      await appendRunEvent(run, await nextRunEventSeq(run.id), {
        eventType: "lifecycle",
        stream: "system",
        level: "info",
        message: `Reused existing max-turn continuation ${retryRun.scheduledRetryAttempt}/${schedule.maxAttempts}`,
        payload: {
          retryRunId: retryRun.id,
          retryReason,
          idempotencyKey: maxTurnContinuationIdempotencyKey,
          scheduledRetryAttempt: retryRun.scheduledRetryAttempt,
          scheduledRetryAt: dueAt.toISOString(),
        },
      });

      return {
        outcome: "scheduled" as const,
        run: retryRun,
        dueAt,
        attempt: retryRun.scheduledRetryAttempt,
        maxAttempts: schedule.maxAttempts,
        reusedExisting: true,
      };
    }

    await appendRunEvent(run, await nextRunEventSeq(run.id), {
      eventType: "lifecycle",
      stream: "system",
      level: "warn",
      message: `Scheduled bounded retry ${schedule.attempt}/${schedule.maxAttempts} for ${schedule.dueAt.toISOString()}`,
      payload: {
        retryRunId: retryRun.id,
        retryReason,
        ...(transientRecovery ? { errorFamily: transientRecovery.errorFamily } : {}),
        scheduledRetryAttempt: schedule.attempt,
        scheduledRetryAt: schedule.dueAt.toISOString(),
        baseDelayMs: schedule.baseDelayMs,
        delayMs: schedule.delayMs,
        ...(transientRetryNotBefore ? { transientRetryNotBefore: transientRetryNotBefore.toISOString() } : {}),
        ...(codexTransientFallbackMode ? { codexTransientFallbackMode } : {}),
      },
    });

    return {
      outcome: "scheduled" as const,
      run: retryRun,
      dueAt,
      attempt: schedule.attempt,
      maxAttempts: schedule.maxAttempts,
    };
  }

  async function promoteDueScheduledRetries(now = new Date()) {
    const dueRuns = await db
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.status, "scheduled_retry"),
          lte(heartbeatRuns.scheduledRetryAt, now),
        ),
      )
      .orderBy(asc(heartbeatRuns.scheduledRetryAt), asc(heartbeatRuns.createdAt), asc(heartbeatRuns.id))
      .limit(50);

    const promotedRunIds: string[] = [];

    for (const dueRun of dueRuns) {
      const result = await promoteScheduledRetryRun(dueRun, now);
      if (result.outcome === "promoted") {
        promotedRunIds.push(result.run.id);
      }
    }

    return {
      promoted: promotedRunIds.length,
      runIds: promotedRunIds,
    };
  }

  async function getIssueRetryRun(
    companyId: string,
    issueId: string,
    statuses: Array<"scheduled_retry" | "queued" | "running" | "cancelled">,
  ) {
    if (statuses.length === 0) return null;
    return db
      .select({
        run: heartbeatRuns,
        agentName: agents.name,
      })
      .from(heartbeatRuns)
      .innerJoin(agents, eq(heartbeatRuns.agentId, agents.id))
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          inArray(heartbeatRuns.status, statuses),
          sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
          sql`${heartbeatRuns.retryOfRunId} is not null`,
        ),
      )
      .orderBy(desc(heartbeatRuns.updatedAt), desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  function summarizeIssueScheduledRetryRun(
    row: { run: typeof heartbeatRuns.$inferSelect; agentName: string | null },
  ) {
    return {
      runId: row.run.id,
      status: row.run.status as "scheduled_retry" | "queued" | "running" | "cancelled",
      agentId: row.run.agentId,
      agentName: row.agentName,
      retryOfRunId: row.run.retryOfRunId,
      scheduledRetryAt: row.run.scheduledRetryAt,
      scheduledRetryAttempt: row.run.scheduledRetryAttempt,
      scheduledRetryReason: row.run.scheduledRetryReason,
      error: row.run.error,
      errorCode: row.run.errorCode,
    };
  }

  async function retryScheduledRetryNow(input: {
    issueId: string;
    actor?: { actorType?: "user" | "agent" | "system"; actorId?: string | null };
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const issue = await db
      .select({ id: issues.id, companyId: issues.companyId })
      .from(issues)
      .where(eq(issues.id, input.issueId))
      .then((rows) => rows[0] ?? null);
    if (!issue) throw notFound("Issue not found");

    const scheduled = await getIssueRetryRun(issue.companyId, issue.id, ["scheduled_retry"]);
    if (!scheduled) {
      const alreadyPromoted = await getIssueRetryRun(issue.companyId, issue.id, ["queued", "running"]);
      if (alreadyPromoted) {
        return {
          outcome: "already_promoted" as const,
          message: "Scheduled retry was already promoted",
          scheduledRetry: summarizeIssueScheduledRetryRun(alreadyPromoted),
        };
      }
      return {
        outcome: "no_scheduled_retry" as const,
        message: "No live scheduled retry exists for this issue",
        scheduledRetry: null,
      };
    }

    const contextSnapshot = {
      ...parseObject(scheduled.run.contextSnapshot),
      scheduledRetryAt: now.toISOString(),
      retryNowRequestedAt: now.toISOString(),
      retryNowRequestedByActorType: input.actor?.actorType ?? null,
      retryNowRequestedByActorId: input.actor?.actorId ?? null,
    };

    const updated = await db.transaction(async (tx) => {
      const row = await tx
        .update(heartbeatRuns)
        .set({
          scheduledRetryAt: now,
          contextSnapshot,
          updatedAt: now,
        })
        .where(and(eq(heartbeatRuns.id, scheduled.run.id), eq(heartbeatRuns.status, "scheduled_retry")))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!row) return null;

      if (row.wakeupRequestId) {
        const wakeupPayload = {
          ...(parseObject(
            await tx
              .select({ payload: agentWakeupRequests.payload })
              .from(agentWakeupRequests)
              .where(eq(agentWakeupRequests.id, row.wakeupRequestId))
              .then((rows) => rows[0]?.payload ?? null),
          )),
          scheduledRetryAt: now.toISOString(),
          retryNowRequestedAt: now.toISOString(),
        };
        await tx
          .update(agentWakeupRequests)
          .set({
            payload: wakeupPayload,
            updatedAt: now,
          })
          .where(eq(agentWakeupRequests.id, row.wakeupRequestId));
      }

      return row;
    });

    if (!updated) {
      const alreadyPromoted = await getIssueRetryRun(issue.companyId, issue.id, ["queued", "running"]);
      if (alreadyPromoted) {
        return {
          outcome: "already_promoted" as const,
          message: "Scheduled retry was already promoted",
          scheduledRetry: summarizeIssueScheduledRetryRun(alreadyPromoted),
        };
      }
      return {
        outcome: "no_scheduled_retry" as const,
        message: "No live scheduled retry exists for this issue",
        scheduledRetry: null,
      };
    }

    await appendRunEvent(updated, await nextRunEventSeq(updated.id), {
      eventType: "lifecycle",
      stream: "system",
      level: "info",
      message: "Scheduled retry was requested to run now",
      payload: {
        issueId: issue.id,
        scheduledRetryAttempt: updated.scheduledRetryAttempt,
        scheduledRetryAt: updated.scheduledRetryAt ? new Date(updated.scheduledRetryAt).toISOString() : null,
        scheduledRetryReason: updated.scheduledRetryReason,
        requestedByActorType: input.actor?.actorType ?? null,
        requestedByActorId: input.actor?.actorId ?? null,
      },
    });

    const promotion = await promoteScheduledRetryRun(updated, now);
    const promotedRow = await getIssueRetryRun(issue.companyId, issue.id, ["queued", "running", "cancelled"]);
    const scheduledRetry = promotedRow
      ? summarizeIssueScheduledRetryRun(promotedRow)
      : summarizeIssueScheduledRetryRun({ run: promotion.run ?? updated, agentName: scheduled.agentName });

    if (promotion.outcome === "promoted") {
      return {
        outcome: "promoted" as const,
        message: "Scheduled retry was promoted to the queued run pool",
        scheduledRetry,
      };
    }
    if (promotion.outcome === "gate_suppressed") {
      return {
        outcome: "gate_suppressed" as const,
        message: promotion.reason,
        scheduledRetry,
      };
    }
    return {
      outcome: "already_promoted" as const,
      message: "Scheduled retry was already promoted",
      scheduledRetry,
    };
  }

  function parseHeartbeatPolicy(agent: typeof agents.$inferSelect) {
    const runtimeConfig = parseObject(agent.runtimeConfig);
    const heartbeat = parseObject(runtimeConfig.heartbeat);

    return {
      enabled: asBoolean(heartbeat.enabled, false),
      intervalSec: Math.max(0, asNumber(heartbeat.intervalSec, 0)),
      wakeOnDemand: asBoolean(heartbeat.wakeOnDemand ?? heartbeat.wakeOnAssignment ?? heartbeat.wakeOnOnDemand ?? heartbeat.wakeOnAutomation, true),
      maxConcurrentRuns: normalizeMaxConcurrentRuns(heartbeat.maxConcurrentRuns),
    };
  }

  function parseMaxTurnContinuationPolicy(agent: typeof agents.$inferSelect): MaxTurnContinuationPolicy {
    const runtimeConfig = parseObject(agent.runtimeConfig);
    const heartbeat = parseObject(runtimeConfig.heartbeat);
    const configured = parseObject(heartbeat.maxTurnContinuation);
    const rawMaxAttempts = Math.floor(asNumber(configured.maxAttempts, MAX_TURN_CONTINUATION_DEFAULT_MAX_ATTEMPTS));
    const rawDelayMs = Math.floor(asNumber(configured.delayMs, MAX_TURN_CONTINUATION_DEFAULT_DELAY_MS));

    return {
      enabled: asBoolean(configured.enabled, true),
      maxAttempts: Math.max(0, Math.min(MAX_TURN_CONTINUATION_MAX_ATTEMPTS_CAP, rawMaxAttempts)),
      delayMs: Math.max(0, Math.min(MAX_TURN_CONTINUATION_MAX_DELAY_MS, rawDelayMs)),
    };
  }

  const CAMPAIGN_PHASE_EXECUTION_ORIGIN_KIND = "campaign_phase_execution";

  function issueRunPriorityRank(input: { priority?: string | null; originKind?: string | null } | null | undefined) {
    if (input?.priority === "critical") return 0;
    if (input?.originKind === CAMPAIGN_PHASE_EXECUTION_ORIGIN_KIND) return 1;
    switch (input?.priority) {
      case "critical":
        return 0;
      case "high":
        return 2;
      case "medium":
        return 3;
      case "low":
        return 4;
      default:
        return 5;
    }
  }

  function isPriorityQueuedRun(run: Pick<typeof heartbeatRuns.$inferSelect, "invocationSource" | "triggerDetail">) {
    return run.invocationSource === "on_demand" || run.triggerDetail === "manual";
  }

  async function resolveTimerWakeAssignedIssue(agent: typeof agents.$inferSelect) {
    return db
      .select({
        id: issues.id,
        identifier: issues.identifier,
        projectId: issues.projectId,
        status: issues.status,
        priority: issues.priority,
        originKind: issues.originKind,
        createdAt: issues.createdAt,
      })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, agent.companyId),
          eq(issues.assigneeAgentId, agent.id),
          inArray(issues.status, ["in_progress", "todo", "backlog", "in_review", "blocked"]),
          isNull(issues.hiddenAt),
        ),
      )
      .orderBy(
        sql`case ${issues.status}
          when 'in_progress' then 0
          when 'todo' then 1
          when 'backlog' then 2
          when 'in_review' then 3
          when 'blocked' then 4
          else 5
        end`,
        sql`case ${issues.priority}
          when 'critical' then 0
          else 5
        end`,
        sql`case
          when ${issues.originKind} = ${CAMPAIGN_PHASE_EXECUTION_ORIGIN_KIND} then 1
          when ${issues.priority} = 'high' then 2
          when ${issues.priority} = 'medium' then 3
          when ${issues.priority} = 'low' then 4
          else 5
        end`,
        asc(issues.createdAt),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function listQueuedRunDependencyReadiness(
    companyId: string,
    queuedRuns: Array<typeof heartbeatRuns.$inferSelect>,
  ) {
    const issueIds = [...new Set(
      queuedRuns
        .map((run) => readNonEmptyString(parseObject(run.contextSnapshot).issueId))
        .filter((issueId): issueId is string => Boolean(issueId)),
    )];
    if (issueIds.length === 0) {
      return new Map<string, Awaited<ReturnType<typeof issuesSvc.getDependencyReadiness>>>();
    }
    return issuesSvc.listDependencyReadiness(companyId, issueIds);
  }

  async function countRunningRunsForAgent(agentId: string) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.status, "running")));
    return Number(count ?? 0);
  }

  async function countExecutionPathRunsForAgent(agentId: string, client: Pick<Db, "select"> = db) {
    const [{ count }] = await client
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agentId), inArray(heartbeatRuns.status, [...EXECUTION_PATH_HEARTBEAT_RUN_STATUSES])));
    return Number(count ?? 0);
  }

  function isManagementQueueCappedAgent(agent: typeof agents.$inferSelect) {
    return defaultAgentMaxConcurrentRuns(agent) > AGENT_DEFAULT_MAX_CONCURRENT_RUNS;
  }

  async function shouldSkipForManagementQueueCap(agent: typeof agents.$inferSelect, client: Pick<Db, "select"> = db) {
    if (!isManagementQueueCappedAgent(agent)) return false;
    return await countExecutionPathRunsForAgent(agent.id, client) >= MANAGEMENT_AGENT_LIVE_RUN_CAP;
  }

  async function countRunningRuns() {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.status, "running"));
    return Number(count ?? 0);
  }

  async function countQueuedRuns(client: Pick<Db, "select"> = db) {
    const [{ count }] = await client
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.status, "queued"));
    return Number(count ?? 0);
  }

  async function countQueuedOrRunningRuns() {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(inArray(heartbeatRuns.status, ["queued", "running"]));
    return Number(count ?? 0);
  }

  async function cancelQueuedRunAsSkipped(
    run: typeof heartbeatRuns.$inferSelect,
    input: {
      reason: string;
      errorCode: string;
      source: string;
      details?: Record<string, unknown>;
    },
  ) {
    const now = new Date();
    const cancelled = await setRunStatus(run.id, "cancelled", {
      finishedAt: now,
      error: input.reason,
      errorCode: input.errorCode,
      resultJson: {
        ...parseObject(run.resultJson),
        stopReason: input.errorCode,
        source: input.source,
        effectiveTimeoutSec: 0,
        timeoutConfigured: false,
        timeoutSource: input.source,
        timeoutFired: false,
      },
    });
    if (!cancelled) return null;

    await setWakeupStatus(run.wakeupRequestId, "skipped", {
      finishedAt: now,
      error: input.reason,
    });

    await appendRunEvent(cancelled, await nextRunEventSeq(cancelled.id), {
      eventType: "lifecycle",
      stream: "system",
      level: "warn",
      message: input.reason,
      payload: {
        source: input.source,
        ...(input.details ?? {}),
      },
    });

    return cancelled;
  }

  async function reapStalePreSpawnRunsForAgent(agent: typeof agents.$inferSelect) {
    if (!agent.adapterType.endsWith("_local")) return 0;
    const now = new Date();
    const staleBefore = new Date(Date.now() - LOCAL_AGENT_PRE_SPAWN_STALE_MS);
    const rows = await db
      .update(heartbeatRuns)
      .set({
        status: "cancelled",
        finishedAt: now,
        error: "Cancelled because the local adapter did not spawn a process before the startup timeout",
        errorCode: "local_agent_pre_spawn_stale",
        updatedAt: now,
      })
      .where(
        and(
          eq(heartbeatRuns.agentId, agent.id),
          eq(heartbeatRuns.status, "running"),
          isNull(heartbeatRuns.processPid),
          isNull(heartbeatRuns.lastOutputAt),
          lt(heartbeatRuns.startedAt, staleBefore),
        ),
      )
      .returning({ id: heartbeatRuns.id, wakeupRequestId: heartbeatRuns.wakeupRequestId });
    if (rows.length > 0) {
      for (const row of rows) {
        runningProcesses.delete(row.id);
        activeRunExecutions.delete(row.id);
      }
      const wakeupRequestIds = rows
        .map((row) => row.wakeupRequestId)
        .filter((id): id is string => Boolean(id));
      if (wakeupRequestIds.length > 0) {
        await db
          .update(agentWakeupRequests)
          .set({
            status: "cancelled",
            finishedAt: now,
            error: "Cancelled because the linked local adapter run did not spawn before the startup timeout",
            updatedAt: now,
          })
          .where(inArray(agentWakeupRequests.id, wakeupRequestIds));
      }
      await finalizeAgentStatus(agent.id, "cancelled");
      logger.warn(
        {
          agentId: agent.id,
          agentName: agent.name,
          adapterType: agent.adapterType,
          runIds: rows.map((row) => row.id),
        },
        "cancelled stale local agent pre-spawn runs",
      );
    }
    return rows.length;
  }

  async function pruneQueuedRunsForAgent(agent: typeof agents.$inferSelect) {
    const now = new Date();
    const staleUnscopedBefore = new Date(now.getTime() - STALE_UNSCOPED_QUEUED_RUN_MS);
    const queuedRuns = await db
      .select()
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agent.id), eq(heartbeatRuns.status, "queued")))
      .orderBy(asc(heartbeatRuns.createdAt), asc(heartbeatRuns.id));
    if (queuedRuns.length === 0) return 0;

    let pruned = 0;
    for (const run of queuedRuns) {
      const context = parseObject(run.contextSnapshot);
      const issueId = issueIdFromRunContext(context);
      if (!issueId) {
        if (run.createdAt && run.createdAt < staleUnscopedBefore) {
          const reason =
            "Cancelled stale queued wake without an issue scope before it could consume an execution slot";
          const cancelled = await cancelQueuedRunAsSkipped(run, {
            reason,
            errorCode: "stale_unscoped_queued_run",
            source: "queue_hygiene",
            details: {
              ageMs: now.getTime() - run.createdAt.getTime(),
              wakeReason: readNonEmptyString(context.wakeReason),
              invocationSource: run.invocationSource,
              triggerDetail: run.triggerDetail,
            },
          });
          if (cancelled) pruned += 1;
        }
        continue;
      }

      const dependencyReadiness = await issuesSvc.listDependencyReadiness(run.companyId, [issueId]);
      const readiness = dependencyReadiness.get(issueId);
      const unresolvedBlockerCount = readiness?.unresolvedBlockerCount ?? 0;
      const isMeetingWorkflowWake = isMeetingWorkflowWakeContext(context);
      if (unresolvedBlockerCount > 0 && !allowsIssueInteractionWake(context) && !isMeetingWorkflowWake) {
        const managerTakeover = await getUnresolvedBlockerManagerTakeover({
          companyId: run.companyId,
          managerAgentId: run.agentId,
          issueId,
          unresolvedBlockerIssueIds: readiness?.unresolvedBlockerIssueIds ?? [],
          now,
        });
        if (managerTakeover) continue;
        const cancelled = await cancelQueuedRunForBlockedDependencies(
          run,
          issueId,
          readiness?.unresolvedBlockerIssueIds ?? [],
        );
        if (cancelled) pruned += 1;
        continue;
      }

      const staleness = await evaluateQueuedRunStaleness(run, issueId, context);
      if (staleness.stale) {
        const cancelled = await cancelQueuedRunForStaleIssue(run, issueId, staleness);
        if (cancelled) pruned += 1;
      }
    }

    if (pruned > 0) {
      logger.info(
        {
          agentId: agent.id,
          agentName: agent.name,
          queuedRuns: queuedRuns.length,
          pruned,
        },
        "pruned stale queued heartbeat runs before slot allocation",
      );
    }
    return pruned;
  }

  function wakeupStatusForTerminalRunStatus(status: string) {
    if (status === "succeeded") return "completed";
    return status;
  }

  async function reconcileQueuedHeartbeatRuns(now: Date, opts?: { companyId?: string }) {
    const staleUnscopedBefore = new Date(now.getTime() - STALE_UNSCOPED_QUEUED_RUN_MS);
    const queuedRuns = await db
      .select()
      .from(heartbeatRuns)
      .where(and(
        eq(heartbeatRuns.status, "queued"),
        opts?.companyId ? eq(heartbeatRuns.companyId, opts.companyId) : undefined,
      ))
      .orderBy(asc(heartbeatRuns.createdAt), asc(heartbeatRuns.id))
      .limit(QUEUED_RUN_RECONCILIATION_LIMIT);

    let staleQueuedRuns = 0;
    let blockedQueuedRuns = 0;
    for (const run of queuedRuns) {
      const context = parseObject(run.contextSnapshot);
      const issueId = issueIdFromRunContext(context);
      if (!issueId) {
        if (run.createdAt && run.createdAt < staleUnscopedBefore) {
          const cancelled = await cancelQueuedRunAsSkipped(run, {
            reason: "Cancelled stale queued wake without an issue scope during heartbeat reconciliation",
            errorCode: "stale_unscoped_queued_run",
            source: "queued_run_reconciliation",
            details: {
              ageMs: now.getTime() - run.createdAt.getTime(),
              wakeReason: readNonEmptyString(context.wakeReason),
              invocationSource: run.invocationSource,
              triggerDetail: run.triggerDetail,
            },
          });
          if (cancelled) staleQueuedRuns += 1;
        }
        continue;
      }

      const isMeetingWorkflowWake = isMeetingWorkflowWakeContext(context);
      const dependencyReadiness = await issuesSvc.listDependencyReadiness(run.companyId, [issueId]);
      const readiness = dependencyReadiness.get(issueId);
      const unresolvedBlockerCount = readiness?.unresolvedBlockerCount ?? 0;
      if (unresolvedBlockerCount > 0 && !allowsIssueInteractionWake(context) && !isMeetingWorkflowWake) {
        const managerTakeover = await getUnresolvedBlockerManagerTakeover({
          companyId: run.companyId,
          managerAgentId: run.agentId,
          issueId,
          unresolvedBlockerIssueIds: readiness?.unresolvedBlockerIssueIds ?? [],
          now,
        });
        if (managerTakeover) continue;
        const cancelled = await cancelQueuedRunForBlockedDependencies(
          run,
          issueId,
          readiness?.unresolvedBlockerIssueIds ?? [],
        );
        if (cancelled) blockedQueuedRuns += 1;
        continue;
      }

      const staleness = await evaluateQueuedRunStaleness(run, issueId, context);
      if (staleness.stale) {
        const cancelled = await cancelQueuedRunForStaleIssue(run, issueId, staleness);
        if (cancelled) staleQueuedRuns += 1;
      }
    }

    return {
      scannedQueuedRuns: queuedRuns.length,
      staleQueuedRuns,
      blockedQueuedRuns,
    };
  }

  async function reconcilePersistedHeartbeatRuntimeState(opts?: { companyId?: string }) {
    const now = new Date();
    const preSpawnStaleBefore = new Date(now.getTime() - LOCAL_AGENT_PRE_SPAWN_STALE_MS);

    const terminalLinkedWakeups = await db
      .select({
        id: agentWakeupRequests.id,
        wakeupStatus: agentWakeupRequests.status,
        runStatus: heartbeatRuns.status,
        runFinishedAt: heartbeatRuns.finishedAt,
        runError: heartbeatRuns.error,
      })
      .from(agentWakeupRequests)
      .innerJoin(heartbeatRuns, eq(agentWakeupRequests.runId, heartbeatRuns.id))
      .where(
        and(
          opts?.companyId ? eq(heartbeatRuns.companyId, opts.companyId) : undefined,
          inArray(agentWakeupRequests.status, ["queued", "claimed"]),
          inArray(heartbeatRuns.status, [...HEARTBEAT_RUN_TERMINAL_STATUSES]),
        ),
      );

    for (const wakeup of terminalLinkedWakeups) {
      await db
        .update(agentWakeupRequests)
        .set({
          status: wakeupStatusForTerminalRunStatus(wakeup.runStatus),
          finishedAt: wakeup.runFinishedAt ?? now,
          error: wakeup.runError ?? null,
          updatedAt: now,
        })
        .where(eq(agentWakeupRequests.id, wakeup.id));
    }

    const stalePreSpawnAgentRows = await db
      .select({ agent: agents })
      .from(agents)
      .innerJoin(heartbeatRuns, eq(heartbeatRuns.agentId, agents.id))
      .where(
        and(
          opts?.companyId ? eq(heartbeatRuns.companyId, opts.companyId) : undefined,
          eq(heartbeatRuns.status, "running"),
          isNull(heartbeatRuns.processPid),
          isNull(heartbeatRuns.lastOutputAt),
          lt(heartbeatRuns.startedAt, preSpawnStaleBefore),
        ),
      );
    let stalePreSpawnRuns = 0;
    const reapedStalePreSpawnAgentIds = new Set<string>();
    for (const { agent } of stalePreSpawnAgentRows) {
      if (reapedStalePreSpawnAgentIds.has(agent.id)) continue;
      reapedStalePreSpawnAgentIds.add(agent.id);
      stalePreSpawnRuns += await reapStalePreSpawnRunsForAgent(agent);
    }

    const orphanedQueuedWakeups = await db
      .update(agentWakeupRequests)
      .set({
        status: "cancelled",
        finishedAt: now,
        error: "Cancelled stale queued wakeup without a linked heartbeat run",
        updatedAt: now,
      })
      .where(
        and(
          opts?.companyId ? eq(agentWakeupRequests.companyId, opts.companyId) : undefined,
          eq(agentWakeupRequests.status, "queued"),
          isNull(agentWakeupRequests.runId),
          lt(agentWakeupRequests.requestedAt, new Date(now.getTime() - LOCAL_AGENT_PRE_SPAWN_STALE_MS)),
        ),
      )
      .returning({ id: agentWakeupRequests.id });

    const queuedRunReconciliation = await reconcileQueuedHeartbeatRuns(now, opts);

    const staleRunningAgents = await db
      .update(agents)
      .set({ status: "idle", updatedAt: now })
      .where(
        and(
          opts?.companyId ? eq(agents.companyId, opts.companyId) : undefined,
          eq(agents.status, "running"),
          sql`not exists (
            select 1
            from ${heartbeatRuns}
            where ${heartbeatRuns.agentId} = ${agents.id}
              and ${heartbeatRuns.status} in ('queued', 'running')
          )`,
        ),
      )
      .returning({ id: agents.id });

    const result = {
      terminalClaimedWakeups: terminalLinkedWakeups.filter((wakeup) => wakeup.wakeupStatus === "claimed").length,
      terminalQueuedWakeups: terminalLinkedWakeups.filter((wakeup) => wakeup.wakeupStatus === "queued").length,
      stalePreSpawnRuns,
      orphanedQueuedWakeups: orphanedQueuedWakeups.length,
      staleQueuedRuns: queuedRunReconciliation.staleQueuedRuns,
      blockedQueuedRuns: queuedRunReconciliation.blockedQueuedRuns,
      staleRunningAgents: staleRunningAgents.length,
    };
    if (
      result.terminalClaimedWakeups > 0 ||
      result.terminalQueuedWakeups > 0 ||
      result.stalePreSpawnRuns > 0 ||
      result.orphanedQueuedWakeups > 0 ||
      result.staleQueuedRuns > 0 ||
      result.blockedQueuedRuns > 0 ||
      result.staleRunningAgents > 0
    ) {
      logger.warn(result, "reconciled persisted heartbeat runtime state");
    }
    return result;
  }

  function noActiveRoutineExecutionConflict(input: {
    companyId: string;
    issueId: string;
  }) {
    return sql`not exists (
      select 1
      from issues target
      join issues other
        on other.company_id = target.company_id
       and other.origin_kind = 'routine_execution'
       and other.origin_id = target.origin_id
       and other.origin_fingerprint = target.origin_fingerprint
       and other.id <> target.id
       and other.hidden_at is null
       and other.execution_run_id is not null
       and other.status in ('backlog', 'todo', 'in_progress', 'in_review', 'blocked')
      where target.id = ${input.issueId}
        and target.company_id = ${input.companyId}
        and target.origin_kind = 'routine_execution'
    )`;
  }

  async function claimQueuedRun(run: typeof heartbeatRuns.$inferSelect) {
    if (run.status !== "queued") return run;
    const agent = await getAgent(run.agentId);
    if (!agent) {
      await cancelRunInternal(run.id, "Cancelled because the agent no longer exists");
      return null;
    }
    if (agent.status === "paused" || agent.status === "terminated" || agent.status === "pending_approval") {
      await cancelRunInternal(run.id, "Cancelled because the agent is not invokable");
      return null;
    }

    const context = parseObject(run.contextSnapshot);
    const budgetBlock = await budgets.getInvocationBlock(run.companyId, run.agentId, {
      issueId: readNonEmptyString(context.issueId),
      projectId: readNonEmptyString(context.projectId),
    });
    if (budgetBlock) {
      await cancelRunInternal(run.id, budgetBlock.reason);
      return null;
    }

    const issueId = readNonEmptyString(context.issueId);
    if (issueId) {
      const activePauseHold = await treeControlSvc.getActivePauseHoldGate(run.companyId, issueId);
      const treeHoldInteractionWake = activePauseHold && await isVerifiedIssueTreeControlInteractionWake(db, {
        companyId: run.companyId,
        issueId,
        agentId: run.agentId,
        runId: run.id,
        wakeupRequestId: run.wakeupRequestId,
        contextSnapshot: context,
      });
      if (activePauseHold && !treeHoldInteractionWake) {
        await cancelRunInternal(run.id, "Cancelled because issue is held by an active subtree pause hold");
        await logActivity(db, {
          companyId: run.companyId,
          actorType: "system",
          actorId: "system",
          agentId: run.agentId,
          runId: run.id,
          action: "issue.tree_hold_run_interrupted",
          entityType: "heartbeat_run",
          entityId: run.id,
          details: {
            issueId,
            holdId: activePauseHold.holdId,
            rootIssueId: activePauseHold.rootIssueId,
            source: "heartbeat.claim_queued_run",
            securityPrinciples: ["Complete Mediation", "Fail Securely", "Secure Defaults"],
          },
        });
        return null;
      }

      const dependencyReadiness = await issuesSvc.listDependencyReadiness(run.companyId, [issueId]);
      const readiness = dependencyReadiness.get(issueId);
      const unresolvedBlockerCount = readiness?.unresolvedBlockerCount ?? 0;
      const isMeetingWorkflowWake = isMeetingWorkflowWakeContext(context);
      if (unresolvedBlockerCount > 0 && !allowsIssueInteractionWake(context) && !isMeetingWorkflowWake) {
        const managerTakeover = await getUnresolvedBlockerManagerTakeover({
          companyId: run.companyId,
          managerAgentId: run.agentId,
          issueId,
          unresolvedBlockerIssueIds: readiness?.unresolvedBlockerIssueIds ?? [],
        });
        if (managerTakeover) {
          await appendRunEvent(run, await nextRunEventSeq(run.id), {
            eventType: "lifecycle",
            stream: "system",
            level: "info",
            message: "Allowing manager takeover wake despite unresolved blocker",
            payload: {
              issueId,
              blockerIssueId: managerTakeover.issueId,
              blockerAssigneeAgentId: managerTakeover.assigneeAgentId,
              blockerAssigneeStatus: managerTakeover.assigneeStatus,
              takeoverReason: managerTakeover.reason,
            },
          });
        } else {
          await cancelQueuedRunForBlockedDependencies(run, issueId, readiness?.unresolvedBlockerIssueIds ?? []);
          logger.info({ runId: run.id, issueId, unresolvedBlockerCount }, "claimQueuedRun: cancelled blocked queued run");
          return null;
        }
      }

      const staleness = await evaluateQueuedRunStaleness(run, issueId, context);
      if (staleness.stale) {
        await cancelQueuedRunForStaleIssue(run, issueId, staleness);
        logger.info(
          { runId: run.id, issueId, errorCode: staleness.errorCode },
          "claimQueuedRun: cancelled stale queued run",
        );
        return null;
      }
    }

    const claimedAt = new Date();
    const claimed = await db
      .update(heartbeatRuns)
      .set({
        status: "running",
        startedAt: run.startedAt ?? claimedAt,
        updatedAt: claimedAt,
      })
      .where(and(eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.status, "queued")))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!claimed) return null;

    publishLiveEvent({
      companyId: claimed.companyId,
      type: "heartbeat.run.status",
      payload: {
        runId: claimed.id,
        agentId: claimed.agentId,
        status: claimed.status,
        invocationSource: claimed.invocationSource,
        triggerDetail: claimed.triggerDetail,
        error: claimed.error ?? null,
        errorCode: claimed.errorCode ?? null,
        startedAt: claimed.startedAt ? new Date(claimed.startedAt).toISOString() : null,
        finishedAt: claimed.finishedAt ? new Date(claimed.finishedAt).toISOString() : null,
      },
    });
    publishRunLifecyclePluginEvent(claimed);

    await setWakeupStatus(claimed.wakeupRequestId, "claimed", { claimedAt });

    // Fix A (lazy locking): stamp executionRunId now that the run is actually running,
    // not at queue time. Guard is idempotent — safe if called more than once.
    const claimedIssueId = readNonEmptyString(parseObject(claimed.contextSnapshot).issueId);
    if (claimedIssueId) {
      const claimedAgent = await getAgent(claimed.agentId);
      const lockedIssue = await db
        .update(issues)
        .set({
          executionRunId: claimed.id,
          executionAgentNameKey: normalizeAgentNameKey(claimedAgent?.name),
          executionLockedAt: claimedAt,
          updatedAt: claimedAt,
        })
        .where(
          and(
            eq(issues.id, claimedIssueId),
            eq(issues.companyId, claimed.companyId),
            // Mention/context runs can touch an issue, but only the current assignee
            // owns the issue execution lock shown as the active run.
            eq(issues.assigneeAgentId, claimed.agentId),
            or(isNull(issues.executionRunId), eq(issues.executionRunId, claimed.id)),
            noOpenRoutineExecutionDuplicateForIssue(),
          ),
        )
        .returning({ id: issues.id })
        .then((rows) => rows[0] ?? null);

      if (!lockedIssue) {
        const issueAssignee = await db
          .select({ assigneeAgentId: issues.assigneeAgentId })
          .from(issues)
          .where(and(eq(issues.id, claimedIssueId), eq(issues.companyId, claimed.companyId)))
          .then((rows) => rows[0] ?? null);

        if (issueAssignee && issueAssignee.assigneeAgentId !== claimed.agentId) {
          return claimed;
        }

        const reason =
          "Cancelled because another open routine execution issue for the same routine already owns the active execution lock";
        const finishedAt = new Date();
        await setRunStatus(claimed.id, "cancelled", {
          finishedAt,
          error: reason,
          errorCode: "duplicate_routine_execution",
          resultJson: {
            ...parseObject(claimed.resultJson),
            stopReason: "duplicate_routine_execution",
            issueId: claimedIssueId,
          },
        });
        await setWakeupStatus(claimed.wakeupRequestId, "skipped", {
          finishedAt,
          error: reason,
        });
        logger.warn(
          { runId: claimed.id, issueId: claimedIssueId },
          "claimQueuedRun: cancelled duplicate routine execution run",
        );
        return null;
      }
    }

    return claimed;
  }

  async function cancelQueuedRunForBlockedDependencies(
    run: typeof heartbeatRuns.$inferSelect,
    issueId: string,
    unresolvedBlockerIssueIds: string[],
  ) {
    const now = new Date();
    const reason =
      "Cancelled because issue dependencies are still blocked; Paperclip will wake the assignee when blockers resolve";
    const cancelled = await setRunStatus(run.id, "cancelled", {
      finishedAt: now,
      error: reason,
      errorCode: "issue_dependencies_blocked",
      resultJson: {
        ...parseObject(run.resultJson),
        stopReason: "issue_dependencies_blocked",
        effectiveTimeoutSec: 0,
        timeoutConfigured: false,
        timeoutSource: "dependency_gate",
        timeoutFired: false,
      },
    });
    if (!cancelled) return null;

    await setWakeupStatus(run.wakeupRequestId, "skipped", {
      finishedAt: now,
      error: reason,
    });

    await db
      .update(issues)
      .set({
        executionRunId: null,
        executionAgentNameKey: null,
        executionLockedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(issues.companyId, run.companyId),
          eq(issues.id, issueId),
          eq(issues.executionRunId, run.id),
        ),
      );

    await appendRunEvent(cancelled, await nextRunEventSeq(cancelled.id), {
      eventType: "lifecycle",
      stream: "system",
      level: "warn",
      message: reason,
      payload: {
        issueId,
        unresolvedBlockerIssueIds,
      },
    });

    return cancelled;
  }

  type QueuedRunStaleness =
    | { stale: false }
    | {
        stale: true;
        reason: string;
        errorCode:
          | "issue_not_found"
          | "issue_hidden"
          | "issue_assignee_changed"
          | "issue_terminal_status"
          | "issue_not_in_progress"
          | "issue_execution_lock_changed"
          | "issue_review_participant_changed"
          | "issue_continuation_waiting_on_review";
        details: Record<string, unknown>;
      };

  async function evaluateQueuedRunStaleness(
    run: typeof heartbeatRuns.$inferSelect,
    issueId: string,
    context: Record<string, unknown>,
    options: { allowNonAssigneeIssueWake?: boolean } = {},
  ): Promise<QueuedRunStaleness> {
    const issue = await db
      .select({
        id: issues.id,
        status: issues.status,
        hiddenAt: issues.hiddenAt,
        assigneeAgentId: issues.assigneeAgentId,
        executionRunId: issues.executionRunId,
        executionState: issues.executionState,
      })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.companyId, run.companyId)))
      .then((rows) => rows[0] ?? null);

    if (!issue) {
      return {
        stale: true,
        errorCode: "issue_not_found",
        reason: "Cancelled because the target issue no longer exists",
        details: { issueId },
      };
    }

    if (issue.hiddenAt) {
      return {
        stale: true,
        errorCode: "issue_hidden",
        reason: "Cancelled because the target issue is hidden before the queued run could start",
        details: { issueId, hiddenAt: issue.hiddenAt.toISOString() },
      };
    }

    const wakeCommentId = deriveCommentId(context, null);
    const isInteractionWake = allowsIssueInteractionWake(context);
    const resumeIntent = context.resumeIntent === true || context.followUpRequested === true;
    const wakeReason = readNonEmptyString(context.wakeReason);
    const retryReason = readNonEmptyString(context.retryReason) ?? run.scheduledRetryReason ?? null;

    if (
      issue.status === "in_progress" &&
      !wakeCommentId &&
      (wakeReason === "issue_continuation_needed" || retryReason === "issue_continuation_needed")
    ) {
      const queuedWake = parseObject(context.paperclipWake);
      const queuedContinuationSummary =
        readNonEmptyString(parseObject(context.paperclipContinuationSummary).body) ??
        readNonEmptyString(parseObject(queuedWake.continuationSummary).body);
      const currentContinuationSummary = queuedContinuationSummary
        ? null
        : await getIssueContinuationSummaryDocument(db, issueId);
      const continuationSummaryBody = queuedContinuationSummary ?? currentContinuationSummary?.body ?? null;
      if (continuationSummaryParksExecutor(continuationSummaryBody)) {
        return {
          stale: true,
          errorCode: "issue_continuation_waiting_on_review",
          reason:
            "Cancelled because the continuation summary says the executor should wait for reviewer feedback or approval before more work starts",
          details: {
            issueId,
            wakeReason,
            retryReason,
            nextAction: continuationSummaryBody,
          },
        };
      }
    }

    if (issue.assigneeAgentId !== run.agentId && !isInteractionWake && !options.allowNonAssigneeIssueWake) {
      return {
        stale: true,
        errorCode: "issue_assignee_changed",
        reason:
          "Cancelled because issue assignee changed before the queued run could start; the new owner will be woken instead",
        details: {
          issueId,
          previousAssigneeAgentId: run.agentId,
          currentAssigneeAgentId: issue.assigneeAgentId,
        },
      };
    }

    if (issue.status === "done" || issue.status === "cancelled") {
      const allowsClosedIssueCommentWake =
        wakeCommentId &&
        issue.status === "done";
      if (!allowsClosedIssueCommentWake) {
        return {
          stale: true,
          errorCode: "issue_terminal_status",
          reason: `Cancelled because issue reached terminal status (${issue.status}) before the queued run could start`,
          details: {
            issueId,
            currentStatus: issue.status,
            wakeReason,
            wakeCommentId,
            resumeIntent,
          },
        };
      }
    }

    const requiresInProgressRetry =
      retryReason === MAX_TURN_CONTINUATION_RETRY_REASON || retryReason === "issue_continuation_needed";
    if (requiresInProgressRetry && issue.status !== "in_progress") {
      return {
        stale: true,
        errorCode: "issue_not_in_progress",
        reason:
          retryReason === "issue_continuation_needed"
            ? `Cancelled because continuation issue is no longer in_progress (current status: ${issue.status}) before the queued run could start`
            : `Cancelled because max-turn continuation issue is no longer in_progress (current status: ${issue.status}) before the queued run could start`,
        details: { issueId, currentStatus: issue.status, requiredStatus: "in_progress", retryReason },
      };
    }

    if (retryReason === MAX_TURN_CONTINUATION_RETRY_REASON && issue.executionRunId !== run.id) {
      return {
        stale: true,
        errorCode: "issue_execution_lock_changed",
        reason:
          "Cancelled because max-turn continuation no longer owns the issue execution lock before the queued run could start",
        details: {
          issueId,
          expectedExecutionRunId: run.id,
          currentExecutionRunId: issue.executionRunId,
        },
      };
    }

    if (issue.status === "in_review") {
      const executionState = parseIssueExecutionState(issue.executionState);
      const currentParticipant = executionState?.currentParticipant ?? null;
      if (currentParticipant) {
        const participantMatches =
          currentParticipant.type === "agent" && currentParticipant.agentId === run.agentId;
        if (!participantMatches && !wakeCommentId) {
          return {
            stale: true,
            errorCode: "issue_review_participant_changed",
            reason:
              "Cancelled because the in-review participant changed before the queued run could start; the current participant will be woken instead",
            details: {
              issueId,
              currentStageType: executionState?.currentStageType ?? null,
              currentParticipant,
            },
          };
        }
      }
    }

    return { stale: false };
  }

  async function cancelQueuedRunForStaleIssue(
    run: typeof heartbeatRuns.$inferSelect,
    issueId: string,
    staleness: Extract<QueuedRunStaleness, { stale: true }>,
  ) {
    const now = new Date();
    const cancelled = await setRunStatus(run.id, "cancelled", {
      finishedAt: now,
      error: staleness.reason,
      errorCode: staleness.errorCode,
      resultJson: {
        ...parseObject(run.resultJson),
        stopReason: staleness.errorCode,
        effectiveTimeoutSec: 0,
        timeoutConfigured: false,
        timeoutSource: "stale_queued_run_gate",
        timeoutFired: false,
      },
    });
    if (!cancelled) return null;

    await setWakeupStatus(run.wakeupRequestId, "skipped", {
      finishedAt: now,
      error: staleness.reason,
    });

    await db
      .update(issues)
      .set({
        executionRunId: null,
        executionAgentNameKey: null,
        executionLockedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(issues.companyId, run.companyId),
          eq(issues.id, issueId),
          eq(issues.executionRunId, run.id),
        ),
      );

    await appendRunEvent(cancelled, await nextRunEventSeq(cancelled.id), {
      eventType: "lifecycle",
      stream: "system",
      level: "warn",
      message: staleness.reason,
      payload: staleness.details,
    });

    if (staleness.errorCode === "issue_assignee_changed") {
      await releaseIssueExecutionAndPromote(cancelled);
    }

    return cancelled;
  }

  async function finalizeAgentStatus(
    agentId: string,
    outcome: "succeeded" | "failed" | "cancelled" | "timed_out",
    errorCode?: string | null,
  ) {
    const existing = await getAgent(agentId);
    if (!existing) return;

    if (existing.status === "paused" || existing.status === "terminated") {
      return;
    }

    const isFirstHeartbeat = !existing.lastHeartbeatAt;

    const runningCount = await countRunningRunsForAgent(agentId);
    const nextStatus =
      runningCount > 0
        ? "running"
        : outcome === "succeeded" || outcome === "cancelled"
          ? "idle"
          : errorCode === "missing_issue_disposition"
            ? "idle"
            : "error";

    const updated = await db
      .update(agents)
      .set({
        status: nextStatus,
        lastHeartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agentId))
      .returning()
      .then((rows) => rows[0] ?? null);

    if (isFirstHeartbeat && updated) {
      const tc = getTelemetryClient();
      if (tc) trackAgentFirstHeartbeat(tc, { agentRole: updated.role, agentId: updated.id });
    }

    if (updated) {
      publishLiveEvent({
        companyId: updated.companyId,
        type: "agent.status",
        payload: {
          agentId: updated.id,
          status: updated.status,
          lastHeartbeatAt: updated.lastHeartbeatAt
            ? new Date(updated.lastHeartbeatAt).toISOString()
            : null,
          outcome,
        },
      });
    }
  }

  function mergeRunStopMetadataForAgent(
    agent: Pick<typeof agents.$inferSelect, "adapterType" | "adapterConfig">,
    outcome: "succeeded" | "failed" | "cancelled" | "timed_out",
    options?: {
      resultJson?: Record<string, unknown> | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
  ) {
    const stopMetadata = buildHeartbeatRunStopMetadata({
      adapterType: agent.adapterType,
      adapterConfig: parseObject(agent.adapterConfig),
      outcome,
      errorCode: options?.errorCode ?? null,
      errorMessage: options?.errorMessage ?? null,
    });
    return mergeHeartbeatRunStopMetadata(options?.resultJson ?? null, stopMetadata);
  }

  function countValue(value: unknown) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }

  function dateValue(value: unknown) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "string" || typeof value === "number") {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  function latestDate(...values: unknown[]) {
    let latest: Date | null = null;
    for (const value of values) {
      const parsed = dateValue(value);
      if (!parsed) continue;
      if (!latest || parsed.getTime() > latest.getTime()) latest = parsed;
    }
    return latest;
  }

  async function buildRunLivenessInput(
    run: typeof heartbeatRuns.$inferSelect,
    resultJson: Record<string, unknown> | null | undefined,
  ): Promise<RunLivenessClassificationInput> {
    const context = parseObject(run.contextSnapshot);
    const contextIssueId = readNonEmptyString(context.issueId);
    const continuationAttempt = asNumber(context.continuationAttempt, run.continuationAttempt ?? 0);

    const issue = contextIssueId
      ? await db
        .select({
          status: issues.status,
          title: issues.title,
          description: issues.description,
        })
        .from(issues)
        .where(and(eq(issues.companyId, run.companyId), eq(issues.id, contextIssueId)))
        .then((rows) => rows[0] ?? null)
      : null;

    const [commentStats] = contextIssueId
      ? await db
        .select({
          count: sql<number>`count(*)::int`,
          latestAt: sql<Date | null>`max(${issueComments.createdAt})`,
        })
        .from(issueComments)
        .where(
          and(
            eq(issueComments.companyId, run.companyId),
            eq(issueComments.issueId, contextIssueId),
            eq(issueComments.createdByRunId, run.id),
          ),
        )
      : [{ count: 0, latestAt: null }];

    const issueCommentBodies = contextIssueId
      ? await db
        .select({ body: issueComments.body })
        .from(issueComments)
        .where(
          and(
            eq(issueComments.companyId, run.companyId),
            eq(issueComments.issueId, contextIssueId),
            eq(issueComments.createdByRunId, run.id),
          ),
        )
        .orderBy(desc(issueComments.createdAt), desc(issueComments.id))
        .limit(5)
        .then((rows) => rows.reverse().map((row) => row.body))
      : [];

    const continuationSummary = contextIssueId
      ? await getIssueContinuationSummaryDocument(db, contextIssueId)
      : null;

    const [documentStats] = contextIssueId
      ? await db
        .select({
          count: sql<number>`count(*)::int`,
          planCount: sql<number>`count(*) filter (where ${issueDocuments.key} = 'plan')::int`,
          latestAt: sql<Date | null>`max(${documentRevisions.createdAt})`,
        })
        .from(documentRevisions)
        .innerJoin(issueDocuments, eq(documentRevisions.documentId, issueDocuments.documentId))
        .where(
          and(
            eq(documentRevisions.companyId, run.companyId),
            eq(documentRevisions.createdByRunId, run.id),
            eq(issueDocuments.companyId, run.companyId),
            eq(issueDocuments.issueId, contextIssueId),
            sql`${issueDocuments.key} != ${ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY}`,
          ),
        )
      : [{ count: 0, planCount: 0, latestAt: null }];

    const [workProductStats] = contextIssueId
      ? await db
        .select({
          count: sql<number>`count(*)::int`,
          latestAt: sql<Date | null>`max(${issueWorkProducts.createdAt})`,
        })
        .from(issueWorkProducts)
        .where(
          and(
            eq(issueWorkProducts.companyId, run.companyId),
            eq(issueWorkProducts.issueId, contextIssueId),
            eq(issueWorkProducts.createdByRunId, run.id),
          ),
        )
      : [{ count: 0, latestAt: null }];

    const [workspaceOperationStats] = await db
      .select({
        count: sql<number>`count(*)::int`,
        latestAt: sql<Date | null>`max(${workspaceOperations.startedAt})`,
      })
      .from(workspaceOperations)
      .where(and(eq(workspaceOperations.companyId, run.companyId), eq(workspaceOperations.heartbeatRunId, run.id)));

    const [activityStats] = await db
      .select({
        count: sql<number>`count(*)::int`,
        latestAt: sql<Date | null>`max(${activityLog.createdAt})`,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, run.companyId),
          eq(activityLog.runId, run.id),
          notInArray(activityLog.action, LIVENESS_BOOKKEEPING_ACTIVITY_ACTIONS),
        ),
      );

    const [eventStats] = await db
      .select({
        count: sql<number>`count(*) filter (where ${heartbeatRunEvents.eventType} not in ('lifecycle', 'adapter.invoke', 'error'))::int`,
        latestAt: sql<Date | null>`max(${heartbeatRunEvents.createdAt}) filter (where ${heartbeatRunEvents.eventType} not in ('lifecycle', 'adapter.invoke', 'error'))`,
      })
      .from(heartbeatRunEvents)
      .where(and(eq(heartbeatRunEvents.companyId, run.companyId), eq(heartbeatRunEvents.runId, run.id)));

    return {
      runStatus: run.status,
      issue,
      resultJson: resultJson ?? run.resultJson ?? null,
      issueCommentBodies,
      continuationSummaryBody: continuationSummary?.body ?? null,
      stdoutExcerpt: run.stdoutExcerpt ?? null,
      stderrExcerpt: run.stderrExcerpt ?? null,
      error: run.error ?? null,
      errorCode: run.errorCode ?? null,
      continuationAttempt,
      evidence: {
        issueCommentsCreated: countValue(commentStats?.count),
        documentRevisionsCreated: countValue(documentStats?.count),
        planDocumentRevisionsCreated: countValue(documentStats?.planCount),
        workProductsCreated: countValue(workProductStats?.count),
        workspaceOperationsCreated: countValue(workspaceOperationStats?.count),
        activityEventsCreated: countValue(activityStats?.count),
        toolOrActionEventsCreated: countValue(eventStats?.count),
        latestEvidenceAt: latestDate(
          commentStats?.latestAt,
          documentStats?.latestAt,
          workProductStats?.latestAt,
          workspaceOperationStats?.latestAt,
          activityStats?.latestAt,
          eventStats?.latestAt,
        ),
      },
    };
  }

  async function classifyAndPersistRunLiveness(
    run: typeof heartbeatRuns.$inferSelect,
    resultJson?: Record<string, unknown> | null,
  ) {
    const classification = classifyRunLiveness(await buildRunLivenessInput(run, resultJson));
    return db
      .update(heartbeatRuns)
      .set({
        livenessState: classification.livenessState,
        livenessReason: classification.livenessReason,
        continuationAttempt: classification.continuationAttempt,
        lastUsefulActionAt: classification.lastUsefulActionAt,
        nextAction: classification.nextAction,
        updatedAt: new Date(),
      })
      .where(eq(heartbeatRuns.id, run.id))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function reapOrphanedRuns(opts?: { staleThresholdMs?: number }) {
    const staleThresholdMs = opts?.staleThresholdMs ?? 0;
    const now = new Date();

    // Find all runs stuck in "running" state (queued runs are legitimately waiting; resumeQueuedRuns handles them)
    const activeRuns = await db
      .select({
        run: heartbeatRuns,
        adapterType: agents.adapterType,
        adapterConfig: agents.adapterConfig,
      })
      .from(heartbeatRuns)
      .innerJoin(agents, eq(heartbeatRuns.agentId, agents.id))
      .where(eq(heartbeatRuns.status, "running"));

    const reaped: string[] = [];

    for (const { run, adapterType, adapterConfig } of activeRuns) {
      // Apply staleness threshold to avoid false positives
      if (staleThresholdMs > 0) {
        const refTime = run.updatedAt ? new Date(run.updatedAt).getTime() : 0;
        if (now.getTime() - refTime < staleThresholdMs) continue;
      }

      const tracksLocalChild = isTrackedLocalChildProcessAdapter(adapterType);
      const processPidAlive = tracksLocalChild && run.processPid && isProcessAlive(run.processPid);
      const processGroupAlive = tracksLocalChild && run.processGroupId && isProcessGroupAlive(run.processGroupId);
      const activeInMemory = runningProcesses.has(run.id) || activeRunExecutions.has(run.id);
      const hasTrackedProcessRef = Boolean(run.processPid || run.processGroupId);
      const lostTrackedChild = tracksLocalChild && hasTrackedProcessRef && !processPidAlive && !processGroupAlive;
      const silenceStartedAt = run.lastOutputAt ?? run.processStartedAt ?? null;
      const criticallySilent =
        silenceStartedAt !== null &&
        now.getTime() - new Date(silenceStartedAt).getTime() >= ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS;
      const allowCriticallySilentTrackedCleanup =
        tracksLocalChild &&
        criticallySilent &&
        Boolean(processPidAlive || processGroupAlive);
      const staleActiveWithoutTrackedChild =
        activeInMemory &&
        tracksLocalChild &&
        !hasTrackedProcessRef &&
        staleThresholdMs > 0;
      if (
        activeInMemory &&
        !allowCriticallySilentTrackedCleanup &&
        !lostTrackedChild &&
        !staleActiveWithoutTrackedChild
      ) {
        continue;
      }

      let criticallySilentDetachedCleanup = false;
      let criticallySilentTrackedCleanup = false;
      if (processPidAlive) {
        if (criticallySilent) {
          criticallySilentDetachedCleanup = !runningProcesses.has(run.id) && !activeRunExecutions.has(run.id);
          criticallySilentTrackedCleanup = !criticallySilentDetachedCleanup;
          await terminateHeartbeatRunProcess({
            pid: run.processPid,
            processGroupId: run.processGroupId,
          });
        } else if (run.errorCode !== DETACHED_PROCESS_ERROR_CODE) {
          const detachedMessage = `Lost in-memory process handle, but child pid ${run.processPid} is still alive`;
          const detachedRun = await setRunStatus(run.id, "running", {
            error: detachedMessage,
            errorCode: DETACHED_PROCESS_ERROR_CODE,
          });
          if (detachedRun) {
            await appendRunEvent(detachedRun, await nextRunEventSeq(detachedRun.id), {
              eventType: "lifecycle",
              stream: "system",
              level: "warn",
              message: detachedMessage,
              payload: {
                processPid: run.processPid,
              },
            });
          }
        }
        if (!(criticallySilentDetachedCleanup || criticallySilentTrackedCleanup)) continue;
      }

      let descendantOnlyCleanup = false;
      if (processGroupAlive) {
        descendantOnlyCleanup = true;
        await terminateHeartbeatRunProcess({
          pid: run.processPid,
          processGroupId: run.processGroupId,
        });
      }

      const contextSnapshot = parseObject(run.contextSnapshot);
      const issueId = readNonEmptyString(contextSnapshot.issueId);
      const retryCapReached = await processLossRetryCapReached({
        companyId: run.companyId,
        agentId: run.agentId,
        issueId,
        now,
      });
      const shouldRetry =
        tracksLocalChild &&
        (!!run.processPid || !!run.processGroupId) &&
        (run.processLossRetryCount ?? 0) < 1 &&
        !retryCapReached;
      const baseMessage = buildProcessLossMessage(
        run,
        criticallySilentDetachedCleanup || criticallySilentTrackedCleanup
          ? {
              criticallySilentDetachedChild: criticallySilentDetachedCleanup,
              criticallySilentTrackedChild: criticallySilentTrackedCleanup,
            }
          : descendantOnlyCleanup
            ? { descendantOnly: true }
            : staleActiveWithoutTrackedChild
              ? { staleActiveWithoutTrackedChild: true }
            : undefined,
      );
      const retrySuppressionMessage = retryCapReached
        ? `; process_lost retry cap reached for this agent/issue (${PROCESS_LOSS_RETRY_AGENT_ISSUE_CAP} per ${Math.round(PROCESS_LOSS_RETRY_WINDOW_MS / 60_000)}m)`
        : "";

      let finalizedRun = await setRunStatus(run.id, "failed", {
        error: shouldRetry ? `${baseMessage}; retrying once` : `${baseMessage}${retrySuppressionMessage}`,
        errorCode: "process_lost",
        finishedAt: now,
        resultJson: mergeRunStopMetadataForAgent(
          { adapterType, adapterConfig },
          "failed",
          {
            resultJson: parseObject(run.resultJson),
            errorCode: "process_lost",
            errorMessage: shouldRetry ? `${baseMessage}; retrying once` : `${baseMessage}${retrySuppressionMessage}`,
          },
        ),
      });
      await setWakeupStatus(run.wakeupRequestId, "failed", {
        finishedAt: now,
        error: shouldRetry ? `${baseMessage}; retrying once` : `${baseMessage}${retrySuppressionMessage}`,
      });
      if (!finalizedRun) finalizedRun = await getRun(run.id);
      if (!finalizedRun) continue;
      finalizedRun = await classifyAndPersistRunLiveness(finalizedRun, parseObject(finalizedRun.resultJson)) ?? finalizedRun;
      await releaseEnvironmentLeasesForRun({
        runId: finalizedRun.id,
        companyId: finalizedRun.companyId,
        agentId: finalizedRun.agentId,
        status: finalizedRun.status,
        failureReason: finalizedRun.error ?? undefined,
      });

      let retriedRun: typeof heartbeatRuns.$inferSelect | null = null;
      if (shouldRetry) {
        const agent = await getAgent(run.agentId);
        if (agent) {
          retriedRun = await enqueueProcessLossRetry(finalizedRun, agent, now);
        }
      } else {
        await releaseIssueExecutionAndPromote(finalizedRun);
      }

      await appendRunEvent(finalizedRun, await nextRunEventSeq(finalizedRun.id), {
        eventType: "lifecycle",
        stream: "system",
        level: "error",
          message: shouldRetry
            ? `${baseMessage}; queued retry ${retriedRun?.id ?? ""}`.trim()
            : `${baseMessage}${retrySuppressionMessage}`,
        payload: {
          ...(run.processPid ? { processPid: run.processPid } : {}),
          ...(run.processGroupId ? { processGroupId: run.processGroupId } : {}),
          ...(descendantOnlyCleanup ? { descendantOnlyCleanup: true } : {}),
          ...(criticallySilentDetachedCleanup ? { criticallySilentDetachedCleanup: true } : {}),
          ...(criticallySilentTrackedCleanup ? { criticallySilentTrackedCleanup: true } : {}),
          ...(staleActiveWithoutTrackedChild ? { staleActiveWithoutTrackedChild: true } : {}),
          ...(retryCapReached ? {
            processLossRetryCap: PROCESS_LOSS_RETRY_AGENT_ISSUE_CAP,
            processLossRetryWindowMs: PROCESS_LOSS_RETRY_WINDOW_MS,
          } : {}),
          ...(retriedRun ? { retryRunId: retriedRun.id } : {}),
        },
      });

      await finalizeAgentStatus(run.agentId, "failed");
      await startNextQueuedRunForAgent(run.agentId);
      runningProcesses.delete(run.id);
      activeRunExecutions.delete(run.id);
      reaped.push(run.id);
    }

    if (reaped.length > 0) {
      logger.warn({ reapedCount: reaped.length, runIds: reaped }, "reaped orphaned heartbeat runs");
    }
    return { reaped: reaped.length, runIds: reaped };
  }

  async function resumeQueuedRuns() {
    const queuedRuns = await db
      .select({ agentId: heartbeatRuns.agentId })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.status, "queued"));

    const agentIds = [...new Set(queuedRuns.map((r) => r.agentId))];
    for (const agentId of agentIds) {
      await startNextQueuedRunForAgent(agentId);
    }
  }

  async function reconcileStrandedAssignedIssues(opts?: { companyId?: string }) {
    return recovery.reconcileStrandedAssignedIssues(opts);
  }

  function issueIdFromRunContext(contextSnapshot: unknown) {
    const context = parseObject(contextSnapshot);
    return readNonEmptyString(context.issueId) ?? readNonEmptyString(context.taskId);
  }

  function issueIdFromWakePayload(payload: unknown) {
    const parsed = parseObject(payload);
    const nestedContext = parseObject(parsed[DEFERRED_WAKE_CONTEXT_KEY]);
    return readNonEmptyString(parsed.issueId) ??
      readNonEmptyString(nestedContext.issueId) ??
      readNonEmptyString(nestedContext.taskId);
  }

  async function scanSilentActiveRuns(opts?: { now?: Date; companyId?: string }) {
    return recovery.scanSilentActiveRuns(opts);
  }

  async function reconcileProductivityReviews(opts?: { now?: Date; companyId?: string }) {
    return productivityReviews.reconcileProductivityReviews(opts);
  }

  async function buildRunOutputSilence(
    run: Pick<
      typeof heartbeatRuns.$inferSelect,
      "id" | "companyId" | "status" | "lastOutputAt" | "lastOutputSeq" | "lastOutputStream" | "processStartedAt" | "startedAt" | "createdAt"
    >,
    now = new Date(),
  ) {
    return recovery.buildRunOutputSilence(run, now);
  }

  async function buildIssueGraphLivenessAutoRecoveryPreview(opts?: { lookbackHours?: number; now?: Date; companyId?: string }) {
    return recovery.buildIssueGraphLivenessAutoRecoveryPreview(opts);
  }

  async function reconcileIssueGraphLiveness(opts?: {
    runId?: string | null;
    force?: boolean;
    lookbackHours?: number;
    companyId?: string;
  }) {
    return recovery.reconcileIssueGraphLiveness(opts);
  }

  async function updateRuntimeState(
    agent: typeof agents.$inferSelect,
    run: typeof heartbeatRuns.$inferSelect,
    result: AdapterExecutionResult,
    session: { legacySessionId: string | null },
    normalizedUsage?: UsageTotals | null,
  ) {
    await ensureRuntimeState(agent);
    const usage = normalizedUsage ?? normalizeUsageTotals(result.usage);
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cachedInputTokens = usage?.cachedInputTokens ?? 0;
    const billingType = normalizeLedgerBillingType(result.billingType);
    const additionalCostCents = normalizeBilledCostCents(result.costUsd, billingType);
    const hasTokenUsage = inputTokens > 0 || outputTokens > 0 || cachedInputTokens > 0;
    const provider = result.provider ?? "unknown";
    const biller = resolveLedgerBiller(result);
    const ledgerScope = await resolveLedgerScopeForRun(db, agent.companyId, run);

    await db
      .update(agentRuntimeState)
      .set({
        adapterType: agent.adapterType,
        sessionId: session.legacySessionId,
        lastRunId: run.id,
        lastRunStatus: run.status,
        lastError: result.errorMessage ?? null,
        totalInputTokens: sql`${agentRuntimeState.totalInputTokens} + ${inputTokens}`,
        totalOutputTokens: sql`${agentRuntimeState.totalOutputTokens} + ${outputTokens}`,
        totalCachedInputTokens: sql`${agentRuntimeState.totalCachedInputTokens} + ${cachedInputTokens}`,
        totalCostCents: sql`${agentRuntimeState.totalCostCents} + ${additionalCostCents}`,
        updatedAt: new Date(),
      })
      .where(eq(agentRuntimeState.agentId, agent.id));

    if (additionalCostCents > 0 || hasTokenUsage) {
      const costs = costService(db, budgetHooks);
      await costs.createEvent(agent.companyId, {
        heartbeatRunId: run.id,
        agentId: agent.id,
        issueId: ledgerScope.issueId,
        projectId: ledgerScope.projectId,
        provider,
        biller,
        billingType,
        model: result.model ?? "unknown",
        inputTokens,
        cachedInputTokens,
        outputTokens,
        costCents: additionalCostCents,
        occurredAt: new Date(),
      });
    }
  }

  async function agentHasDirectReports(agent: typeof agents.$inferSelect) {
    const row = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, agent.companyId),
          eq(agents.reportsTo, agent.id),
          notInArray(agents.status, ["terminated"]),
        ),
      )
      .then((rows) => rows[0] ?? null);
    return Number(row?.count ?? 0) > 0;
  }

  async function refreshStockInstructionsForRole(agent: typeof agents.$inferSelect) {
    const hasDirectReports = await agentHasDirectReports(agent);
    const targetBundleRole = resolveDefaultAgentInstructionsBundleRole(agent.role, {
      title: agent.title,
      hasDirectReports,
    });
    if (targetBundleRole !== "manager") return agent;

    const [oldDefaultFiles, managerFiles] = await Promise.all([
      loadDefaultAgentInstructionsBundle("default"),
      loadDefaultAgentInstructionsBundle("manager"),
    ]);
    const refreshed = await agentInstructions.replaceBundleIfFilesMatch(
      agent,
      oldDefaultFiles,
      managerFiles,
    );
    if (!refreshed.updated) return agent;

    await db
      .update(agents)
      .set({
        adapterConfig: refreshed.adapterConfig,
        updatedAt: new Date(),
      })
      .where(and(eq(agents.id, agent.id), eq(agents.companyId, agent.companyId)));
    logger.info(
      { companyId: agent.companyId, agentId: agent.id, role: agent.role, title: agent.title, hasDirectReports },
      "Refreshed stock instructions for manager-role agent",
    );
    return {
      ...agent,
      adapterConfig: refreshed.adapterConfig,
    };
  }

  async function refreshStockInstructionsForManagerAgents() {
    const candidates = await db
      .select()
      .from(agents)
      .where(notInArray(agents.status, ["terminated"]));
    const managerAgents: Array<typeof agents.$inferSelect> = [];
    for (const agent of candidates) {
      const hasDirectReports = await agentHasDirectReports(agent);
      if (isManagerLikeAgent({ role: agent.role, title: agent.title, hasDirectReports })) {
        managerAgents.push(agent);
      }
    }
    let updated = 0;
    let updatedManaged = 0;
    let updatedExternal = 0;
    const failed: Array<{ agentId: string; error: string }> = [];

    for (const agent of managerAgents) {
      try {
        const before = await agentInstructions.getBundle(agent);
        const refreshed = await refreshStockInstructionsForRole(agent);
        if (refreshed === agent) continue;
        updated += 1;
        if (before.mode === "external") updatedExternal += 1;
        else updatedManaged += 1;
      } catch (error) {
        failed.push({
          agentId: agent.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      scanned: managerAgents.length,
      updated,
      updatedManaged,
      updatedExternal,
      failed,
    };
  }

  async function startNextQueuedRunForAgent(agentId: string) {
    return withAgentStartLock(agentId, async () => {
      const agent = await getAgent(agentId);
      if (!agent) return [];
      if (agent.status === "paused" || agent.status === "terminated" || agent.status === "pending_approval") {
        return [];
      }
      const policy = parseHeartbeatPolicy(agent);
      await reapStalePreSpawnRunsForAgent(agent);
      await pruneQueuedRunsForAgent(agent);
      const queuedRuns = await db
        .select()
        .from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.status, "queued")))
        .orderBy(asc(heartbeatRuns.createdAt));
      if (queuedRuns.length === 0) return [];

      const hasPriorityQueuedRun = queuedRuns.some((run) => isPriorityQueuedRun(run));
      const maxGlobalRunningRuns = HEARTBEAT_GLOBAL_RUNNING_RUNS_MAX +
        (hasPriorityQueuedRun ? HEARTBEAT_GLOBAL_PRIORITY_BURST_MAX : 0);
      const globalRunningCount = await countRunningRuns();
      if (globalRunningCount >= maxGlobalRunningRuns) {
        logger.debug(
          {
            agentId,
            globalRunningCount,
            maxGlobalRunningRuns,
            priorityBurstApplied: hasPriorityQueuedRun,
          },
          "skipping queued-run start because global heartbeat concurrency is full",
        );
        return [];
      }
      const localAvailableRunExecutionSlots = computeLocalAvailableRunExecutionSlots({
        maxLocalActiveRunExecutions: LOCAL_ACTIVE_RUN_EXECUTIONS_MAX,
        inMemoryActiveRunExecutions: activeRunExecutions.size,
        persistedRunningRuns: globalRunningCount,
      });
      if (localAvailableRunExecutionSlots <= 0) {
        logger.debug(
          {
            agentId,
            localActiveRunExecutions: activeRunExecutions.size,
            persistedRunningRuns: globalRunningCount,
            maxLocalActiveRunExecutions: LOCAL_ACTIVE_RUN_EXECUTIONS_MAX,
          },
          "skipping queued-run start because local heartbeat launch capacity is full",
        );
        return [];
      }
      const runningCount = await countRunningRunsForAgent(agentId);
      const effectiveMaxConcurrentRuns = effectiveMaxConcurrentRunsForQueuedBacklog(
        policy.maxConcurrentRuns,
        queuedRuns.length,
      );
      const availableSlots = Math.max(
        0,
        Math.min(
          effectiveMaxConcurrentRuns - runningCount,
          maxGlobalRunningRuns - globalRunningCount,
          localAvailableRunExecutionSlots,
        ),
      );
      if (availableSlots <= 0) return [];

      const dependencyReadiness = await listQueuedRunDependencyReadiness(agent.companyId, queuedRuns);
      const queuedIssueIds = [...new Set(
        queuedRuns
          .map((run) => readNonEmptyString(parseObject(run.contextSnapshot).issueId))
          .filter((issueId): issueId is string => Boolean(issueId)),
      )];
      const issueRows = await db
        .select({
          id: issues.id,
          status: issues.status,
          priority: issues.priority,
          originKind: issues.originKind,
        })
        .from(issues)
        .where(
          queuedIssueIds.length > 0
            ? and(eq(issues.companyId, agent.companyId), inArray(issues.id, queuedIssueIds))
            : sql`false`,
        );
      const issueById = new Map(issueRows.map((row) => [row.id, row]));
      const schedulingRank = (input: {
        issueId: string | null;
        issueStatus?: string | null;
        dependencyReady: boolean;
        interactionWake: boolean;
      }) => {
        if (!input.issueId) return 2;
        if (!input.dependencyReady) return 3;
        if (input.issueStatus === "in_progress") return 0;
        if (input.issueStatus === "blocked") return input.interactionWake ? 2 : 4;
        return 1;
      };
      const prioritizedRuns = [...queuedRuns].sort((left, right) => {
        const leftContext = parseObject(left.contextSnapshot);
        const rightContext = parseObject(right.contextSnapshot);
        const leftIssueId = readNonEmptyString(leftContext.issueId);
        const rightIssueId = readNonEmptyString(rightContext.issueId);
        const leftReadiness = leftIssueId ? dependencyReadiness.get(leftIssueId) : null;
        const rightReadiness = rightIssueId ? dependencyReadiness.get(rightIssueId) : null;
        const leftReady = leftIssueId ? (leftReadiness?.isDependencyReady ?? true) : true;
        const rightReady = rightIssueId ? (rightReadiness?.isDependencyReady ?? true) : true;
        const leftIssue = leftIssueId ? issueById.get(leftIssueId) : null;
        const rightIssue = rightIssueId ? issueById.get(rightIssueId) : null;
        const leftInteraction = allowsIssueInteractionWake(leftContext) || isMeetingWorkflowWakeContext(leftContext);
        const rightInteraction = allowsIssueInteractionWake(rightContext) || isMeetingWorkflowWakeContext(rightContext);
        const leftPriorityWake = isPriorityQueuedRun(left);
        const rightPriorityWake = isPriorityQueuedRun(right);
        if (leftPriorityWake !== rightPriorityWake) return leftPriorityWake ? -1 : 1;
        const leftRank = schedulingRank({
          issueId: leftIssueId,
          issueStatus: leftIssue?.status,
          dependencyReady: leftReady,
          interactionWake: leftInteraction,
        });
        const rightRank = schedulingRank({
          issueId: rightIssueId,
          issueStatus: rightIssue?.status,
          dependencyReady: rightReady,
          interactionWake: rightInteraction,
        });
        if (leftRank !== rightRank) return leftRank - rightRank;
        const leftPriorityRank = issueRunPriorityRank(leftIssue);
        const rightPriorityRank = issueRunPriorityRank(rightIssue);
        if (leftPriorityRank !== rightPriorityRank) return leftPriorityRank - rightPriorityRank;
        return left.createdAt.getTime() - right.createdAt.getTime();
      });

      const claimedRuns: Array<typeof heartbeatRuns.$inferSelect> = [];
      for (const queuedRun of prioritizedRuns) {
        if (claimedRuns.length >= availableSlots) break;
        const claimed = await claimQueuedRun(queuedRun);
        if (claimed) claimedRuns.push(claimed);
      }
      if (claimedRuns.length === 0) return [];

      for (const claimedRun of claimedRuns) {
        const execution = executeRun(claimedRun.id).catch((err) => {
          logger.error({ err, runId: claimedRun.id }, "queued heartbeat execution failed");
        });
        activeRunExecutions.set(claimedRun.id, {
          runId: claimedRun.id,
          agentId: claimedRun.agentId,
          companyId: claimedRun.companyId,
          promise: execution,
        });
      }
      return claimedRuns;
    });
  }

  async function executeRun(runId: string) {
    let run = await getRun(runId);
    if (!run) return;
    if (run.status !== "queued" && run.status !== "running") return;

    if (run.status === "queued") {
      const claimed = await claimQueuedRun(run);
      if (!claimed) {
        // claimQueuedRun can also leave the run queued when dependencies are unresolved.
        return;
      }
      run = claimed;
    }
    try {
    let agent = await getAgent(run.agentId);
    if (!agent) {
      await setRunStatus(runId, "failed", {
        error: "Agent not found",
        errorCode: "agent_not_found",
        finishedAt: new Date(),
      });
      await setWakeupStatus(run.wakeupRequestId, "failed", {
        finishedAt: new Date(),
        error: "Agent not found",
      });
      const failedRun = await getRun(runId);
      if (failedRun) await releaseIssueExecutionAndPromote(failedRun);
      return;
    }
    agent = await refreshStockInstructionsForRole(agent);

    const runtime = await ensureRuntimeState(agent);
    const context = parseObject(run.contextSnapshot);
    const taskKey = deriveTaskKeyWithHeartbeatFallback(context, null);
    const sessionCodec = getAdapterSessionCodec(agent.adapterType);
    const issueId = readNonEmptyString(context.issueId);
    let issueContext = issueId ? await getIssueExecutionContext(agent.companyId, issueId) : null;
    const issueDependencyReadiness = issueId
      ? await issuesSvc.listDependencyReadiness(agent.companyId, [issueId]).then((rows) => rows.get(issueId) ?? null)
      : null;
    if (
      issueId &&
      issueContext &&
      shouldAutoCheckoutIssueForWake({
        contextSnapshot: context,
        issueStatus: issueContext.status,
        issueAssigneeAgentId: issueContext.assigneeAgentId,
        isDependencyReady: issueDependencyReadiness?.isDependencyReady ?? true,
        agentId: agent.id,
      })
    ) {
      try {
        context[PAPERCLIP_PRE_CHECKOUT_STATUS_KEY] = issueContext.status;
        await issuesSvc.checkout(issueId, agent.id, autoCheckoutExpectedStatusesForWake(context), run.id);
        context[PAPERCLIP_HARNESS_CHECKOUT_KEY] = true;
      } catch (error) {
        const unresolvedBlockerIssueIds = readBlockedCheckoutUnresolvedBlockerIssueIds(error);
        if (unresolvedBlockerIssueIds) {
          await cancelQueuedRunForBlockedDependencies(run, issueId, unresolvedBlockerIssueIds);
          return;
        }
        if (!isCheckoutConflictError(error)) throw error;
        context[PAPERCLIP_HARNESS_CHECKOUT_KEY] = false;
      }
      await db
        .update(heartbeatRuns)
        .set({
          contextSnapshot: context,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, run.id));
      issueContext = await getIssueExecutionContext(agent.companyId, issueId);
    }
    const wakeCommentId = deriveCommentId(context, null);
    const wakeCommentContext =
      issueContext && wakeCommentId
        ? await db
            .select({
              id: issueComments.id,
              body: issueComments.body,
              authorType: issueComments.authorType,
              authorAgentId: issueComments.authorAgentId,
              authorUserId: issueComments.authorUserId,
              presentation: issueComments.presentation,
              metadata: issueComments.metadata,
            })
            .from(issueComments)
            .where(and(
              eq(issueComments.id, wakeCommentId),
              eq(issueComments.issueId, issueContext.id),
              eq(issueComments.companyId, agent.companyId),
            ))
            .then((rows) => rows[0] ?? null)
        : null;
    const issueAssigneeOverrides =
      issueContext && issueContext.assigneeAgentId === agent.id
        ? parseIssueAssigneeAdapterOverrides(
            issueContext.assigneeAdapterOverrides,
          )
        : null;
    const isolatedWorkspacesEnabled = (await instanceSettings.getExperimental()).enableIsolatedWorkspaces;
    const issueExecutionWorkspaceSettings = isolatedWorkspacesEnabled
      ? parseIssueExecutionWorkspaceSettings(issueContext?.executionWorkspaceSettings)
      : null;
    const contextProjectId = readNonEmptyString(context.projectId);
    const executionProjectId = issueContext?.projectId ?? contextProjectId;
    const projectContext = executionProjectId
      ? await db
          .select({
            id: projects.id,
            executionWorkspacePolicy: projects.executionWorkspacePolicy,
            env: projects.env,
          })
          .from(projects)
          .where(and(eq(projects.id, executionProjectId), eq(projects.companyId, agent.companyId)))
          .then((rows) => rows[0] ?? null)
      : null;
    const projectExecutionWorkspacePolicy = gateProjectExecutionWorkspacePolicy(
      parseProjectExecutionWorkspacePolicy(projectContext?.executionWorkspacePolicy),
      isolatedWorkspacesEnabled,
    );
    const taskSession = taskKey
      ? await getTaskSession(agent.companyId, agent.id, agent.adapterType, taskKey)
      : null;
    const resetTaskSession = shouldResetTaskSessionForWake(context);
    const sessionResetReason = describeSessionResetReason(context);
    const taskSessionForRun = resetTaskSession ? null : taskSession;
    const explicitResumeSessionParams = normalizeSessionParams(
      sessionCodec.deserialize(parseObject(context.resumeSessionParams)),
    );
    const explicitResumeSessionDisplayId = truncateDisplayId(
      readNonEmptyString(context.resumeSessionDisplayId) ??
        (sessionCodec.getDisplayId ? sessionCodec.getDisplayId(explicitResumeSessionParams) : null) ??
        readNonEmptyString(explicitResumeSessionParams?.sessionId),
    );
    const previousSessionParams =
      explicitResumeSessionParams ??
      (explicitResumeSessionDisplayId ? { sessionId: explicitResumeSessionDisplayId } : null) ??
      normalizeSessionParams(sessionCodec.deserialize(taskSessionForRun?.sessionParamsJson ?? null));
    const config = parseObject(agent.adapterConfig);
    const requestedExecutionWorkspaceMode = resolveExecutionWorkspaceMode({
      projectPolicy: projectExecutionWorkspacePolicy,
      issueSettings: issueExecutionWorkspaceSettings,
      legacyUseProjectWorkspace: issueAssigneeOverrides?.useProjectWorkspace ?? null,
    });
    const resolvedWorkspace = await resolveWorkspaceForRun(
      agent,
      context,
      previousSessionParams,
      { useProjectWorkspace: requestedExecutionWorkspaceMode !== "agent_default" },
    );
    const issueRef = issueContext
      ? {
          id: issueContext.id,
          identifier: issueContext.identifier,
          title: issueContext.title,
          status: issueContext.status,
          priority: issueContext.priority,
          workMode: issueContext.workMode,
          description: issueContext.description,
          projectId: issueContext.projectId,
          projectWorkspaceId: issueContext.projectWorkspaceId,
          executionWorkspaceId: issueContext.executionWorkspaceId,
          executionWorkspacePreference: issueContext.executionWorkspacePreference,
          assigneeAgentId: issueContext.assigneeAgentId,
        }
      : null;
    const continuationSummary = issueRef
      ? await getIssueContinuationSummaryDocument(db, issueRef.id)
      : null;
    if (continuationSummary) {
      context.paperclipContinuationSummary = {
        key: continuationSummary.key,
        title: continuationSummary.title,
        body: continuationSummary.body,
        updatedAt: continuationSummary.updatedAt.toISOString(),
      };
    } else {
      delete context.paperclipContinuationSummary;
    }
    const paperclipWakePayload = await buildPaperclipWakePayload({
      db,
      companyId: agent.companyId,
      agent,
      contextSnapshot: context,
      continuationSummary,
      issueSummary: issueRef
        ? {
            id: issueRef.id,
            identifier: issueRef.identifier,
            title: issueRef.title,
            status: issueRef.status,
            priority: issueRef.priority,
            workMode: issueRef.workMode,
            assigneeAgentId: issueRef.assigneeAgentId,
          }
        : null,
    });
    if (paperclipWakePayload) {
      context[PAPERCLIP_WAKE_PAYLOAD_KEY] = paperclipWakePayload;
    } else {
      delete context[PAPERCLIP_WAKE_PAYLOAD_KEY];
    }
    const taskMarkdown = buildPaperclipTaskMarkdown({
      issue: issueRef
        ? {
            id: issueRef.id,
            identifier: issueRef.identifier,
            title: issueRef.title,
            workMode: issueRef.workMode,
            description: issueRef.description,
          }
        : null,
      wakeComment: wakeCommentContext,
      interaction: {
        id: readNonEmptyString(context.interactionId),
        kind: readNonEmptyString(context.interactionKind),
        status: readNonEmptyString(context.interactionStatus),
      },
      meeting: {
        id: readNonEmptyString(context.meetingId),
        status: readNonEmptyString(context.interactionStatus),
        chairAgentId: readNonEmptyString(context.chairAgentId),
      },
      currentAgentId: agent.id,
    });
    if (issueRef) {
      context.paperclipIssue = {
        id: issueRef.id,
        identifier: issueRef.identifier,
        title: issueRef.title,
        description: issueRef.description,
        workMode: issueRef.workMode,
      };

      const executionEnvironment: Record<string, string> = {};
      const wakeTaskId = readNonEmptyString(context.taskId) ?? issueRef.id;
      if (wakeTaskId) executionEnvironment.PAPERCLIP_TASK_ID = wakeTaskId;
      const wakeReason = readNonEmptyString(context.wakeReason);
      if (wakeReason) executionEnvironment.PAPERCLIP_WAKE_REASON = wakeReason;
      const wakeCommentId = readNonEmptyString(context.wakeCommentId) ?? readNonEmptyString(context.commentId);
      if (wakeCommentId) executionEnvironment.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
      executionEnvironment.PAPERCLIP_ISSUE_ID = issueRef.id;
      executionEnvironment.PAPERCLIP_ISSUE_IDENTIFIER = issueRef.identifier ?? issueRef.id;
      executionEnvironment.PAPERCLIP_ISSUE_TITLE = issueRef.title;

      context.executionMetadata = {
        paperclipIssue: {
          id: issueRef.id,
          identifier: issueRef.identifier,
          title: issueRef.title,
          description: issueRef.description,
        },
        environment: executionEnvironment,
      };
    } else {
      delete context.paperclipIssue;
      delete context.executionMetadata;
    }
    if (wakeCommentContext) {
      context.paperclipWakeComment = wakeCommentContext;
    } else {
      delete context.paperclipWakeComment;
    }
    if (taskMarkdown) {
      context.paperclipTaskMarkdown = taskMarkdown;
    } else {
      delete context.paperclipTaskMarkdown;
    }
    const existingExecutionWorkspace =
      issueRef?.executionWorkspaceId ? await executionWorkspacesSvc.getById(issueRef.executionWorkspaceId) : null;
    const shouldReuseExisting =
      issueRef?.executionWorkspacePreference === "reuse_existing" &&
      existingExecutionWorkspace !== null &&
      existingExecutionWorkspace.status !== "archived";
    const reusableExecutionWorkspaceConfig = shouldReuseExisting
      ? existingExecutionWorkspace?.config ?? null
      : null;
    const persistedExecutionWorkspaceMode = shouldReuseExisting && existingExecutionWorkspace
      ? issueExecutionWorkspaceModeForPersistedWorkspace(existingExecutionWorkspace.mode)
      : null;
    const effectiveExecutionWorkspaceMode: ReturnType<typeof resolveExecutionWorkspaceMode> =
      persistedExecutionWorkspaceMode === "isolated_workspace" ||
      persistedExecutionWorkspaceMode === "operator_branch" ||
      persistedExecutionWorkspaceMode === "agent_default"
        ? persistedExecutionWorkspaceMode
        : requestedExecutionWorkspaceMode;
    const defaultEnvironment = await environmentsSvc.ensureLocalEnvironment(agent.companyId);
    const selectedEnvironmentId = resolveExecutionWorkspaceEnvironmentId({
      projectPolicy: projectExecutionWorkspacePolicy,
      issueSettings: issueExecutionWorkspaceSettings,
      workspaceConfig: reusableExecutionWorkspaceConfig,
      agentDefaultEnvironmentId: agent.defaultEnvironmentId,
      defaultEnvironmentId: defaultEnvironment.id,
    });
    const workspaceManagedConfig = shouldReuseExisting
      ? { ...config }
      : buildExecutionWorkspaceAdapterConfig({
          agentConfig: config,
          projectPolicy: projectExecutionWorkspacePolicy,
          issueSettings: issueExecutionWorkspaceSettings,
          mode: requestedExecutionWorkspaceMode,
          legacyUseProjectWorkspace: issueAssigneeOverrides?.useProjectWorkspace ?? null,
        });
    const persistedWorkspaceManagedConfig = applyPersistedExecutionWorkspaceConfig({
      config: workspaceManagedConfig,
      workspaceConfig: reusableExecutionWorkspaceConfig,
      mode: effectiveExecutionWorkspaceMode,
    });
    let adapterModelProfiles: AdapterModelProfileDefinition[] = [];
    let profileResolutionFallbackReason: string | null = null;
    try {
      adapterModelProfiles = await listAdapterModelProfiles(agent.adapterType);
    } catch (error) {
      profileResolutionFallbackReason = "adapter_profile_resolution_failed";
      logger.warn(
        {
          err: error,
          companyId: agent.companyId,
          agentId: agent.id,
          adapterType: agent.adapterType,
          runId: run.id,
        },
        "Failed to resolve adapter model profiles; falling back to primary adapter config",
      );
    }
    const modelProfileApplication = resolveModelProfileApplication({
      adapterModelProfiles,
      agentRuntimeConfig: agent.runtimeConfig,
      issueModelProfile: issueAssigneeOverrides?.modelProfile ?? null,
      contextSnapshot: context,
      profileResolutionFallbackReason,
    });
    consumeWakeContextModelProfile(context, modelProfileApplication.requestedBy);
    const modelProfileMetadata = modelProfileRunMetadata(modelProfileApplication);
    if (modelProfileMetadata) {
      context.paperclipModelProfile = modelProfileMetadata;
    } else {
      delete context.paperclipModelProfile;
    }
    const mergedConfig = mergeModelProfileAdapterConfig({
      baseConfig: persistedWorkspaceManagedConfig,
      modelProfile: modelProfileApplication,
      issueAdapterConfig: issueAssigneeOverrides?.adapterConfig ?? null,
    });
    const effectiveAdapterType = modelProfileApplication.adapterType ?? agent.adapterType;
    const configSnapshot = buildExecutionWorkspaceConfigSnapshot(mergedConfig, selectedEnvironmentId);
    const executionRunConfig = stripWorkspaceRuntimeFromExecutionRunConfig(mergedConfig);
    const { resolvedConfig, secretKeys, secretManifest } = await resolveExecutionRunAdapterConfig({
      companyId: agent.companyId,
      agentId: agent.id,
      issueId,
      heartbeatRunId: run.id,
      projectId: projectContext?.id ?? null,
      executionRunConfig,
      projectEnv: projectContext?.env ?? null,
      secretsSvc,
    });
    if (secretManifest.length > 0) {
      context.paperclipSecrets = {
        manifest: secretManifest,
      };
    } else {
      delete context.paperclipSecrets;
    }
    const runScopedMentionedSkillKeys = await resolveRunScopedMentionedSkillKeys({
      db,
      companyId: agent.companyId,
      issueId,
    });
    const effectiveResolvedConfig = applyRunScopedMentionedSkillKeys(
      resolvedConfig,
      runScopedMentionedSkillKeys,
    );
    const runtimeSkillEntries = await companySkills.listRuntimeSkillEntries(agent.companyId, {
      // Heartbeats are on the critical path for agent startup. Materializing
      // missing remote skill files here can block runs before a log/PID exists.
      materializeMissing: false,
    });
    let runtimeConfig = {
      ...effectiveResolvedConfig,
      paperclipRuntimeSkills: runtimeSkillEntries,
    };
    const preHookOutcome = await lifecycleHooks.firePre("run.before", {
      db,
      agent,
      run,
      runtimeConfig,
      contextSnapshot: context,
    });
    if (preHookOutcome.abort) {
      await setRunStatus(run.id, "cancelled", {
        finishedAt: new Date(),
        error: preHookOutcome.abort.reason,
        errorCode: "lifecycle_pre_hook_aborted",
      });
      return;
    }
    const workspaceOperationRecorder = workspaceOperationsSvc.createRecorder({
      companyId: agent.companyId,
      heartbeatRunId: run.id,
      executionWorkspaceId: existingExecutionWorkspace?.id ?? null,
    });
    const executionWorkspaceBase = {
      baseCwd: resolvedWorkspace.cwd,
      source: resolvedWorkspace.source,
      projectId: resolvedWorkspace.projectId,
      workspaceId: resolvedWorkspace.workspaceId,
      repoUrl: resolvedWorkspace.repoUrl,
      repoRef: resolvedWorkspace.repoRef,
    } satisfies ExecutionWorkspaceInput;
    const reusedExecutionWorkspace = shouldReuseExisting && existingExecutionWorkspace
      ? buildRealizedExecutionWorkspaceFromPersisted({
          base: executionWorkspaceBase,
          workspace: existingExecutionWorkspace,
        })
      : null;
    const executionWorkspace = reusedExecutionWorkspace ?? await realizeExecutionWorkspace({
          base: executionWorkspaceBase,
          config: runtimeConfig,
          issue: issueRef,
          agent: {
            id: agent.id,
            name: agent.name,
            companyId: agent.companyId,
          },
          recorder: workspaceOperationRecorder,
        });
    const resolvedProjectId = executionWorkspace.projectId ?? issueRef?.projectId ?? executionProjectId ?? null;
    const resolvedProjectWorkspaceId = issueRef?.projectWorkspaceId ?? resolvedWorkspace.workspaceId ?? null;
    let persistedExecutionWorkspace = null;
    const nextExecutionWorkspaceMetadata = mergeExecutionWorkspaceMetadataForPersistence({
      existingMetadata: existingExecutionWorkspace?.metadata ?? null,
      source: executionWorkspace.source,
      createdByRuntime: executionWorkspace.created,
      configSnapshot,
      shouldReuseExisting,
    });
    try {
      persistedExecutionWorkspace = shouldReuseExisting && existingExecutionWorkspace
        ? await executionWorkspacesSvc.update(existingExecutionWorkspace.id, {
            cwd: executionWorkspace.cwd,
            repoUrl: executionWorkspace.repoUrl,
            baseRef: executionWorkspace.repoRef,
            branchName: executionWorkspace.branchName,
            providerType: executionWorkspace.strategy === "git_worktree" ? "git_worktree" : "local_fs",
            providerRef: executionWorkspace.worktreePath,
            status: "active",
            lastUsedAt: new Date(),
            metadata: nextExecutionWorkspaceMetadata,
          })
        : resolvedProjectId
          ? await executionWorkspacesSvc.create({
              companyId: agent.companyId,
              projectId: resolvedProjectId,
              projectWorkspaceId: resolvedProjectWorkspaceId,
              sourceIssueId: issueRef?.id ?? null,
              mode:
                requestedExecutionWorkspaceMode === "isolated_workspace"
                  ? "isolated_workspace"
                  : requestedExecutionWorkspaceMode === "operator_branch"
                    ? "operator_branch"
                    : requestedExecutionWorkspaceMode === "agent_default"
                      ? "adapter_managed"
                      : "shared_workspace",
              strategyType: executionWorkspace.strategy === "git_worktree" ? "git_worktree" : "project_primary",
              name: executionWorkspace.branchName ?? issueRef?.identifier ?? `workspace-${agent.id.slice(0, 8)}`,
              status: "active",
              cwd: executionWorkspace.cwd,
              repoUrl: executionWorkspace.repoUrl,
              baseRef: executionWorkspace.repoRef,
              branchName: executionWorkspace.branchName,
              providerType: executionWorkspace.strategy === "git_worktree" ? "git_worktree" : "local_fs",
              providerRef: executionWorkspace.worktreePath,
              lastUsedAt: new Date(),
              openedAt: new Date(),
              metadata: nextExecutionWorkspaceMetadata,
            })
          : null;
    } catch (error) {
      if (executionWorkspace.created) {
        try {
          await cleanupExecutionWorkspaceArtifacts({
            workspace: {
              id: existingExecutionWorkspace?.id ?? `transient-${run.id}`,
              cwd: executionWorkspace.cwd,
              providerType: executionWorkspace.strategy === "git_worktree" ? "git_worktree" : "local_fs",
              providerRef: executionWorkspace.worktreePath,
              branchName: executionWorkspace.branchName,
              repoUrl: executionWorkspace.repoUrl,
              baseRef: executionWorkspace.repoRef,
              projectId: resolvedProjectId,
              projectWorkspaceId: resolvedProjectWorkspaceId,
              sourceIssueId: issueRef?.id ?? null,
              metadata: {
                createdByRuntime: true,
                source: executionWorkspace.source,
              },
            },
            projectWorkspace: {
              cwd: resolvedWorkspace.cwd,
              cleanupCommand: null,
            },
            cleanupCommand: configSnapshot?.cleanupCommand ?? null,
            teardownCommand: configSnapshot?.teardownCommand ?? projectExecutionWorkspacePolicy?.workspaceStrategy?.teardownCommand ?? null,
            recorder: workspaceOperationRecorder,
          });
        } catch (cleanupError) {
          logger.warn(
            {
              runId: run.id,
              issueId,
              executionWorkspaceCwd: executionWorkspace.cwd,
              cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            },
            "Failed to cleanup realized execution workspace after persistence failure",
          );
        }
      }
      throw error;
    }
    await workspaceOperationRecorder.attachExecutionWorkspaceId(persistedExecutionWorkspace?.id ?? null);
    if (
      existingExecutionWorkspace &&
      persistedExecutionWorkspace &&
      existingExecutionWorkspace.id !== persistedExecutionWorkspace.id &&
      existingExecutionWorkspace.status === "active"
    ) {
      await executionWorkspacesSvc.update(existingExecutionWorkspace.id, {
        status: "idle",
        cleanupReason: null,
      });
    }
    if (issueId && persistedExecutionWorkspace) {
      const nextIssueWorkspaceMode = issueExecutionWorkspaceModeForPersistedWorkspace(persistedExecutionWorkspace.mode);
      const shouldSwitchIssueToExistingWorkspace =
        issueRef?.executionWorkspacePreference === "reuse_existing" ||
        requestedExecutionWorkspaceMode === "isolated_workspace" ||
        requestedExecutionWorkspaceMode === "operator_branch";
      const nextIssuePatch: Record<string, unknown> = {};
      if (issueRef?.executionWorkspaceId !== persistedExecutionWorkspace.id) {
        nextIssuePatch.executionWorkspaceId = persistedExecutionWorkspace.id;
      }
      if (resolvedProjectWorkspaceId && issueRef?.projectWorkspaceId !== resolvedProjectWorkspaceId) {
        nextIssuePatch.projectWorkspaceId = resolvedProjectWorkspaceId;
      }
      if (shouldSwitchIssueToExistingWorkspace) {
        nextIssuePatch.executionWorkspacePreference = "reuse_existing";
        nextIssuePatch.executionWorkspaceSettings = {
          ...(issueExecutionWorkspaceSettings ?? {}),
          mode: nextIssueWorkspaceMode,
        };
      }
      if (Object.keys(nextIssuePatch).length > 0) {
        await issuesSvc.update(issueId, nextIssuePatch);
      }
    }
    if (persistedExecutionWorkspace) {
      context.executionWorkspaceId = persistedExecutionWorkspace.id;
      await db
        .update(heartbeatRuns)
        .set({
          contextSnapshot: context,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, run.id));
    }
    const persistedEnvironmentId = persistedExecutionWorkspace?.config?.environmentId ?? selectedEnvironmentId;
    const acquiredEnvironment = await envOrchestrator.acquireForRun({
      companyId: agent.companyId,
      selectedEnvironmentId: persistedEnvironmentId,
      defaultEnvironmentId: defaultEnvironment.id,
      adapterType: agent.adapterType,
      issueId: issueId ?? null,
      heartbeatRunId: run.id,
      agentId: agent.id,
      persistedExecutionWorkspace,
    });
    const selectedEnvironment = acquiredEnvironment.environment;
    let activeEnvironmentLease = {
      environment: acquiredEnvironment.environment,
      lease: acquiredEnvironment.lease,
      leaseContext: acquiredEnvironment.leaseContext,
    };
    const realizationResult = await envOrchestrator.realizeForRun({
      environment: selectedEnvironment,
      lease: activeEnvironmentLease.lease,
      adapterType: agent.adapterType,
      companyId: agent.companyId,
      issueId: issueId ?? null,
      heartbeatRunId: run.id,
      executionWorkspace,
      effectiveExecutionWorkspaceMode,
      persistedExecutionWorkspace,
    });
    activeEnvironmentLease = {
      ...activeEnvironmentLease,
      lease: realizationResult.lease,
    };
    persistedExecutionWorkspace = realizationResult.persistedExecutionWorkspace;
    const workspaceRealization = realizationResult.workspaceRealization;
    const executionTarget = realizationResult.executionTarget;
    const remoteExecution = realizationResult.remoteExecution;
    context.paperclipEnvironment = {
      id: selectedEnvironment.id,
      name: selectedEnvironment.name,
      driver: selectedEnvironment.driver,
      leaseId: activeEnvironmentLease.lease.id,
      workspaceRealization,
      ...(typeof activeEnvironmentLease.lease.metadata?.remoteCwd === "string"
        ? {
            remoteCwd: activeEnvironmentLease.lease.metadata.remoteCwd,
            host:
              typeof activeEnvironmentLease.lease.metadata?.host === "string"
                ? activeEnvironmentLease.lease.metadata.host
                : undefined,
            port:
              typeof activeEnvironmentLease.lease.metadata?.port === "number"
                ? activeEnvironmentLease.lease.metadata.port
                : undefined,
            username:
              typeof activeEnvironmentLease.lease.metadata?.username === "string"
                ? activeEnvironmentLease.lease.metadata.username
                : undefined,
          }
        : {}),
    };
    await db
      .update(heartbeatRuns)
      .set({
        contextSnapshot: context,
        updatedAt: new Date(),
      })
      .where(eq(heartbeatRuns.id, run.id));
    const runtimeSessionResolution = resolveRuntimeSessionParamsForWorkspace({
      agentId: agent.id,
      previousSessionParams,
      resolvedWorkspace: {
        ...resolvedWorkspace,
        cwd: executionWorkspace.cwd,
      },
    });
    const runtimeSessionParams = runtimeSessionResolution.sessionParams;
    const runtimeWorkspaceWarnings = [
      ...resolvedWorkspace.warnings,
      ...executionWorkspace.warnings,
      ...(runtimeSessionResolution.warning ? [runtimeSessionResolution.warning] : []),
      ...(resetTaskSession && sessionResetReason
        ? [
            taskKey
              ? `Skipping saved session resume for task "${taskKey}" because ${sessionResetReason}.`
              : `Skipping saved session resume because ${sessionResetReason}.`,
          ]
        : []),
    ];
    context.paperclipWorkspace = {
      cwd: executionWorkspace.cwd,
      source: executionWorkspace.source,
      mode: effectiveExecutionWorkspaceMode,
      strategy: executionWorkspace.strategy,
      projectId: executionWorkspace.projectId,
      workspaceId: executionWorkspace.workspaceId,
      repoUrl: executionWorkspace.repoUrl,
      repoRef: executionWorkspace.repoRef,
      branchName: executionWorkspace.branchName,
      worktreePath: executionWorkspace.worktreePath,
      realization: workspaceRealization,
      agentHome: await (async () => {
        const home = resolveDefaultAgentWorkspaceDir(agent.id);
        await fs.mkdir(home, { recursive: true });
        return home;
      })(),
    };
    context.paperclipWorkspaces = resolvedWorkspace.workspaceHints;
    const runtimeServiceIntents = (() => {
      const runtimeConfig = parseObject(resolvedConfig.workspaceRuntime);
      return Array.isArray(runtimeConfig.services)
        ? runtimeConfig.services.filter(
            (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
          )
        : [];
    })();
    if (runtimeServiceIntents.length > 0) {
      context.paperclipRuntimeServiceIntents = runtimeServiceIntents;
    } else {
      delete context.paperclipRuntimeServiceIntents;
    }
    if (executionWorkspace.projectId && !readNonEmptyString(context.projectId)) {
      context.projectId = executionWorkspace.projectId;
    }
    const runtimeSessionFallback = taskKey || resetTaskSession ? null : runtime.sessionId;
    let previousSessionDisplayId = truncateDisplayId(
      explicitResumeSessionDisplayId ??
        taskSessionForRun?.sessionDisplayId ??
        (sessionCodec.getDisplayId ? sessionCodec.getDisplayId(runtimeSessionParams) : null) ??
        readNonEmptyString(runtimeSessionParams?.sessionId) ??
        runtimeSessionFallback,
    );
    let runtimeSessionIdForAdapter =
      readNonEmptyString(runtimeSessionParams?.sessionId) ?? runtimeSessionFallback;
    let runtimeSessionParamsForAdapter = runtimeSessionParams;

    const sessionCompaction = await evaluateSessionCompaction({
      agent,
      sessionId: previousSessionDisplayId ?? runtimeSessionIdForAdapter,
      issueId,
      continuationSummaryBody: continuationSummary?.body ?? null,
    });
    if (sessionCompaction.rotate) {
      context.paperclipSessionHandoffMarkdown = sessionCompaction.handoffMarkdown;
      context.paperclipSessionRotationReason = sessionCompaction.reason;
      context.paperclipPreviousSessionId = previousSessionDisplayId ?? runtimeSessionIdForAdapter;
      runtimeSessionIdForAdapter = null;
      runtimeSessionParamsForAdapter = null;
      previousSessionDisplayId = null;
      if (sessionCompaction.reason) {
        runtimeWorkspaceWarnings.push(
          `Starting a fresh session because ${sessionCompaction.reason}.`,
        );
      }
    } else {
      delete context.paperclipSessionHandoffMarkdown;
      delete context.paperclipSessionRotationReason;
      delete context.paperclipPreviousSessionId;
    }

    const runtimeForAdapter = {
      sessionId: runtimeSessionIdForAdapter,
      sessionParams: runtimeSessionParamsForAdapter,
      sessionDisplayId: previousSessionDisplayId,
      taskKey,
    };

    let seq = 1;
    let handle: RunLogHandle | null = null;
    let stdoutExcerpt = "";
    let stderrExcerpt = "";
    let outputSeq = Number(run.lastOutputSeq ?? 0);
    let lastOutputFlushAt: Date | null = run.lastOutputAt ?? null;
    const outputProgressState: {
      pending: {
      at: Date;
      seq: number;
      stream: "stdout" | "stderr";
      bytes: number;
      } | null;
    } = { pending: null };
    let persistedLogBytes = Number(run.logBytes ?? 0);
    const flushOutputProgress = async (opts?: { force?: boolean }) => {
      const pendingOutputProgress = outputProgressState.pending;
      if (!pendingOutputProgress) return;
      const shouldFlush =
        opts?.force === true ||
        !lastOutputFlushAt ||
        pendingOutputProgress.at.getTime() - lastOutputFlushAt.getTime() >= ACTIVE_RUN_OUTPUT_PROGRESS_FLUSH_INTERVAL_MS;
      if (!shouldFlush) return;
      await db
        .update(heartbeatRuns)
        .set({
          lastOutputAt: pendingOutputProgress.at,
          lastOutputSeq: pendingOutputProgress.seq,
          lastOutputStream: pendingOutputProgress.stream,
          lastOutputBytes: pendingOutputProgress.bytes,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, run.id));
      lastOutputFlushAt = pendingOutputProgress.at;
      outputProgressState.pending = null;
    };
    try {
      const startedAt = run.startedAt ?? new Date();
      const runningWithSession = await db
        .update(heartbeatRuns)
        .set({
          startedAt,
          sessionIdBefore: runtimeForAdapter.sessionDisplayId ?? runtimeForAdapter.sessionId,
          contextSnapshot: context,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, run.id))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (runningWithSession) run = runningWithSession;

      const runningAgent = await db
        .update(agents)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(agents.id, agent.id))
        .returning()
        .then((rows) => rows[0] ?? null);

      if (runningAgent) {
        publishLiveEvent({
          companyId: runningAgent.companyId,
          type: "agent.status",
          payload: {
            agentId: runningAgent.id,
            status: runningAgent.status,
            outcome: "running",
          },
        });
      }

      const currentRun = run;
      await appendRunEvent(currentRun, seq++, {
        eventType: "lifecycle",
        stream: "system",
        level: "info",
        message: "run started",
      });

      handle = await runLogStore.begin({
        companyId: run.companyId,
        agentId: run.agentId,
        runId,
      });

      await db
        .update(heartbeatRuns)
        .set({
          logStore: handle.store,
          logRef: handle.logRef,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, runId));

      const currentUserRedactionOptions = await getCurrentUserRedactionOptions();
      const onLog = async (stream: "stdout" | "stderr", chunk: string) => {
        const sanitizedChunk = compactRunLogChunk(
          redactCurrentUserText(chunk, currentUserRedactionOptions),
        );
        if (stream === "stdout") stdoutExcerpt = appendExcerpt(stdoutExcerpt, sanitizedChunk);
        if (stream === "stderr") stderrExcerpt = appendExcerpt(stderrExcerpt, sanitizedChunk);
        const ts = new Date().toISOString();

        let appendedBytes = 0;
        if (handle) {
          appendedBytes = await runLogStore.append(handle, {
            stream,
            chunk: sanitizedChunk,
            ts,
          });
          persistedLogBytes += appendedBytes;
        }
        outputSeq += 1;
        outputProgressState.pending = {
          at: new Date(ts),
          seq: outputSeq,
          stream,
          bytes: persistedLogBytes,
        };
        await flushOutputProgress();

        const payloadChunk =
          sanitizedChunk.length > MAX_LIVE_LOG_CHUNK_BYTES
            ? sanitizedChunk.slice(sanitizedChunk.length - MAX_LIVE_LOG_CHUNK_BYTES)
            : sanitizedChunk;

        publishLiveEvent({
          companyId: run.companyId,
          type: "heartbeat.run.log",
          payload: {
            runId: run.id,
            agentId: run.agentId,
            ts,
            stream,
            chunk: payloadChunk,
            truncated: payloadChunk.length !== sanitizedChunk.length,
          },
        });
      };
      if (runScopedMentionedSkillKeys.length > 0) {
        await onLog(
          "stdout",
          `[paperclip] Enabled run-scoped skills from issue mentions: ${runScopedMentionedSkillKeys.join(", ")}\n`,
        );
      }
      for (const warning of runtimeWorkspaceWarnings) {
        const logEntry = formatRuntimeWorkspaceWarningLog(warning);
        await onLog(logEntry.stream, logEntry.chunk);
      }
      const adapterEnv = Object.fromEntries(
        Object.entries(parseObject(resolvedConfig.env)).filter(
          (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string",
        ),
      );
      const runtimeServices = await ensureRuntimeServicesForRun({
        db,
        runId: run.id,
        agent: {
          id: agent.id,
          name: agent.name,
          companyId: agent.companyId,
        },
        issue: issueRef,
        workspace: executionWorkspace,
        executionWorkspaceId: persistedExecutionWorkspace?.id ?? issueRef?.executionWorkspaceId ?? null,
        config: effectiveResolvedConfig,
        adapterEnv,
        onLog,
      });
      if (runtimeServices.length > 0) {
        context.paperclipRuntimeServices = runtimeServices;
        context.paperclipRuntimePrimaryUrl =
          runtimeServices.find((service) => readNonEmptyString(service.url))?.url ?? null;
        await db
          .update(heartbeatRuns)
          .set({
            contextSnapshot: context,
            updatedAt: new Date(),
          })
          .where(eq(heartbeatRuns.id, run.id));
      }
      if (issueId && (executionWorkspace.created || runtimeServices.some((service) => !service.reused))) {
        try {
          await issuesSvc.addComment(
            issueId,
            buildWorkspaceReadyComment({
              workspace: executionWorkspace,
              runtimeServices,
            }),
            { agentId: agent.id, runId: run.id },
          );
        } catch (err) {
          await onLog(
            "stderr",
            `[paperclip] Failed to post workspace-ready comment: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
      const onAdapterMeta = async (meta: AdapterInvocationMeta) => {
        if (meta.env && secretKeys.size > 0) {
          for (const key of secretKeys) {
            if (key in meta.env) meta.env[key] = "***REDACTED***";
          }
        }
        const modelProfileMetadata = modelProfileRunMetadata(modelProfileApplication);
        await appendRunEvent(currentRun, seq++, {
          eventType: "adapter.invoke",
          stream: "system",
          level: "info",
          message: "adapter invocation",
          payload: {
            ...(meta as unknown as Record<string, unknown>),
            ...(modelProfileMetadata ? { modelProfile: modelProfileMetadata } : {}),
          },
        });
      };

      const adapter = getServerAdapter(effectiveAdapterType);
      const adapterAgent = {
        ...agent,
        adapterType: effectiveAdapterType,
        adapterConfig: mergedConfig,
      };
      const authToken = adapter.supportsLocalAgentJwt
        ? createLocalAgentJwt(agent.id, agent.companyId, effectiveAdapterType, run.id)
        : null;
      if (adapter.supportsLocalAgentJwt && !authToken) {
        logger.warn(
          {
            companyId: agent.companyId,
            agentId: agent.id,
            runId: run.id,
            adapterType: effectiveAdapterType,
          },
          "local agent jwt secret missing or invalid; running without injected PAPERCLIP_API_KEY",
        );
      }
      if (!run.processStartedAt) {
        const processStartedRun = await db
          .update(heartbeatRuns)
          .set({
            processStartedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(heartbeatRuns.id, run.id), isNull(heartbeatRuns.processStartedAt)))
          .returning()
          .then((rows) => rows[0] ?? null);
        if (processStartedRun) run = processStartedRun;
      }
      const latestBeforeAdapterInvoke = await getRun(run.id);
      if (latestBeforeAdapterInvoke && isHeartbeatRunTerminalStatus(latestBeforeAdapterInvoke.status)) {
        await appendRunEvent(latestBeforeAdapterInvoke, seq++, {
          eventType: "lifecycle",
          stream: "system",
          level: "warn",
          message: "adapter invocation skipped because the run was already terminal",
        });
        return;
      }
      const adapterResult = await adapter.execute({
        runId: run.id,
        agent: adapterAgent,
        runtime: runtimeForAdapter,
        config: runtimeConfig,
        context,
        runtimeCommandSpec: adapter.getRuntimeCommandSpec?.(runtimeConfig) ?? null,
        executionTarget,
        executionTransport: remoteExecution
          ? { remoteExecution: remoteExecution as unknown as Record<string, unknown> }
          : undefined,
        onLog,
        onMeta: onAdapterMeta,
        onSpawn: async (meta) => {
          await persistRunProcessMetadata(run.id, {
            pid: meta.pid,
            processGroupId:
              "processGroupId" in meta && typeof meta.processGroupId === "number"
                ? meta.processGroupId
                : null,
            startedAt: meta.startedAt,
          });
        },
        authToken: authToken ?? undefined,
      });
      const latestAfterAdapterInvoke = await getRun(run.id);
      if (latestAfterAdapterInvoke && isHeartbeatRunTerminalStatus(latestAfterAdapterInvoke.status)) {
        await appendRunEvent(latestAfterAdapterInvoke, seq++, {
          eventType: "lifecycle",
          stream: "system",
          level: "warn",
          message: "adapter result ignored because the run was already terminal",
        });
        return;
      }
      const skillActivations = normalizeAdapterSkillActivations(adapterResult.skillActivations, runtimeSkillEntries);
      if (skillActivations.length > 0) {
        await db.insert(heartbeatRunSkillEvents).values(
          skillActivations.map((activation) => ({
            companyId: run.companyId,
            runId: run.id,
            agentId: run.agentId,
            skillKey: activation.skillKey,
            skillName: activation.skillName,
            source: activation.source,
            activatedAt: activation.activatedAt,
          })),
        );
      }
      const adapterManagedRuntimeServices = adapterResult.runtimeServices
        ? await persistAdapterManagedRuntimeServices({
            db,
            adapterType: agent.adapterType,
            runId: run.id,
            agent: {
              id: agent.id,
              name: agent.name,
              companyId: agent.companyId,
            },
            issue: issueRef,
            workspace: executionWorkspace,
            reports: adapterResult.runtimeServices,
          })
        : [];
      if (adapterManagedRuntimeServices.length > 0) {
        const combinedRuntimeServices = [
          ...runtimeServices,
          ...adapterManagedRuntimeServices,
        ];
        context.paperclipRuntimeServices = combinedRuntimeServices;
        context.paperclipRuntimePrimaryUrl =
          combinedRuntimeServices.find((service) => readNonEmptyString(service.url))?.url ?? null;
        await db
          .update(heartbeatRuns)
          .set({
            contextSnapshot: context,
            updatedAt: new Date(),
          })
          .where(eq(heartbeatRuns.id, run.id));
        if (issueId) {
          try {
            await issuesSvc.addComment(
              issueId,
              buildWorkspaceReadyComment({
                workspace: executionWorkspace,
                runtimeServices: adapterManagedRuntimeServices,
              }),
              { agentId: agent.id, runId: run.id },
            );
          } catch (err) {
            await onLog(
              "stderr",
              `[paperclip] Failed to post adapter-managed runtime comment: ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
        }
      }
      const nextSessionState = resolveNextSessionState({
        codec: sessionCodec,
        adapterResult,
        previousParams: previousSessionParams,
        previousDisplayId: runtimeForAdapter.sessionDisplayId,
        previousLegacySessionId: runtimeForAdapter.sessionId,
      });
      const rawUsage = normalizeUsageTotals(adapterResult.usage);
      const sessionUsageResolution = await resolveNormalizedUsageForSession({
        agentId: agent.id,
        runId: run.id,
        sessionId: nextSessionState.displayId ?? nextSessionState.legacySessionId,
        rawUsage,
      });
      const normalizedUsage = sessionUsageResolution.normalizedUsage;

      let outcome: "succeeded" | "failed" | "cancelled" | "timed_out";
      const latestRun = await getRun(run.id);
      if (isHeartbeatRunTerminalStatus(latestRun?.status)) {
        outcome = latestRun.status;
      } else if (adapterResult.timedOut) {
        outcome = "timed_out";
      } else if ((adapterResult.exitCode ?? 0) === 0 && !adapterResult.errorMessage) {
        outcome = "succeeded";
      } else {
        outcome = "failed";
      }
      const handoffCompletionDecision = outcome === "succeeded"
        ? await validateSuccessfulRunHandoffCompletion({ ...run, status: "succeeded" }, adapterResult.summary ?? null)
        : { kind: "not_applicable" as const, reason: "run did not succeed" };
      if (handoffCompletionDecision.kind === "reject") {
        outcome = "failed";
      }
      const runErrorMessage =
        outcome === "cancelled"
          ? (latestRun?.error ?? adapterResult.errorMessage ?? "Cancelled")
          : outcome === "succeeded"
            ? null
            : redactCurrentUserText(
                handoffCompletionDecision.kind === "reject"
                  ? handoffCompletionDecision.reason
                  : adapterResult.errorMessage ?? (outcome === "timed_out" ? "Timed out" : "Adapter failed"),
                currentUserRedactionOptions,
              );
      const runErrorCode =
        handoffCompletionDecision.kind === "reject"
          ? handoffCompletionDecision.errorCode
          :
        outcome === "timed_out"
          ? "timeout"
          : outcome === "cancelled"
            ? (latestRun?.errorCode ?? "cancelled")
            : outcome === "failed"
              ? (adapterResult.errorCode ?? "adapter_failed")
              : null;

      let logSummary: { bytes: number; sha256?: string; compressed: boolean } | null = null;
      if (handle) {
        logSummary = await runLogStore.finalize(handle);
      }
      const finalLogBytes = logSummary?.bytes;
      if (outputProgressState.pending && typeof finalLogBytes === "number") {
        outputProgressState.pending.bytes = finalLogBytes;
      }
      await flushOutputProgress({ force: true });

      const status =
        outcome === "succeeded"
          ? "succeeded"
          : outcome === "cancelled"
            ? "cancelled"
            : outcome === "timed_out"
              ? "timed_out"
              : "failed";

      const usageJson =
        normalizedUsage || adapterResult.costUsd != null
          ? ({
              ...(normalizedUsage ?? {}),
              ...(rawUsage ? {
                rawInputTokens: rawUsage.inputTokens,
                rawCachedInputTokens: rawUsage.cachedInputTokens,
                rawOutputTokens: rawUsage.outputTokens,
              } : {}),
              ...(sessionUsageResolution.derivedFromSessionTotals ? { usageSource: "session_delta" } : {}),
              ...((nextSessionState.displayId ?? nextSessionState.legacySessionId)
                ? { persistedSessionId: nextSessionState.displayId ?? nextSessionState.legacySessionId }
                : {}),
              sessionReused: runtimeForAdapter.sessionId != null || runtimeForAdapter.sessionDisplayId != null,
              taskSessionReused: taskSessionForRun != null,
              freshSession: runtimeForAdapter.sessionId == null && runtimeForAdapter.sessionDisplayId == null,
              sessionRotated: sessionCompaction.rotate,
              sessionRotationReason: sessionCompaction.reason,
              provider: readNonEmptyString(adapterResult.provider) ?? "unknown",
              biller: resolveLedgerBiller(adapterResult),
              model: readNonEmptyString(adapterResult.model) ?? "unknown",
              ...(adapterResult.costUsd != null ? { costUsd: adapterResult.costUsd } : {}),
              billingType: normalizeLedgerBillingType(adapterResult.billingType),
            } as Record<string, unknown>)
          : null;

      const persistedResultJson = mergeHeartbeatRunResultJson(
        mergeRunStopMetadataForAgent(agent, outcome, {
          resultJson: mergeModelProfileRunMetadata(
            mergeAdapterRecoveryMetadata({
              resultJson: adapterResult.resultJson ?? null,
              errorFamily: adapterResult.errorFamily ?? null,
              retryNotBefore: adapterResult.retryNotBefore ?? null,
            }),
            modelProfileApplication,
          ),
          errorCode: runErrorCode,
          errorMessage: runErrorMessage,
        }),
        adapterResult.summary ?? null,
      );

      let persistedRun = await setRunStatus(run.id, status, {
        finishedAt: new Date(),
        error: runErrorMessage,
        errorCode: runErrorCode,
        exitCode: adapterResult.exitCode,
        signal: adapterResult.signal,
        usageJson,
        resultJson: persistedResultJson,
        sessionIdAfter: nextSessionState.displayId ?? nextSessionState.legacySessionId,
        stdoutExcerpt,
        stderrExcerpt,
        logBytes: logSummary?.bytes,
        logSha256: logSummary?.sha256,
        logCompressed: logSummary?.compressed ?? false,
      });
      if (persistedRun) {
        persistedRun = await classifyAndPersistRunLiveness(persistedRun, persistedResultJson) ?? persistedRun;
      }

      await setWakeupStatus(run.wakeupRequestId, outcome === "succeeded" ? "completed" : status, {
        finishedAt: new Date(),
        error: runErrorMessage,
      });

      const finalizedRun = persistedRun ?? (await getRun(run.id));
      if (finalizedRun) {
        await appendRunEvent(finalizedRun, seq++, {
          eventType: "lifecycle",
          stream: "system",
          level: outcome === "succeeded" ? "info" : "error",
          message: `run ${outcome}`,
          payload: {
            status,
            exitCode: adapterResult.exitCode,
          },
        });
        if (
          outcome === "succeeded" &&
          handoffCompletionDecision.kind === "accept" &&
          handoffCompletionDecision.autoCompleteIssue &&
          issueId
        ) {
          try {
            const updatedIssue = await issuesSvc.update(issueId, { status: "done" });
            if (updatedIssue) {
              await issuesSvc.addComment(issueId, [
                "Paperclip marked this issue done because the corrective missing-disposition handoff recorded an explicit no-remaining-work disposition.",
                "",
                `- Corrective handoff run: \`${finalizedRun.id}\``,
                `- Reason: ${handoffCompletionDecision.reason}`,
                "",
                "Next action: none unless a fresh signal reopens the work.",
              ].join("\n"), { agentId: agent.id, runId: finalizedRun.id });
            }
          } catch (err) {
            await onLog(
              "stderr",
              `[paperclip] Failed to auto-complete no-remaining-work handoff issue: ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
        }
        const livenessRun = finalizedRun;
        await refreshContinuationSummaryForRun(livenessRun, agent);
        if (issueId && outcome === "succeeded") {
          try {
            const existingRunComment = await findRunIssueComment(livenessRun.id, livenessRun.companyId, issueId);
            if (!existingRunComment) {
              const issueComment = buildHeartbeatRunIssueComment(persistedResultJson);
              if (issueComment) {
                await issuesSvc.addComment(issueId, issueComment, { agentId: agent.id, runId: livenessRun.id });
              }
            }
          } catch (err) {
            await onLog(
              "stderr",
              `[paperclip] Failed to post run summary comment: ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
        }
        if (outcome === "failed" && isMaxTurnExhaustionRun(livenessRun)) {
          const policy = parseMaxTurnContinuationPolicy(agent);
          if (policy.enabled && policy.maxAttempts > 0) {
            await scheduleBoundedRetryForRun(livenessRun, agent, {
              retryReason: MAX_TURN_CONTINUATION_RETRY_REASON,
              wakeReason: MAX_TURN_CONTINUATION_WAKE_REASON,
              maxAttempts: policy.maxAttempts,
              delayMs: policy.delayMs,
            });
          } else {
            await appendRunEvent(livenessRun, await nextRunEventSeq(livenessRun.id), {
              eventType: "lifecycle",
              stream: "system",
              level: "warn",
              message: "Max-turn continuation suppressed because the policy is disabled",
              payload: {
                retryReason: MAX_TURN_CONTINUATION_RETRY_REASON,
                policy,
              },
            });
          }
        } else if (outcome === "failed" && readTransientRecoveryContractFromRun(livenessRun)) {
          await scheduleBoundedRetryForRun(livenessRun, agent);
        }
        const issueCommentPolicyResult = await finalizeIssueCommentPolicy(livenessRun, agent);
        await releaseIssueExecutionAndPromote(livenessRun);
        await handleRunLivenessContinuation(livenessRun);
        await handleSuccessfulRunHandoff(
          issueCommentPolicyResult.outcome === "retry_queued" || issueCommentPolicyResult.outcome === "retry_exhausted"
            ? {
              ...livenessRun,
              issueCommentStatus: issueCommentPolicyResult.outcome,
            }
            : livenessRun,
          agent,
        );
      }

      if (finalizedRun) {
        await updateRuntimeState(agent, finalizedRun, adapterResult, {
          legacySessionId: nextSessionState.legacySessionId,
        }, normalizedUsage);
        if (taskKey) {
          if (adapterResult.clearSession || (!nextSessionState.params && !nextSessionState.displayId)) {
            await clearTaskSessions(agent.companyId, agent.id, {
              taskKey,
              adapterType: agent.adapterType,
            });
          } else {
            await upsertTaskSession({
              companyId: agent.companyId,
              agentId: agent.id,
              adapterType: agent.adapterType,
              taskKey,
              sessionParamsJson: nextSessionState.params,
              sessionDisplayId: nextSessionState.displayId,
              lastRunId: finalizedRun.id,
              lastError: outcome === "succeeded" ? null : (adapterResult.errorMessage ?? "run_failed"),
            });
          }
        }
      }
      await finalizeAgentStatus(agent.id, outcome, runErrorCode);
    } catch (err) {
      const message = redactCurrentUserText(
        err instanceof Error ? err.message : "Unknown adapter failure",
        await getCurrentUserRedactionOptions(),
      );
      logger.error({ err, runId }, "heartbeat execution failed");

      let logSummary: { bytes: number; sha256?: string; compressed: boolean } | null = null;
      if (handle) {
        try {
          logSummary = await runLogStore.finalize(handle);
        } catch (finalizeErr) {
          logger.warn({ err: finalizeErr, runId }, "failed to finalize run log after error");
        }
      }
      const finalLogBytes = logSummary?.bytes;
      if (outputProgressState.pending && typeof finalLogBytes === "number") {
        outputProgressState.pending.bytes = finalLogBytes;
      }
      await flushOutputProgress({ force: true }).catch((flushErr) => {
        logger.warn({ err: flushErr, runId }, "failed to flush run output progress after error");
      });

      const failedRun = await setRunStatus(run.id, "failed", {
        error: message,
        errorCode: "adapter_failed",
        finishedAt: new Date(),
        resultJson: mergeRunStopMetadataForAgent(agent, "failed", {
          errorCode: "adapter_failed",
          errorMessage: message,
        }),
        stdoutExcerpt,
        stderrExcerpt,
        logBytes: logSummary?.bytes,
        logSha256: logSummary?.sha256,
        logCompressed: logSummary?.compressed ?? false,
      });
      await setWakeupStatus(run.wakeupRequestId, "failed", {
        finishedAt: new Date(),
        error: message,
      });

      if (failedRun) {
        await appendRunEvent(failedRun, seq++, {
          eventType: "error",
          stream: "system",
          level: "error",
          message,
        });
        const livenessRun = await classifyAndPersistRunLiveness(failedRun) ?? failedRun;
        await refreshContinuationSummaryForRun(livenessRun, agent);
        await finalizeIssueCommentPolicy(livenessRun, agent);
        await releaseIssueExecutionAndPromote(livenessRun);

        await updateRuntimeState(agent, livenessRun, {
          exitCode: null,
          signal: null,
          timedOut: false,
          errorMessage: message,
        }, {
          legacySessionId: runtimeForAdapter.sessionId,
        });

        if (taskKey && (previousSessionParams || previousSessionDisplayId || taskSession)) {
          await upsertTaskSession({
            companyId: agent.companyId,
            agentId: agent.id,
            adapterType: agent.adapterType,
            taskKey,
            sessionParamsJson: previousSessionParams,
            sessionDisplayId: previousSessionDisplayId,
            lastRunId: failedRun.id,
            lastError: message,
          });
        }
      }

      await finalizeAgentStatus(agent.id, "failed");
    }
    } catch (outerErr) {
          // Setup code before adapter.execute threw (e.g. ensureRuntimeState, resolveWorkspaceForRun).
          // The inner catch did not fire, so we must record the failure here.
          const message = outerErr instanceof Error ? outerErr.message : "Unknown setup failure";
          logger.error({ err: outerErr, runId }, "heartbeat execution setup failed");
          const setupFailureAgent = await getAgent(run.agentId).catch(() => null);
          await setRunStatus(runId, "failed", {
            error: message,
            errorCode: "adapter_failed",
            finishedAt: new Date(),
            ...(setupFailureAgent ? {
              resultJson: mergeRunStopMetadataForAgent(setupFailureAgent, "failed", {
                errorCode: "adapter_failed",
                errorMessage: message,
              }),
            } : {}),
          }).catch(() => undefined);
          await setWakeupStatus(run.wakeupRequestId, "failed", {
            finishedAt: new Date(),
            error: message,
          }).catch(() => undefined);
          const failedRun = await getRun(runId).catch(() => null);
          if (failedRun) {
            // Emit a run-log event so the failure is visible in the run timeline,
            // consistent with what the inner catch block does for adapter failures.
            await appendRunEvent(failedRun, 1, {
              eventType: "error",
              stream: "system",
              level: "error",
              message,
            }).catch(() => undefined);
            const livenessRun = await classifyAndPersistRunLiveness(failedRun).catch(() => failedRun);
            const failedAgent = setupFailureAgent ?? await getAgent(run.agentId).catch(() => null);
            if (failedAgent) {
              await refreshContinuationSummaryForRun(livenessRun, failedAgent).catch(() => undefined);
              await finalizeIssueCommentPolicy(livenessRun, failedAgent).catch(() => undefined);
            }
            await releaseIssueExecutionAndPromote(livenessRun).catch(() => undefined);
          }
          // Ensure the agent is not left stuck in "running" if the inner catch handler's
          // DB calls threw (e.g. a transient DB error in finalizeAgentStatus).
          await finalizeAgentStatus(run.agentId, "failed").catch(() => undefined);
        } finally {
          const latestRun = await getRun(run.id).catch(() => null);
          await releaseEnvironmentLeasesForRun({
            runId: run.id,
            companyId: run.companyId,
            agentId: run.agentId,
            status: latestRun?.status,
            failureReason: latestRun?.error ?? undefined,
          });
          await releaseRuntimeServicesForRun(run.id).catch(() => undefined);
          activeRunExecutions.delete(run.id);
          await startNextQueuedRunForAgent(run.agentId);
        }
  }

  function buildImmediateExecutionPathRecoveryComment(input: {
    status: "todo" | "in_progress";
    latestRun: Pick<typeof heartbeatRuns.$inferSelect, "error" | "errorCode"> | null | undefined;
  }) {
    const failureSummary = summarizeRunFailureForIssueComment(input.latestRun);
    if (input.status === "todo") {
      return (
        "Paperclip automatically retried dispatch for this assigned `todo` issue during terminal run recovery, " +
        `but it still has no live execution path.${failureSummary ?? ""} ` +
        "Moving it to `blocked` so it is visible for intervention."
      );
    }

    return (
      "Paperclip automatically retried continuation for this assigned `in_progress` issue during terminal run " +
      `recovery, but it still has no live execution path.${failureSummary ?? ""} ` +
      "Moving it to `blocked` so it is visible for intervention."
    );
  }

  async function releaseIssueExecutionAndPromote(
    run: typeof heartbeatRuns.$inferSelect,
    options: { suppressFollowUp?: boolean } = {},
  ) {
    const runContext = parseObject(run.contextSnapshot);
    const contextIssueId = readNonEmptyString(runContext.issueId);
    const taskKey = deriveTaskKeyWithHeartbeatFallback(runContext, null);
    const recoveryAgent = await getAgent(run.agentId);
    const recoveryAgentInvokable =
      recoveryAgent &&
      recoveryAgent.status !== "paused" &&
      recoveryAgent.status !== "terminated" &&
      recoveryAgent.status !== "pending_approval";
    const recoverySessionBefore = recoveryAgentInvokable
      ? await resolveSessionBeforeForWakeup(recoveryAgent, taskKey)
      : null;
    const recoveryAgentNameKey = normalizeAgentNameKey(recoveryAgent?.name);

    const promotionResult = await db.transaction(async (tx) => {
      if (contextIssueId) {
        await tx.execute(
          sql`select id from issues where company_id = ${run.companyId} and id = ${contextIssueId} for update`,
        );
      } else {
        await tx.execute(
          sql`select id from issues where company_id = ${run.companyId} and execution_run_id = ${run.id} for update`,
        );
      }

      let issue = await tx
        .select()
        .from(issues)
        .where(
          and(
            eq(issues.companyId, run.companyId),
            contextIssueId ? eq(issues.id, contextIssueId) : eq(issues.executionRunId, run.id),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!issue) return null;
      if (issue.executionRunId && issue.executionRunId !== run.id) return null;

      if (issue.executionRunId === run.id) {
        await tx
          .update(issues)
          .set({
            executionRunId: null,
            checkoutRunId: null,
            executionAgentNameKey: null,
            executionLockedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(issues.id, issue.id));
      }

      if (options.suppressFollowUp) {
        await tx
          .update(agentWakeupRequests)
          .set({
            status: "cancelled",
            finishedAt: new Date(),
            error: "Cancelled with follow-up suppression",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentWakeupRequests.companyId, issue.companyId),
              inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution"]),
              sql`${agentWakeupRequests.payload} ->> 'issueId' = ${issue.id}`,
              sql`${agentWakeupRequests.runId} is null`,
            ),
          );
        return { kind: "released" as const };
      }

      while (true) {
        const deferred = await tx
          .select()
          .from(agentWakeupRequests)
          .where(
            and(
              eq(agentWakeupRequests.companyId, issue.companyId),
              eq(agentWakeupRequests.status, "deferred_issue_execution"),
              sql`${agentWakeupRequests.payload} ->> 'issueId' = ${issue.id}`,
            ),
          )
          .orderBy(asc(agentWakeupRequests.requestedAt))
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (!deferred) break;

        const deferredAgent = await tx
          .select()
          .from(agents)
          .where(eq(agents.id, deferred.agentId))
          .then((rows) => rows[0] ?? null);

        if (
          !deferredAgent ||
          deferredAgent.companyId !== issue.companyId ||
          deferredAgent.status === "paused" ||
          deferredAgent.status === "terminated" ||
          deferredAgent.status === "pending_approval"
        ) {
          await tx
            .update(agentWakeupRequests)
            .set({
              status: "failed",
              finishedAt: new Date(),
              error: "Deferred wake could not be promoted: agent is not invokable",
              updatedAt: new Date(),
            })
            .where(eq(agentWakeupRequests.id, deferred.id));
          continue;
        }

        const deferredPayload = parseObject(deferred.payload);
        const deferredContextSeed = parseObject(deferredPayload[DEFERRED_WAKE_CONTEXT_KEY]);
        const activePauseHold = await treeControlSvc.getActivePauseHoldGate(issue.companyId, issue.id);
        const treeHoldInteractionWake = activePauseHold && await isVerifiedIssueTreeControlInteractionWake(tx, {
          companyId: issue.companyId,
          issueId: issue.id,
          agentId: deferred.agentId,
          contextSnapshot: deferredContextSeed,
          requestedByActorType: deferred.requestedByActorType,
          requestedByActorId: deferred.requestedByActorId,
        });
        if (activePauseHold && !treeHoldInteractionWake) {
          await tx
            .update(agentWakeupRequests)
            .set({
              status: "cancelled",
              finishedAt: new Date(),
              error: "Deferred wake suppressed by active subtree pause hold",
              updatedAt: new Date(),
            })
            .where(eq(agentWakeupRequests.id, deferred.id));
          continue;
        }

        const promotedContextSeed: Record<string, unknown> = { ...deferredContextSeed };
        if (activePauseHold) {
          promotedContextSeed.treeHoldInteraction = true;
          promotedContextSeed.activeTreeHold = {
            holdId: activePauseHold.holdId,
            rootIssueId: activePauseHold.rootIssueId,
            mode: activePauseHold.mode,
            reason: activePauseHold.reason,
            releasePolicy: activePauseHold.releasePolicy,
            interaction: true,
          };
        }
        const deferredCommentIds = extractWakeCommentIds(deferredContextSeed);
        const deferredWakeReason = readNonEmptyString(deferredContextSeed.wakeReason);
        if (deferredCommentIds.length > 0 && issue.status === "cancelled") {
          await tx
            .update(agentWakeupRequests)
            .set({
              status: "cancelled",
              finishedAt: new Date(),
              error: "Deferred comment wake suppressed because the issue is cancelled",
              updatedAt: new Date(),
            })
            .where(eq(agentWakeupRequests.id, deferred.id));
          continue;
        }
        // Deferred comment wakes may only revive completed issues when the
        // original comment carried explicit reopen/resume intent.
        const deferredResumeIntent =
          asBoolean((deferredPayload as Record<string, unknown>)?.resumeIntent, false) === true ||
          asBoolean((deferredPayload as Record<string, unknown>)?.followUpRequested, false) === true ||
          asBoolean(promotedContextSeed.resumeIntent, false) === true ||
          asBoolean(promotedContextSeed.followUpRequested, false) === true;
        const deferredRequestedByHuman = deferred.requestedByActorType === "user";
        // System follow-ups such as retry or cleanup wakes must not reopen
        // closed work on behalf of generic comments.
        const shouldReopenDeferredCommentWake =
          deferredCommentIds.length > 0 &&
          issue.status === "done" &&
          deferredRequestedByHuman &&
          (
            deferredWakeReason === "issue_reopened_via_comment" ||
            deferredResumeIntent
          );
        let reopenedActivity: LogActivityInput | null = null;

        if (shouldReopenDeferredCommentWake) {
          const reopenedFromStatus = issue.status;
          const reopenedIssue = await issuesSvc.update(
            issue.id,
            {
              status: "todo",
              executionState: null,
            },
            tx,
          );
          if (reopenedIssue) {
            issue = {
              ...issue,
              identifier: reopenedIssue.identifier,
              status: reopenedIssue.status,
              executionRunId: reopenedIssue.executionRunId,
            };
            if (!readNonEmptyString(promotedContextSeed.reopenedFrom)) {
              promotedContextSeed.reopenedFrom = reopenedFromStatus;
            }
            reopenedActivity = {
              companyId: issue.companyId,
              actorType: "system",
              actorId: "heartbeat",
              agentId: deferred.agentId,
              runId: run.id,
              action: "issue.updated",
              entityType: "issue",
              entityId: issue.id,
              details: {
                status: "todo",
                reopened: true,
                reopenedFrom: reopenedFromStatus,
                source: "deferred_comment_wake",
                identifier: issue.identifier,
              },
            };
          }
        }

        const promotedReason = readNonEmptyString(deferred.reason) ?? "issue_execution_promoted";
        const promotedSource =
          (readNonEmptyString(deferred.source) as WakeupOptions["source"]) ?? "automation";
        const promotedTriggerDetail =
          (readNonEmptyString(deferred.triggerDetail) as WakeupOptions["triggerDetail"]) ?? null;
        const promotedPayload = deferredPayload;
        delete promotedPayload[DEFERRED_WAKE_CONTEXT_KEY];

        const {
          contextSnapshot: promotedContextSnapshot,
          taskKey: promotedTaskKey,
        } = normalizeWakeupContext({
          contextSnapshot: promotedContextSeed,
          reason: promotedReason,
          source: promotedSource,
          triggerDetail: promotedTriggerDetail,
          payload: promotedPayload,
        });

        const sessionBefore =
          readNonEmptyString(promotedContextSnapshot.resumeSessionDisplayId) ??
          await resolveSessionBeforeForWakeup(deferredAgent, promotedTaskKey);
        const promotedContinuationAttempt = readContinuationAttempt(
          promotedContextSnapshot.livenessContinuationAttempt,
        );
        const now = new Date();
        const newRun = await tx
          .insert(heartbeatRuns)
          .values({
            companyId: deferredAgent.companyId,
            agentId: deferredAgent.id,
            invocationSource: promotedSource,
            triggerDetail: promotedTriggerDetail,
            status: "queued",
            wakeupRequestId: deferred.id,
            contextSnapshot: promotedContextSnapshot,
            sessionIdBefore: sessionBefore,
            continuationAttempt: promotedContinuationAttempt,
          })
          .returning()
          .then((rows) => rows[0]);

        await tx
          .update(agentWakeupRequests)
          .set({
            status: "queued",
            reason: "issue_execution_promoted",
            runId: newRun.id,
            claimedAt: null,
            finishedAt: null,
            error: null,
            updatedAt: now,
          })
          .where(eq(agentWakeupRequests.id, deferred.id));

        return {
          kind: "promoted" as const,
          run: newRun,
          reopenedActivity,
        };
      }

      const issueNeedsImmediateRecovery =
        (issue.status === "todo" || issue.status === "in_progress") &&
        !issue.assigneeUserId &&
        issue.assigneeAgentId === run.agentId &&
        (run.status === "failed" || run.status === "timed_out" || run.status === "cancelled");

      if (!issueNeedsImmediateRecovery) {
        return { kind: "released" as const };
      }

      const existingExecutionPath = await tx
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, issue.companyId),
            inArray(heartbeatRuns.status, [...EXECUTION_PATH_HEARTBEAT_RUN_STATUSES]),
            sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issue.id}`,
            sql`${heartbeatRuns.id} <> ${run.id}`,
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (existingExecutionPath) {
        return { kind: "released" as const };
      }

      if (await isAutomaticRecoverySuppressedByPauseHold(db, issue.companyId, issue.id, treeControlSvc)) {
        return { kind: "released" as const };
      }

      if (issue.originKind === RECOVERY_ORIGIN_KINDS.strandedIssueRecovery) {
        return {
          kind: "blocked_recovery_in_place" as const,
          issue,
          previousStatus: issue.status,
        };
      }

      if (run.errorCode === "missing_issue_disposition") {
        return {
          kind: "blocked_successful_run_handoff" as const,
          issue,
          previousStatus: issue.status,
        };
      }

      const processLossRetryCapExhausted =
        run.errorCode === "process_lost" &&
        await processLossRetryCapReached({
          companyId: issue.companyId,
          agentId: run.agentId,
          issueId: issue.id,
          now: new Date(),
        });
      const shouldBlockImmediately =
        !recoveryAgentInvokable ||
        !recoveryAgent ||
        processLossRetryCapExhausted ||
        didAutomaticRecoveryFail(run, issue.status === "todo" ? "assignment_recovery" : "issue_continuation_needed");
      if (shouldBlockImmediately) {
        const comment = buildImmediateExecutionPathRecoveryComment({
          status: issue.status as "todo" | "in_progress",
          latestRun: run,
        });
        return {
          kind: "blocked" as const,
          issue,
          previousStatus: issue.status,
          comment,
        };
      }

      const retryReason = issue.status === "todo" ? "assignment_recovery" : "issue_continuation_needed";
      const recoveryReason = issue.status === "todo" ? "issue_assignment_recovery" : "issue_continuation_needed";
      const recoverySource =
        issue.status === "todo" ? "issue.assignment_recovery" : "issue.continuation_recovery";
      const now = new Date();
      const wakeupRequest = await tx
        .insert(agentWakeupRequests)
        .values({
          companyId: issue.companyId,
          agentId: recoveryAgent.id,
          source: "automation",
          triggerDetail: "system",
          reason: recoveryReason,
          payload: withRecoveryModelProfileHint({
            issueId: issue.id,
            retryOfRunId: run.id,
          }),
          status: "queued",
          requestedByActorType: "system",
          requestedByActorId: null,
          updatedAt: now,
        })
        .returning()
        .then((rows) => rows[0]);

      const queuedRun = await tx
        .insert(heartbeatRuns)
        .values({
          companyId: issue.companyId,
          agentId: recoveryAgent.id,
          invocationSource: "automation",
          triggerDetail: "system",
          status: "queued",
          wakeupRequestId: wakeupRequest.id,
          contextSnapshot: withRecoveryModelProfileHint({
            issueId: issue.id,
            taskId: issue.id,
            wakeReason: recoveryReason,
            retryReason,
            source: recoverySource,
            retryOfRunId: run.id,
          }),
          sessionIdBefore: recoverySessionBefore,
          retryOfRunId: run.id,
          updatedAt: now,
        })
        .returning()
        .then((rows) => rows[0]);

      await tx
        .update(agentWakeupRequests)
        .set({
          runId: queuedRun.id,
          updatedAt: now,
        })
        .where(eq(agentWakeupRequests.id, wakeupRequest.id));

      const conflictingIssue = await tx
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.id, issue.id), noOpenRoutineExecutionDuplicateForIssue()))
        .then((rows) => rows[0] ?? null);

      if (!conflictingIssue) {
        const reason =
          "Skipped recovery because another open routine execution issue for the same routine already owns the active execution lock";
        await tx
          .update(heartbeatRuns)
          .set({
            status: "cancelled",
            finishedAt: now,
            error: reason,
            errorCode: "duplicate_routine_execution",
            resultJson: {
              ...parseObject(queuedRun.resultJson),
              stopReason: "duplicate_routine_execution",
              issueId: issue.id,
              retryOfRunId: run.id,
            },
            updatedAt: now,
          })
          .where(eq(heartbeatRuns.id, queuedRun.id));
        await tx
          .update(agentWakeupRequests)
          .set({
            status: "skipped",
            finishedAt: now,
            error: reason,
            updatedAt: now,
          })
          .where(eq(agentWakeupRequests.id, wakeupRequest.id));
        return {
          kind: "duplicate_routine_execution_skipped" as const,
          run: null,
        };
      }

      return {
        kind: "queued_recovery" as const,
        run: queuedRun,
      };
    });

    if (promotionResult?.kind === "blocked") {
      await recovery.escalateStrandedAssignedIssue({
        issue: promotionResult.issue,
        previousStatus: promotionResult.previousStatus as "todo" | "in_progress",
        latestRun: run,
        comment: promotionResult.comment,
      });
      return;
    }

    if (promotionResult?.kind === "blocked_recovery_in_place") {
      await recovery.escalateStrandedRecoveryIssueInPlace({
        issue: promotionResult.issue,
        previousStatus: promotionResult.previousStatus as "todo" | "in_progress",
        latestRun: run,
      });
      return;
    }

    if (promotionResult?.kind === "blocked_successful_run_handoff") {
      const context = parseObject(run.contextSnapshot);
      await recovery.escalateStrandedAssignedIssue({
        issue: promotionResult.issue,
        previousStatus: promotionResult.previousStatus as "todo" | "in_progress",
        latestRun: run,
        recoveryCause: SUCCESSFUL_RUN_MISSING_STATE_REASON,
        successfulRunHandoffEvidence: {
          sourceRunId: readNonEmptyString(context.sourceRunId) ?? readNonEmptyString(context.resumeFromRunId),
          correctiveRunId: run.id,
          missingDisposition: readNonEmptyString(context.missingDisposition) ?? "clear_next_step",
          handoffAttempt: Math.max(1, Math.floor(asNumber(context.handoffAttempt, 1))),
          maxHandoffAttempts: Math.max(1, Math.floor(asNumber(context.maxHandoffAttempts, 1))),
        },
      });
      return;
    }

    const promotedRun = promotionResult?.run ?? null;
    if (!promotedRun) return;

    if (promotionResult?.kind === "promoted" && promotionResult.reopenedActivity) {
      await logActivity(db, promotionResult.reopenedActivity);
    }

    publishLiveEvent({
      companyId: promotedRun.companyId,
      type: "heartbeat.run.queued",
      payload: {
        runId: promotedRun.id,
        agentId: promotedRun.agentId,
        invocationSource: promotedRun.invocationSource,
        triggerDetail: promotedRun.triggerDetail,
        wakeupRequestId: promotedRun.wakeupRequestId,
      },
    });

    await startNextQueuedRunForAgent(promotedRun.agentId);
  }

  async function enqueueWakeup(agentId: string, opts: WakeupOptions = {}) {
    const source = opts.source ?? "on_demand";
    const triggerDetail = opts.triggerDetail ?? null;
    const contextSnapshot: Record<string, unknown> = { ...(opts.contextSnapshot ?? {}) };
    const reason = opts.reason ?? null;
    const payload = opts.payload ?? null;
    const {
      contextSnapshot: enrichedContextSnapshot,
      issueIdFromPayload,
      taskKey,
      wakeCommentId,
    } = normalizeWakeupContext({
      contextSnapshot,
      reason,
      source,
      triggerDetail,
      payload,
    });
    let issueId = readNonEmptyString(enrichedContextSnapshot.issueId) ?? issueIdFromPayload;

    const agent = await getAgent(agentId);
    if (!agent) throw notFound("Agent not found");
    const explicitResumeSession = await resolveExplicitResumeSessionOverride(agent, payload, taskKey);
    if (explicitResumeSession) {
      enrichedContextSnapshot.resumeFromRunId = explicitResumeSession.resumeFromRunId;
      enrichedContextSnapshot.resumeSessionDisplayId = explicitResumeSession.sessionDisplayId;
      enrichedContextSnapshot.resumeSessionParams = explicitResumeSession.sessionParams;
      if (!readNonEmptyString(enrichedContextSnapshot.issueId) && explicitResumeSession.issueId) {
        enrichedContextSnapshot.issueId = explicitResumeSession.issueId;
      }
      if (!readNonEmptyString(enrichedContextSnapshot.taskId) && explicitResumeSession.taskId) {
        enrichedContextSnapshot.taskId = explicitResumeSession.taskId;
      }
      if (!readNonEmptyString(enrichedContextSnapshot.taskKey) && explicitResumeSession.taskKey) {
        enrichedContextSnapshot.taskKey = explicitResumeSession.taskKey;
      }
      issueId = readNonEmptyString(enrichedContextSnapshot.issueId) ?? issueId;
    }
    const effectiveTaskKey = readNonEmptyString(enrichedContextSnapshot.taskKey) ?? taskKey;
    const sessionBefore =
      explicitResumeSession?.sessionDisplayId ??
      await resolveSessionBeforeForWakeup(agent, effectiveTaskKey);
    const continuationAttempt = readContinuationAttempt(enrichedContextSnapshot.livenessContinuationAttempt);

    const writeSkippedRequest = async (skipReason: string) => {
      await db.insert(agentWakeupRequests).values({
        companyId: agent.companyId,
        agentId,
        source,
        triggerDetail,
        reason: skipReason,
        payload,
        status: "skipped",
        requestedByActorType: opts.requestedByActorType ?? null,
        requestedByActorId: opts.requestedByActorId ?? null,
        idempotencyKey: opts.idempotencyKey ?? null,
        finishedAt: new Date(),
      });
    };

    let projectId = readNonEmptyString(enrichedContextSnapshot.projectId);
    if (!projectId && issueId) {
      projectId = await db
        .select({ projectId: issues.projectId })
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
        .then((rows) => rows[0]?.projectId ?? null);
    }

    const budgetBlock = await budgets.getInvocationBlock(agent.companyId, agentId, {
      issueId,
      projectId,
    });
    if (budgetBlock) {
      await writeSkippedRequest("budget.blocked");
      throw conflict(budgetBlock.reason, {
        scopeType: budgetBlock.scopeType,
        scopeId: budgetBlock.scopeId,
      });
    }

    if (
      agent.status === "paused" ||
      agent.status === "terminated" ||
      agent.status === "pending_approval"
    ) {
      throw conflict("Agent is not invokable in its current state", { status: agent.status });
    }

    const policy = parseHeartbeatPolicy(agent);

    if (source === "timer" && !policy.enabled) {
      await writeSkippedRequest("heartbeat.disabled");
      return null;
    }
    if (source !== "timer" && !policy.wakeOnDemand) {
      await writeSkippedRequest("heartbeat.wakeOnDemand.disabled");
      return null;
    }

    const wakeReason = readNonEmptyString(enrichedContextSnapshot.wakeReason) ?? reason;
    if (wakeReason?.startsWith("issue_")) {
      const recentRecoveryDismissal = await db
        .select({ latestDismissedAt: sql<Date>`max(${issues.updatedAt})` })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, agent.companyId),
            eq(issues.assigneeAgentId, agentId),
            eq(issues.originKind, "stranded_issue_recovery"),
            eq(issues.status, "cancelled"),
            isNull(issues.hiddenAt),
            sql`${issues.updatedAt} >= now() - interval '60 seconds'`,
          ),
        )
        .then((rows) => rows[0]?.latestDismissedAt ?? null);
      if (recentRecoveryDismissal) {
        await writeSkippedRequest("issue_wake_storm_suppressed");
        await logActivity(db, {
          companyId: agent.companyId,
          actorType: "system",
          actorId: "system",
          agentId,
          runId: null,
          action: "heartbeat.issue_wake_suppressed",
          entityType: issueId ? "issue" : "agent",
          entityId: issueId ?? agentId,
          details: {
            wakeReason,
            source,
            triggerDetail,
            latestRecoveryDismissalAt: recentRecoveryDismissal,
            suppressWindowSeconds: 60,
          },
        });
        return null;
      }
    }

    if (issueId) {
      const activePauseHold = await treeControlSvc.getActivePauseHoldGate(agent.companyId, issueId);
      if (activePauseHold) {
        const treeHoldInteractionWake = await isVerifiedIssueTreeControlInteractionWake(db, {
          companyId: agent.companyId,
          issueId,
          agentId,
          contextSnapshot: enrichedContextSnapshot,
          requestedByActorType: opts.requestedByActorType,
          requestedByActorId: opts.requestedByActorId,
        });

        if (!treeHoldInteractionWake) {
          await writeSkippedRequest("issue_tree_hold_active");
          await logIssueTreeHoldWakeupDeferredOnce(db, {
            companyId: agent.companyId,
            issueId,
            agentId,
            holdId: activePauseHold.holdId,
            rootIssueId: activePauseHold.rootIssueId,
            requestedReason: reason ?? "unknown",
            source,
            triggerDetail,
          });
          return null;
        }

        enrichedContextSnapshot.treeHoldInteraction = true;
        enrichedContextSnapshot.activeTreeHold = {
          holdId: activePauseHold.holdId,
          rootIssueId: activePauseHold.rootIssueId,
          mode: activePauseHold.mode,
          reason: activePauseHold.reason,
          releasePolicy: activePauseHold.releasePolicy,
          interaction: true,
        };
      }
    }

    if (issueId) {
      // Mention-triggered wakes can request input from another agent, but they must
      // still respect the issue execution lock so a second agent cannot start on the
      // same issue workspace while the assignee already has a live run.
      const agentNameKey = normalizeAgentNameKey(agent.name);

      const outcome = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select id from issues where id = ${issueId} and company_id = ${agent.companyId} for update`,
        );

        const issue = await tx
          .select({
            id: issues.id,
            companyId: issues.companyId,
            status: issues.status,
            assigneeAgentId: issues.assigneeAgentId,
            executionRunId: issues.executionRunId,
            executionAgentNameKey: issues.executionAgentNameKey,
          })
          .from(issues)
          .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
          .then((rows) => rows[0] ?? null);

        if (!issue) {
          await tx.insert(agentWakeupRequests).values({
            companyId: agent.companyId,
            agentId,
            source,
            triggerDetail,
            reason: "issue_execution_issue_not_found",
            payload,
            status: "skipped",
            requestedByActorType: opts.requestedByActorType ?? null,
            requestedByActorId: opts.requestedByActorId ?? null,
            idempotencyKey: opts.idempotencyKey ?? null,
            finishedAt: new Date(),
          });
          return { kind: "skipped" as const };
        }

        const cancelStaleScheduledRetry = async (scheduledRun: typeof heartbeatRuns.$inferSelect) => {
          const issueCancelled = issue.status === "cancelled";
          if (
            scheduledRun.status !== "scheduled_retry" ||
            (scheduledRun.agentId === issue.assigneeAgentId && !issueCancelled)
          ) {
            return false;
          }

          const now = new Date();
          const reason = issueCancelled
            ? "Cancelled because the issue was cancelled before the scheduled retry became due"
            : "Cancelled because the issue was reassigned before the scheduled retry became due";
          const cancelled = await tx
            .update(heartbeatRuns)
            .set({
              status: "cancelled",
              finishedAt: now,
              error: reason,
              errorCode: issueCancelled ? "issue_cancelled" : "issue_reassigned",
              updatedAt: now,
            })
            .where(and(eq(heartbeatRuns.id, scheduledRun.id), eq(heartbeatRuns.status, "scheduled_retry")))
            .returning()
            .then((rows) => rows[0] ?? null);

          if (!cancelled) return false;

          if (scheduledRun.wakeupRequestId) {
            await tx
              .update(agentWakeupRequests)
              .set({
                status: "cancelled",
                finishedAt: now,
                error: reason,
                updatedAt: now,
              })
              .where(eq(agentWakeupRequests.id, scheduledRun.wakeupRequestId));
          }

          if (issue.executionRunId === scheduledRun.id) {
            await tx
              .update(issues)
              .set({
                executionRunId: null,
                executionAgentNameKey: null,
                executionLockedAt: null,
                updatedAt: now,
              })
              .where(and(eq(issues.id, issue.id), eq(issues.executionRunId, scheduledRun.id)));
          }

          const [eventSeq] = await tx
            .select({ maxSeq: sql<number | null>`max(${heartbeatRunEvents.seq})` })
            .from(heartbeatRunEvents)
            .where(eq(heartbeatRunEvents.runId, cancelled.id));

          await tx.insert(heartbeatRunEvents).values({
            companyId: cancelled.companyId,
            runId: cancelled.id,
            agentId: cancelled.agentId,
            seq: Number(eventSeq?.maxSeq ?? 0) + 1,
            eventType: "lifecycle",
            stream: "system",
            level: "warn",
            message: issueCancelled
              ? "Scheduled retry cancelled because issue was cancelled before it became due"
              : "Scheduled retry cancelled because issue ownership changed before it became due",
            payload: {
              issueId: issue.id,
              issueStatus: issue.status,
              scheduledRetryAttempt: cancelled.scheduledRetryAttempt,
              scheduledRetryAt: cancelled.scheduledRetryAt ? new Date(cancelled.scheduledRetryAt).toISOString() : null,
              scheduledRetryReason: cancelled.scheduledRetryReason,
              previousRetryAgentId: cancelled.agentId,
              currentAssigneeAgentId: issue.assigneeAgentId,
            },
          });

          return true;
        };

        let activeExecutionRun = issue.executionRunId
          ? await tx
            .select()
            .from(heartbeatRuns)
            .where(eq(heartbeatRuns.id, issue.executionRunId))
            .then((rows) => rows[0] ?? null)
          : null;

        if (
          activeExecutionRun &&
          !EXECUTION_PATH_HEARTBEAT_RUN_STATUSES.includes(
            activeExecutionRun.status as (typeof EXECUTION_PATH_HEARTBEAT_RUN_STATUSES)[number],
          )
        ) {
          activeExecutionRun = null;
        }

        if (activeExecutionRun && await cancelStaleScheduledRetry(activeExecutionRun)) {
          activeExecutionRun = null;
        }

        if (!activeExecutionRun && issue.executionRunId) {
          await tx
            .update(issues)
            .set({
              executionRunId: null,
              executionAgentNameKey: null,
              executionLockedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(issues.id, issue.id));
        }

        if (!activeExecutionRun) {
          const legacyRun = await tx
            .select()
            .from(heartbeatRuns)
            .where(
              and(
                eq(heartbeatRuns.companyId, issue.companyId),
                inArray(heartbeatRuns.status, [...EXECUTION_PATH_HEARTBEAT_RUN_STATUSES]),
                sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issue.id}`,
              ),
            )
            .orderBy(
              sql`case when ${heartbeatRuns.status} = 'running' then 0 else 1 end`,
              asc(heartbeatRuns.createdAt),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null);

          if (legacyRun) {
            if (await cancelStaleScheduledRetry(legacyRun)) {
              activeExecutionRun = null;
            } else {
              activeExecutionRun = legacyRun;
              if (legacyRun.status === "running") {
                const legacyAgent = await tx
                  .select({ name: agents.name })
                  .from(agents)
                  .where(eq(agents.id, legacyRun.agentId))
                  .then((rows) => rows[0] ?? null);
                await tx
                  .update(issues)
                  .set({
                    executionRunId: legacyRun.id,
                    executionAgentNameKey: normalizeAgentNameKey(legacyAgent?.name),
                    executionLockedAt: new Date(),
                    updatedAt: new Date(),
                  })
                  .where(and(
                    eq(issues.id, issue.id),
                    noActiveRoutineExecutionConflict({
                      companyId: issue.companyId,
                      issueId: issue.id,
                    }),
                  ));
              }
            }
          }
        }

        const dependencyReadiness = await issuesSvc.listDependencyReadiness(
          issue.companyId,
          [issue.id],
          tx,
        ).then((rows) => rows.get(issue.id) ?? null);

        // Blocked descendants should stay idle until the final blocker resolves.
        // Human comment/mention wakes are the exception: they may run in a
        // bounded interaction mode so the assignee can answer or triage.
        const blockedInteractionWake =
          dependencyReadiness &&
          !dependencyReadiness.isDependencyReady &&
          allowsIssueInteractionWake(enrichedContextSnapshot);

        if (blockedInteractionWake) {
          enrichedContextSnapshot.dependencyBlockedInteraction = true;
          enrichedContextSnapshot.unresolvedBlockerIssueIds = dependencyReadiness.unresolvedBlockerIssueIds;
          enrichedContextSnapshot.unresolvedBlockerCount = dependencyReadiness.unresolvedBlockerCount;
          enrichedContextSnapshot.unresolvedBlockerSummaries = await listUnresolvedBlockerSummaries(
            tx,
            issue.companyId,
            issue.id,
            dependencyReadiness.unresolvedBlockerIssueIds,
          );
        }

        if (!activeExecutionRun && dependencyReadiness && !dependencyReadiness.isDependencyReady && !blockedInteractionWake) {
          await tx.insert(agentWakeupRequests).values({
            companyId: agent.companyId,
            agentId,
            source,
            triggerDetail,
            reason: "issue_dependencies_blocked",
            payload: {
              ...(payload ?? {}),
              issueId,
              unresolvedBlockerIssueIds: dependencyReadiness.unresolvedBlockerIssueIds,
            },
            status: "skipped",
            requestedByActorType: opts.requestedByActorType ?? null,
            requestedByActorId: opts.requestedByActorId ?? null,
            idempotencyKey: opts.idempotencyKey ?? null,
            finishedAt: new Date(),
          });
          return { kind: "skipped" as const };
        }

        if (activeExecutionRun) {
          const executionAgent = await tx
            .select({ name: agents.name })
            .from(agents)
            .where(eq(agents.id, activeExecutionRun.agentId))
            .then((rows) => rows[0] ?? null);
          const executionAgentNameKey =
            normalizeAgentNameKey(issue.executionAgentNameKey) ??
            normalizeAgentNameKey(executionAgent?.name);
          const isSameExecutionAgent =
            Boolean(executionAgentNameKey) && executionAgentNameKey === agentNameKey;
          const shouldQueueFollowupForRunningWake =
            shouldQueueFollowupForRunningIssueWake({ contextSnapshot: enrichedContextSnapshot, wakeCommentId }) &&
            activeExecutionRun.status === "running" &&
            isSameExecutionAgent;

          if (isSameExecutionAgent && !shouldQueueFollowupForRunningWake) {
            const mergedContextSnapshot = mergeCoalescedContextSnapshot(
              activeExecutionRun.contextSnapshot,
              enrichedContextSnapshot,
            );
            const mergedRun = await tx
              .update(heartbeatRuns)
              .set({
                contextSnapshot: mergedContextSnapshot,
                updatedAt: new Date(),
              })
              .where(eq(heartbeatRuns.id, activeExecutionRun.id))
              .returning()
              .then((rows) => rows[0] ?? activeExecutionRun);

            await tx.insert(agentWakeupRequests).values({
              companyId: agent.companyId,
              agentId,
              source,
              triggerDetail,
              reason: "issue_execution_same_name",
              payload,
              status: "coalesced",
              coalescedCount: 1,
              requestedByActorType: opts.requestedByActorType ?? null,
              requestedByActorId: opts.requestedByActorId ?? null,
              idempotencyKey: opts.idempotencyKey ?? null,
              runId: mergedRun.id,
              finishedAt: new Date(),
            });

            return { kind: "coalesced" as const, run: mergedRun };
          }

          const deferredPayload = {
            ...(payload ?? {}),
            issueId,
            [DEFERRED_WAKE_CONTEXT_KEY]: enrichedContextSnapshot,
          };

          const existingDeferred = await tx
            .select()
            .from(agentWakeupRequests)
            .where(
              and(
                eq(agentWakeupRequests.companyId, agent.companyId),
                eq(agentWakeupRequests.agentId, agentId),
                eq(agentWakeupRequests.status, "deferred_issue_execution"),
                sql`${agentWakeupRequests.payload} ->> 'issueId' = ${issue.id}`,
              ),
            )
            .orderBy(asc(agentWakeupRequests.requestedAt))
            .limit(1)
            .then((rows) => rows[0] ?? null);

          if (existingDeferred) {
            const existingDeferredPayload = parseObject(existingDeferred.payload);
            const existingDeferredContext = parseObject(existingDeferredPayload[DEFERRED_WAKE_CONTEXT_KEY]);
            const mergedDeferredContext = mergeCoalescedContextSnapshot(
              existingDeferredContext,
              enrichedContextSnapshot,
            );
            const mergedDeferredPayload = {
              ...existingDeferredPayload,
              ...(payload ?? {}),
              issueId,
              [DEFERRED_WAKE_CONTEXT_KEY]: mergedDeferredContext,
            };

            await tx
              .update(agentWakeupRequests)
              .set({
                payload: mergedDeferredPayload,
                coalescedCount: (existingDeferred.coalescedCount ?? 0) + 1,
                updatedAt: new Date(),
              })
              .where(eq(agentWakeupRequests.id, existingDeferred.id));

            return { kind: "deferred" as const };
          }

          await tx.insert(agentWakeupRequests).values({
            companyId: agent.companyId,
            agentId,
            source,
            triggerDetail,
            reason: "issue_execution_deferred",
            payload: deferredPayload,
            status: "deferred_issue_execution",
            requestedByActorType: opts.requestedByActorType ?? null,
            requestedByActorId: opts.requestedByActorId ?? null,
            idempotencyKey: opts.idempotencyKey ?? null,
          });

          return { kind: "deferred" as const };
        }

        if (await shouldSkipForManagementQueueCap(agent, tx)) {
          await tx.insert(agentWakeupRequests).values({
            companyId: agent.companyId,
            agentId,
            source,
            triggerDetail,
            reason: "management_queue_cap_reached",
            payload,
            status: "skipped",
            requestedByActorType: opts.requestedByActorType ?? null,
            requestedByActorId: opts.requestedByActorId ?? null,
            idempotencyKey: opts.idempotencyKey ?? null,
            finishedAt: new Date(),
          });
          return { kind: "skipped" as const };
        }

        if (await countQueuedRuns(tx) >= LOCAL_QUEUED_RUNS_MAX) {
          await tx.insert(agentWakeupRequests).values({
            companyId: agent.companyId,
            agentId,
            source,
            triggerDetail,
            reason: "local_queued_run_cap_reached",
            payload,
            status: "skipped",
            requestedByActorType: opts.requestedByActorType ?? null,
            requestedByActorId: opts.requestedByActorId ?? null,
            idempotencyKey: opts.idempotencyKey ?? null,
            finishedAt: new Date(),
          });
          return { kind: "skipped" as const };
        }

        const wakeupRequest = await tx
          .insert(agentWakeupRequests)
          .values({
            companyId: agent.companyId,
            agentId,
            source,
            triggerDetail,
            reason,
            payload,
            status: "queued",
            requestedByActorType: opts.requestedByActorType ?? null,
            requestedByActorId: opts.requestedByActorId ?? null,
            idempotencyKey: opts.idempotencyKey ?? null,
          })
          .returning()
          .then((rows) => rows[0]);

        const newRun = await tx
          .insert(heartbeatRuns)
          .values({
            companyId: agent.companyId,
            agentId,
            invocationSource: source,
            triggerDetail,
            status: "queued",
            wakeupRequestId: wakeupRequest.id,
            contextSnapshot: enrichedContextSnapshot,
            sessionIdBefore: sessionBefore,
            continuationAttempt,
          })
          .returning()
          .then((rows) => rows[0]);

        await tx
          .update(agentWakeupRequests)
          .set({
            runId: newRun.id,
            updatedAt: new Date(),
          })
          .where(eq(agentWakeupRequests.id, wakeupRequest.id));

        // executionRunId is NOT stamped here (enqueueWakeup queues the run but
        // doesn't start it). It will be stamped in claimQueuedRun() once the run
        // transitions to "running" — Fix A (lazy locking).

        return { kind: "queued" as const, run: newRun };
      });

      if (outcome.kind === "deferred" || outcome.kind === "skipped") return null;
      if (outcome.kind === "coalesced") {
        await startNextQueuedRunForAgent(agent.id);
        return outcome.run;
      }

      const newRun = outcome.run;
      publishLiveEvent({
        companyId: newRun.companyId,
        type: "heartbeat.run.queued",
        payload: {
          runId: newRun.id,
          agentId: newRun.agentId,
          invocationSource: newRun.invocationSource,
          triggerDetail: newRun.triggerDetail,
          wakeupRequestId: newRun.wakeupRequestId,
        },
      });

      await startNextQueuedRunForAgent(agent.id);
      return newRun;
    }

    const activeRuns = await db
      .select()
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agentId), inArray(heartbeatRuns.status, [...EXECUTION_PATH_HEARTBEAT_RUN_STATUSES])))
      .orderBy(desc(heartbeatRuns.createdAt));

    const sameScopeQueuedRun = activeRuns.find(
      (candidate) => candidate.status === "queued" && isSameTaskScope(runTaskKey(candidate), taskKey),
    );
    const sameScopeScheduledRetryRun = activeRuns.find(
      (candidate) => candidate.status === "scheduled_retry" && isSameTaskScope(runTaskKey(candidate), taskKey),
    );
    const sameScopeRunningRun = activeRuns.find(
      (candidate) => candidate.status === "running" && isSameTaskScope(runTaskKey(candidate), taskKey),
    );
    const shouldQueueFollowupForRunningWake =
      Boolean(sameScopeRunningRun) &&
      !sameScopeQueuedRun &&
      shouldQueueFollowupForRunningIssueWake({ contextSnapshot: enrichedContextSnapshot, wakeCommentId });

    const coalescedTargetRun =
      sameScopeQueuedRun ??
      sameScopeScheduledRetryRun ??
      (shouldQueueFollowupForRunningWake ? null : sameScopeRunningRun ?? null);

    if (coalescedTargetRun) {
      const mergedContextSnapshot = mergeCoalescedContextSnapshot(
        coalescedTargetRun.contextSnapshot,
        enrichedContextSnapshot,
      );
      const mergedRun = await db
        .update(heartbeatRuns)
        .set({
          contextSnapshot: mergedContextSnapshot,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, coalescedTargetRun.id))
        .returning()
        .then((rows) => rows[0] ?? coalescedTargetRun);

      await db.insert(agentWakeupRequests).values({
        companyId: agent.companyId,
        agentId,
        source,
        triggerDetail,
        reason,
        payload,
        status: "coalesced",
        coalescedCount: 1,
        requestedByActorType: opts.requestedByActorType ?? null,
        requestedByActorId: opts.requestedByActorId ?? null,
        idempotencyKey: opts.idempotencyKey ?? null,
        runId: mergedRun.id,
        finishedAt: new Date(),
      });
      return mergedRun;
    }

    if (await shouldSkipForManagementQueueCap(agent)) {
      await writeSkippedRequest("management_queue_cap_reached");
      return null;
    }

    if (await countQueuedRuns() >= LOCAL_QUEUED_RUNS_MAX) {
      await writeSkippedRequest("local_queued_run_cap_reached");
      return null;
    }

    const wakeupRequest = await db
      .insert(agentWakeupRequests)
      .values({
        companyId: agent.companyId,
        agentId,
        source,
        triggerDetail,
        reason,
        payload,
        status: "queued",
        requestedByActorType: opts.requestedByActorType ?? null,
        requestedByActorId: opts.requestedByActorId ?? null,
        idempotencyKey: opts.idempotencyKey ?? null,
      })
      .returning()
      .then((rows) => rows[0]);

    const newRun = await db
      .insert(heartbeatRuns)
      .values({
        companyId: agent.companyId,
        agentId,
        invocationSource: source,
        triggerDetail,
        status: "queued",
        wakeupRequestId: wakeupRequest.id,
        contextSnapshot: enrichedContextSnapshot,
        sessionIdBefore: sessionBefore,
        continuationAttempt,
      })
      .returning()
      .then((rows) => rows[0]);

    await db
      .update(agentWakeupRequests)
      .set({
        runId: newRun.id,
        updatedAt: new Date(),
      })
      .where(eq(agentWakeupRequests.id, wakeupRequest.id));

    publishLiveEvent({
      companyId: newRun.companyId,
      type: "heartbeat.run.queued",
      payload: {
        runId: newRun.id,
        agentId: newRun.agentId,
        invocationSource: newRun.invocationSource,
        triggerDetail: newRun.triggerDetail,
        wakeupRequestId: newRun.wakeupRequestId,
      },
    });

    await startNextQueuedRunForAgent(agent.id);

    return newRun;
  }

  async function listProjectScopedRunIds(companyId: string, projectId: string) {
    const runIssueId = sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'issueId'`;
    const effectiveProjectId = sql<string | null>`coalesce(${heartbeatRuns.contextSnapshot} ->> 'projectId', ${issues.projectId}::text)`;

    const rows = await db
      .selectDistinctOn([heartbeatRuns.id], { id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .leftJoin(
        issues,
        and(
          eq(issues.companyId, companyId),
          sql`${issues.id}::text = ${runIssueId}`,
        ),
      )
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          inArray(heartbeatRuns.status, [...CANCELLABLE_HEARTBEAT_RUN_STATUSES]),
          sql`${effectiveProjectId} = ${projectId}`,
        ),
      );

    return rows.map((row) => row.id);
  }

  async function listProjectScopedWakeupIds(companyId: string, projectId: string) {
    const wakeIssueId = sql<string | null>`${agentWakeupRequests.payload} ->> 'issueId'`;
    const effectiveProjectId = sql<string | null>`coalesce(${agentWakeupRequests.payload} ->> 'projectId', ${issues.projectId}::text)`;

    const rows = await db
      .selectDistinctOn([agentWakeupRequests.id], { id: agentWakeupRequests.id })
      .from(agentWakeupRequests)
      .leftJoin(
        issues,
        and(
          eq(issues.companyId, companyId),
          sql`${issues.id}::text = ${wakeIssueId}`,
        ),
      )
      .where(
        and(
          eq(agentWakeupRequests.companyId, companyId),
          inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution"]),
          sql`${agentWakeupRequests.runId} is null`,
          sql`${effectiveProjectId} = ${projectId}`,
        ),
      );

    return rows.map((row) => row.id);
  }

  async function cancelPendingWakeupsForBudgetScope(scope: BudgetEnforcementScope) {
    const now = new Date();
    let wakeupIds: string[] = [];

    if (scope.scopeType === "company") {
      wakeupIds = await db
        .select({ id: agentWakeupRequests.id })
        .from(agentWakeupRequests)
        .where(
          and(
            eq(agentWakeupRequests.companyId, scope.companyId),
            inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution"]),
            sql`${agentWakeupRequests.runId} is null`,
          ),
        )
        .then((rows) => rows.map((row) => row.id));
    } else if (scope.scopeType === "agent") {
      wakeupIds = await db
        .select({ id: agentWakeupRequests.id })
        .from(agentWakeupRequests)
        .where(
          and(
            eq(agentWakeupRequests.companyId, scope.companyId),
            eq(agentWakeupRequests.agentId, scope.scopeId),
            inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution"]),
            sql`${agentWakeupRequests.runId} is null`,
          ),
        )
        .then((rows) => rows.map((row) => row.id));
    } else {
      wakeupIds = await listProjectScopedWakeupIds(scope.companyId, scope.scopeId);
    }

    if (wakeupIds.length === 0) return 0;

    await db
      .update(agentWakeupRequests)
      .set({
        status: "cancelled",
        finishedAt: now,
        error: "Cancelled due to budget pause",
        updatedAt: now,
      })
      .where(inArray(agentWakeupRequests.id, wakeupIds));

    return wakeupIds.length;
  }

  async function cancelIssueFollowUpRuns(
    sourceRun: typeof heartbeatRuns.$inferSelect,
    issueId: string,
    reason: string,
  ) {
    const runs = await db
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, sourceRun.companyId),
          sql`${heartbeatRuns.id} <> ${sourceRun.id}`,
          sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
          inArray(heartbeatRuns.status, [...CANCELLABLE_HEARTBEAT_RUN_STATUSES]),
        ),
      );

    for (const run of runs) {
      const agent = await getAgent(run.agentId);
      const running = runningProcesses.get(run.id);
      if (running) {
        await terminateHeartbeatRunProcess({
          pid: running.child.pid ?? run.processPid,
          processGroupId: running.processGroupId ?? run.processGroupId,
          graceMs: Math.max(1, running.graceSec) * 1000,
        });
      } else if (run.processPid || run.processGroupId) {
        await terminateHeartbeatRunProcess({
          pid: run.processPid,
          processGroupId: run.processGroupId,
        });
      }

      const cancelled = await setRunStatus(run.id, "cancelled", {
        finishedAt: new Date(),
        error: reason,
        errorCode: "cancelled",
        ...(agent ? {
          resultJson: mergeRunStopMetadataForAgent(agent, "cancelled", {
            resultJson: parseObject(run.resultJson),
            errorCode: "cancelled",
            errorMessage: reason,
          }),
        } : {}),
      });

      await setWakeupStatus(run.wakeupRequestId, "cancelled", {
        finishedAt: new Date(),
        error: reason,
      });

      if (cancelled) {
        await appendRunEvent(cancelled, await nextRunEventSeq(cancelled.id), {
          eventType: "lifecycle",
          stream: "system",
          level: "warn",
          message: "run cancelled with follow-up suppression",
        });
        await releaseIssueExecutionAndPromote(cancelled, { suppressFollowUp: true });
      }

      runningProcesses.delete(run.id);
      await finalizeAgentStatus(run.agentId, "cancelled");
    }

    return runs.length;
  }

  async function cancelRunInternal(
    runId: string,
    reason = "Cancelled by control plane",
    options: { suppressFollowUp?: boolean } = {},
  ) {
    const run = await getRun(runId);
    if (!run) throw notFound("Heartbeat run not found");
    if (!CANCELLABLE_HEARTBEAT_RUN_STATUSES.includes(run.status as (typeof CANCELLABLE_HEARTBEAT_RUN_STATUSES)[number])) return run;
    const agent = await getAgent(run.agentId);

    const running = runningProcesses.get(run.id);
    if (running) {
      await terminateHeartbeatRunProcess({
        pid: running.child.pid ?? run.processPid,
        processGroupId: running.processGroupId ?? run.processGroupId,
        graceMs: Math.max(1, running.graceSec) * 1000,
      });
    } else if (run.processPid || run.processGroupId) {
      await terminateHeartbeatRunProcess({
        pid: run.processPid,
        processGroupId: run.processGroupId,
      });
    }

    const cancelled = await setRunStatus(run.id, "cancelled", {
      finishedAt: new Date(),
      error: reason,
      errorCode: "cancelled",
      ...(agent ? {
        resultJson: mergeRunStopMetadataForAgent(agent, "cancelled", {
          resultJson: parseObject(run.resultJson),
          errorCode: "cancelled",
          errorMessage: reason,
        }),
      } : {}),
    });

    await setWakeupStatus(run.wakeupRequestId, "cancelled", {
      finishedAt: new Date(),
      error: reason,
    });

    if (cancelled) {
      await appendRunEvent(cancelled, 1, {
        eventType: "lifecycle",
        stream: "system",
        level: "warn",
        message: "run cancelled",
      });
      await releaseIssueExecutionAndPromote(cancelled, {
        suppressFollowUp: options.suppressFollowUp,
      });
      if (options.suppressFollowUp) {
        const issueId = readNonEmptyString(parseObject(cancelled.contextSnapshot).issueId);
        if (issueId) {
          await cancelIssueFollowUpRuns(cancelled, issueId, "Cancelled with follow-up suppression");
        }
      }
    }

    runningProcesses.delete(run.id);
    activeRunExecutions.delete(run.id);
    await finalizeAgentStatus(run.agentId, "cancelled");
    if (!options.suppressFollowUp) {
      await startNextQueuedRunForAgent(run.agentId);
    }
    return cancelled;
  }

  async function cancelActiveForAgentInternal(agentId: string, reason = "Cancelled due to agent pause") {
    const agent = await getAgent(agentId);
    const runs = await db
      .select()
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agentId), inArray(heartbeatRuns.status, [...CANCELLABLE_HEARTBEAT_RUN_STATUSES])));

    for (const run of runs) {
      await setRunStatus(run.id, "cancelled", {
        finishedAt: new Date(),
        error: reason,
        errorCode: "cancelled",
        ...(agent ? {
          resultJson: mergeRunStopMetadataForAgent(agent, "cancelled", {
            resultJson: parseObject(run.resultJson),
            errorCode: "cancelled",
            errorMessage: reason,
          }),
        } : {}),
      });

      await setWakeupStatus(run.wakeupRequestId, "cancelled", {
        finishedAt: new Date(),
        error: reason,
      });

      const running = runningProcesses.get(run.id);
      if (running) {
        await terminateHeartbeatRunProcess({
          pid: running.child.pid ?? run.processPid,
          processGroupId: running.processGroupId ?? run.processGroupId,
          graceMs: Math.max(1, running.graceSec) * 1000,
        });
        runningProcesses.delete(run.id);
      } else if (run.processPid || run.processGroupId) {
        await terminateHeartbeatRunProcess({
          pid: run.processPid,
          processGroupId: run.processGroupId,
        });
      }
      activeRunExecutions.delete(run.id);
      await releaseIssueExecutionAndPromote(run);
    }

    return runs.length;
  }

  async function drainActiveRunExecutions(filter: {
    agentId?: string;
    companyId?: string;
    runId?: string;
  } = {}) {
    const matching = Array.from(activeRunExecutions.values()).filter((execution) => {
      if (filter.runId && execution.runId !== filter.runId) return false;
      if (filter.agentId && execution.agentId !== filter.agentId) return false;
      if (filter.companyId && execution.companyId !== filter.companyId) return false;
      return true;
    });

    await Promise.allSettled(matching.map((execution) => execution.promise));
    return matching.length;
  }

  async function cancelBudgetScopeWork(scope: BudgetEnforcementScope) {
    if (scope.scopeType === "agent") {
      await cancelActiveForAgentInternal(scope.scopeId, "Cancelled due to budget pause");
      await cancelPendingWakeupsForBudgetScope(scope);
      return;
    }

    const runIds =
      scope.scopeType === "company"
        ? await db
          .select({ id: heartbeatRuns.id })
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, scope.companyId),
              inArray(heartbeatRuns.status, [...CANCELLABLE_HEARTBEAT_RUN_STATUSES]),
            ),
          )
          .then((rows) => rows.map((row) => row.id))
        : await listProjectScopedRunIds(scope.companyId, scope.scopeId);

    for (const runId of runIds) {
      await cancelRunInternal(runId, "Cancelled due to budget pause");
    }

    await cancelPendingWakeupsForBudgetScope(scope);
  }

  type HeartbeatRunListOptions = {
    agentId?: string;
    limit?: number;
    cursorCreatedAt?: string | Date | null;
    cursorId?: string | null;
    page: "cursor";
  };

  type HeartbeatRunListPage = {
    runs: any[];
    nextCursor: { createdAt: string; id: string } | null;
  };

  async function listRuns(companyId: string, agentId?: string, limit?: number): Promise<any[]>;
  async function listRuns(companyId: string, options: HeartbeatRunListOptions): Promise<HeartbeatRunListPage>;
  async function listRuns(
    companyId: string,
    agentIdOrOptions?: string | HeartbeatRunListOptions,
    legacyLimit?: number,
  ): Promise<any[] | HeartbeatRunListPage> {
    const options: {
      agentId?: string;
      limit?: number;
      cursorCreatedAt?: string | Date | null;
      cursorId?: string | null;
      page?: "cursor";
    } = typeof agentIdOrOptions === "object" && agentIdOrOptions !== null
      ? agentIdOrOptions
      : { agentId: agentIdOrOptions, limit: legacyLimit };
    const pageMode = options.page === "cursor";
    const safeLimit = Math.max(1, Math.min(options.limit ?? 200, 1000));
    const cursorDate = options.cursorCreatedAt ? new Date(options.cursorCreatedAt) : null;
    const cursorFilter = pageMode && options.cursorId && cursorDate && !Number.isNaN(cursorDate.getTime())
      ? or(
          lt(heartbeatRuns.createdAt, cursorDate),
          and(eq(heartbeatRuns.createdAt, cursorDate), lt(heartbeatRuns.id, options.cursorId)),
        )
      : undefined;
    const filters = [
      eq(heartbeatRuns.companyId, companyId),
      ...(options.agentId ? [eq(heartbeatRuns.agentId, options.agentId)] : []),
      ...(cursorFilter ? [cursorFilter] : []),
    ];
    const safeForLegacyEncoding = await hasUnsafeTextProjectionDatabase();
    const query = db
      .select(
        safeForLegacyEncoding
          ? {
              ...heartbeatRunListColumns,
              error: sql<string | null>`NULL`.as("error"),
              ...heartbeatRunListContextColumns,
            }
          : {
              ...heartbeatRunListColumns,
              ...heartbeatRunListContextColumns,
              ...heartbeatRunListResultColumns,
            },
      )
      .from(heartbeatRuns)
      .where(and(...filters))
      .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id));

    const queryLimit = pageMode ? safeLimit + 1 : options.limit;
    const rows = queryLimit ? await query.limit(queryLimit) : await query;
    const hasMore = pageMode && rows.length > safeLimit;
    const rowsForReturn = hasMore ? rows.slice(0, safeLimit) : rows;
    const runs = rowsForReturn.map((row) => {
      const {
        contextIssueId,
        contextTaskId,
        contextTaskKey,
        contextCommentId,
        contextWakeCommentId,
        contextWakeReason,
        contextWakeSource,
        contextWakeTriggerDetail,
        resultSummary,
        resultResult,
        resultMessage,
        resultError,
        resultTotalCostUsd,
        resultCostUsd,
        resultCostUsdCamel,
        ...rest
      } = row as typeof row & {
        resultSummary?: string | null;
        resultResult?: string | null;
        resultMessage?: string | null;
        resultError?: string | null;
        resultTotalCostUsd?: string | null;
        resultCostUsd?: string | null;
        resultCostUsdCamel?: string | null;
      };

      return {
        ...rest,
        contextSnapshot: summarizeHeartbeatRunContextSnapshot({
          issueId: contextIssueId,
          taskId: contextTaskId,
          taskKey: contextTaskKey,
          commentId: contextCommentId,
          wakeCommentId: contextWakeCommentId,
          wakeReason: contextWakeReason,
          wakeSource: contextWakeSource,
          wakeTriggerDetail: contextWakeTriggerDetail,
        }),
        resultJson: safeForLegacyEncoding
          ? null
          : summarizeHeartbeatRunListResultJson({
              summary: resultSummary,
              result: resultResult,
              message: resultMessage,
              error: resultError,
              totalCostUsd: resultTotalCostUsd,
              costUsd: resultCostUsd,
              costUsdCamel: resultCostUsdCamel,
            }),
      };
    });
    if (!pageMode) return runs;

    const lastRow = rowsForReturn[rowsForReturn.length - 1];
    return {
      runs,
      nextCursor: hasMore && lastRow
        ? {
            createdAt: lastRow.createdAt instanceof Date ? lastRow.createdAt.toISOString() : String(lastRow.createdAt),
            id: lastRow.id,
          }
        : null,
    };
  }

  return {
    list: listRuns,

    getRun,

    getRunLogAccess,

    getRuntimeState: async (agentId: string) => {
      const state = await getRuntimeState(agentId);
      const agent = await getAgent(agentId);
      if (!agent) return null;
      const ensured = state ?? (await ensureRuntimeState(agent));
      const latestTaskSession = await db
        .select()
        .from(agentTaskSessions)
        .where(and(eq(agentTaskSessions.companyId, agent.companyId), eq(agentTaskSessions.agentId, agent.id)))
        .orderBy(desc(agentTaskSessions.updatedAt))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      return {
        ...ensured,
        sessionDisplayId: latestTaskSession?.sessionDisplayId ?? ensured.sessionId,
        sessionParamsJson: latestTaskSession?.sessionParamsJson ?? null,
      };
    },

    listTaskSessions: async (agentId: string) => {
      const agent = await getAgent(agentId);
      if (!agent) throw notFound("Agent not found");

      return db
        .select()
        .from(agentTaskSessions)
        .where(and(eq(agentTaskSessions.companyId, agent.companyId), eq(agentTaskSessions.agentId, agentId)))
        .orderBy(desc(agentTaskSessions.updatedAt), desc(agentTaskSessions.createdAt));
    },

    resetRuntimeSession: async (agentId: string, opts?: { taskKey?: string | null }) => {
      const agent = await getAgent(agentId);
      if (!agent) throw notFound("Agent not found");
      await ensureRuntimeState(agent);
      const taskKey = readNonEmptyString(opts?.taskKey);
      const clearedTaskSessions = await clearTaskSessions(
        agent.companyId,
        agent.id,
        taskKey ? { taskKey, adapterType: agent.adapterType } : undefined,
      );
      const runtimePatch: Partial<typeof agentRuntimeState.$inferInsert> = {
        sessionId: null,
        lastError: null,
        updatedAt: new Date(),
      };
      if (!taskKey) {
        runtimePatch.stateJson = {};
      }

      const updated = await db
        .update(agentRuntimeState)
        .set(runtimePatch)
        .where(eq(agentRuntimeState.agentId, agentId))
        .returning()
        .then((rows) => rows[0] ?? null);

      if (!updated) return null;
      return {
        ...updated,
        sessionDisplayId: null,
        sessionParamsJson: null,
        clearedTaskSessions,
      };
    },

    listEvents: (runId: string, afterSeq = 0, limit = 200) =>
      db
        .select()
        .from(heartbeatRunEvents)
        .where(and(eq(heartbeatRunEvents.runId, runId), gt(heartbeatRunEvents.seq, afterSeq)))
        .orderBy(asc(heartbeatRunEvents.seq))
        .limit(Math.max(1, Math.min(limit, 1000))),

    getRetryExhaustedReason: async (runId: string) => {
      const row = await db
        .select({
          message: heartbeatRunEvents.message,
        })
        .from(heartbeatRunEvents)
        .where(
          and(
            eq(heartbeatRunEvents.runId, runId),
            eq(heartbeatRunEvents.eventType, "lifecycle"),
            sql`${heartbeatRunEvents.message} like 'Bounded retry exhausted%'`,
          ),
        )
        .orderBy(desc(heartbeatRunEvents.id))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      return row?.message ?? null;
    },

    readLog: async (
      runOrLookup: string | {
        id: string;
        companyId: string;
        logStore: string | null;
        logRef: string | null;
      },
      opts?: { offset?: number; limitBytes?: number },
    ) => {
      const run = typeof runOrLookup === "string" ? await getRunLogAccess(runOrLookup) : runOrLookup;
      const runId = typeof runOrLookup === "string" ? runOrLookup : runOrLookup.id;
      if (!run) throw notFound("Heartbeat run not found");
      if (!run.logStore || !run.logRef) throw notFound("Run log not found");

      const result = await runLogStore.read(
        {
          store: run.logStore as "local_file",
          logRef: run.logRef,
        },
        opts,
      );

      return {
        runId,
        store: run.logStore,
        logRef: run.logRef,
        ...result,
        // Run-log chunks are already redacted before they are appended to the store.
        // Rewriting the full chunk again on every poll creates avoidable string copies.
        content: result.content,
      };
    },

    statLog: async (
      runOrLookup: string | {
        id: string;
        companyId: string;
        logStore: string | null;
        logRef: string | null;
      },
    ) => {
      const run = typeof runOrLookup === "string" ? await getRunLogAccess(runOrLookup) : runOrLookup;
      const runId = typeof runOrLookup === "string" ? runOrLookup : runOrLookup.id;
      if (!run) throw notFound("Heartbeat run not found");
      if (!run.logStore || !run.logRef) throw notFound("Run log not found");

      const result = await runLogStore.stat({
        store: run.logStore as "local_file",
        logRef: run.logRef,
      });

      return {
        runId,
        store: run.logStore,
        logRef: run.logRef,
        ...result,
      };
    },

    invoke: async (
      agentId: string,
      source: "timer" | "assignment" | "on_demand" | "automation" = "on_demand",
      contextSnapshot: Record<string, unknown> = {},
      triggerDetail: "manual" | "ping" | "callback" | "system" = "manual",
      actor?: { actorType?: "user" | "agent" | "system"; actorId?: string | null },
    ) =>
      enqueueWakeup(agentId, {
        source,
        triggerDetail,
        contextSnapshot,
        requestedByActorType: actor?.actorType,
        requestedByActorId: actor?.actorId ?? null,
      }),

    wakeup: enqueueWakeup,
    triggerIssueMonitor,

    reportRunActivity: clearDetachedRunWarning,

    reapOrphanedRuns,
    reconcilePersistedHeartbeatRuntimeState,

    promoteDueScheduledRetries,
    retryScheduledRetryNow,

    resumeQueuedRuns,

    scheduleBoundedRetry: async (
      runId: string,
      opts?: {
        now?: Date;
        random?: () => number;
        retryReason?: string;
        wakeReason?: string;
        maxAttempts?: number;
        delayMs?: number;
      },
    ) => {
      const run = await getRun(runId, { unsafeFullResultJson: true });
      if (!run) return { outcome: "missing_run" as const };
      const agent = await getAgent(run.agentId);
      if (!agent) return { outcome: "missing_agent" as const };
      return scheduleBoundedRetryForRun(run, agent, opts);
    },

    reconcileStrandedAssignedIssues,

    buildIssueGraphLivenessAutoRecoveryPreview,

    reconcileIssueGraphLiveness,

    scanSilentActiveRuns,

    reconcileProductivityReviews,

    refreshStockInstructionsForManagerAgents,

    buildRunOutputSilence,

    tickTimers: async (now = new Date()) => {
      const allAgents = await db.select().from(agents);
      let checked = 0;
      let enqueued = 0;
      let skipped = 0;

      for (const agent of allAgents) {
        if (agent.status === "paused" || agent.status === "terminated" || agent.status === "pending_approval") continue;
        const policy = parseHeartbeatPolicy(agent);
        if (!policy.enabled || policy.intervalSec <= 0) continue;

        checked += 1;
        const baseline = new Date(agent.lastHeartbeatAt ?? agent.createdAt).getTime();
        const elapsedMs = now.getTime() - baseline;
        if (elapsedMs < policy.intervalSec * 1000) continue;

        const liveRunCount = await countQueuedOrRunningRuns();
        if (liveRunCount >= HEARTBEAT_GLOBAL_RUNNING_RUNS_MAX) {
          skipped += 1;
          continue;
        }

        const { payload, contextSnapshot } = buildTimerWakeupAssignmentContext(
          now,
          await resolveTimerWakeAssignedIssue(agent),
        );
        const run = await enqueueWakeup(agent.id, {
          source: "timer",
          triggerDetail: "system",
          reason: "heartbeat_timer",
          payload,
          requestedByActorType: "system",
          requestedByActorId: "heartbeat_scheduler",
          contextSnapshot,
        });
        if (run) enqueued += 1;
        else skipped += 1;
      }

      const issueMonitors = await tickDueIssueMonitors(now);

      return {
        checked: checked + issueMonitors.checked,
        enqueued: enqueued + issueMonitors.triggered,
        skipped: skipped + issueMonitors.skipped,
      };
    },

    cancelRun: (runId: string, options?: { suppressFollowUp?: boolean }) => cancelRunInternal(runId, "Cancelled by control plane", options),

    cancelActiveForAgent: (agentId: string) => cancelActiveForAgentInternal(agentId),

    drainActiveRunExecutions,

    cancelBudgetScopeWork,

    getRunIssueSummary: async (runId: string) => {
      const [run] = await db
        .select(heartbeatRunIssueSummaryColumns)
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId))
        .limit(1);
      return run ?? null;
    },

    getActiveRunForAgent: async (agentId: string) => {
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.agentId, agentId),
            eq(heartbeatRuns.status, "running"),
          ),
        )
        .orderBy(desc(heartbeatRuns.startedAt))
        .limit(1);
      return run ?? null;
    },

    getActiveRunIssueSummaryForAgent: async (agentId: string) => {
      const [run] = await db
        .select(heartbeatRunIssueSummaryColumns)
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.agentId, agentId),
            eq(heartbeatRuns.status, "running"),
          ),
        )
        .orderBy(desc(heartbeatRuns.startedAt))
        .limit(1);
      return run ?? null;
    },
  };
}
