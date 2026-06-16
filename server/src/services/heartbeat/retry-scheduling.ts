// Retry / transient-failure scheduling helpers extracted from heartbeat.ts.
//
// These classify a terminal heartbeat run's failure (provider quota, transient
// upstream, max-turn exhaustion), decide the recovery contract and retry timing,
// and pick the model profile + adapter metadata for the scheduled retry. All
// functions are pure: they read run/agent rows and return plain values.

import { agents, heartbeatRuns } from "@paperclipai/db";
import type { ModelProfileKey } from "@paperclipai/shared";
import { parseObject } from "../../adapters/utils.js";
import { normalizeMaxTurnStopReason } from "../heartbeat-stop-metadata.js";
import { readNonEmptyString } from "./shared.js";

export const BOUNDED_TRANSIENT_HEARTBEAT_RETRY_DELAYS_MS = [
  2 * 60 * 1000,
  10 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
] as const;
const BOUNDED_TRANSIENT_HEARTBEAT_RETRY_JITTER_RATIO = 0.25;
export const BOUNDED_TRANSIENT_HEARTBEAT_RETRY_MAX_ATTEMPTS = BOUNDED_TRANSIENT_HEARTBEAT_RETRY_DELAYS_MS.length;

type CodexTransientFallbackMode =
  | "same_session"
  | "safer_invocation"
  | "fresh_session"
  | "fresh_session_safer_invocation";

const PROVIDER_QUOTA_FAILURE_RE =
  /\b(quota|usage limit|rate limit|too many requests|429\b|insufficient credits?|credit balance|billing limit)\b/i;
const PROVIDER_TRANSIENT_FAILURE_RE =
  /\b(overload(?:ed)?|service unavailable|temporar(?:y|ily) unavailable|try again later|gateway timeout|bad gateway|upstream|econnreset|etimedout|connection reset|network error)\b/i;

export function resolveCodexTransientFallbackMode(attempt: number): CodexTransientFallbackMode {
  if (attempt <= 1) return "same_session";
  if (attempt === 2) return "safer_invocation";
  if (attempt === 3) return "fresh_session";
  return "fresh_session_safer_invocation";
}

function collectHeartbeatRunFailureStrings(
  run: Pick<typeof heartbeatRuns.$inferSelect, "error" | "errorCode" | "resultJson">,
) {
  const resultJson = parseObject(run.resultJson);
  const values = [
    run.error,
    run.errorCode,
    resultJson.error,
    resultJson.errorCode,
    resultJson.summary,
    resultJson.stderr,
    resultJson.stdout,
    resultJson.message,
  ];

  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function readHeartbeatRunErrorFamily(
  run: Pick<typeof heartbeatRuns.$inferSelect, "error" | "errorCode" | "resultJson">,
) {
  const resultJson = parseObject(run.resultJson);
  const persistedFamily = readNonEmptyString(resultJson.errorFamily);
  if (persistedFamily) return persistedFamily;

  if (run.errorCode === "codex_transient_upstream" || run.errorCode === "claude_transient_upstream") {
    return "transient_upstream";
  }

  const failureText = collectHeartbeatRunFailureStrings(run).join("\n");
  if (PROVIDER_QUOTA_FAILURE_RE.test(failureText)) {
    return "provider_quota";
  }
  if (PROVIDER_TRANSIENT_FAILURE_RE.test(failureText)) {
    return "transient_upstream";
  }
  return null;
}

export function isMaxTurnExhaustionRun(
  run: Pick<typeof heartbeatRuns.$inferSelect, "errorCode" | "resultJson">,
) {
  const resultJson = parseObject(run.resultJson);
  return Boolean(
    normalizeMaxTurnStopReason(resultJson.stopReason) ??
      normalizeMaxTurnStopReason(run.errorCode),
  );
}

function readTransientRetryNotBeforeFromRun(run: Pick<typeof heartbeatRuns.$inferSelect, "resultJson">) {
  const resultJson = parseObject(run.resultJson);
  const value = resultJson.retryNotBefore ?? resultJson.transientRetryNotBefore;
  if (!(typeof value === "string" || typeof value === "number" || value instanceof Date)) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function readTransientRecoveryContractFromRun(
  run: Pick<typeof heartbeatRuns.$inferSelect, "error" | "errorCode" | "resultJson">,
) {
  const errorFamily = readHeartbeatRunErrorFamily(run);
  if (errorFamily !== "transient_upstream" && errorFamily !== "provider_quota") {
    return null;
  }
  return {
    errorFamily,
    retryNotBefore: readTransientRetryNotBeforeFromRun(run),
    modelProfile: "fallback" as const,
  };
}

export function chooseScheduledRetryModelProfile(
  agent: Pick<typeof agents.$inferSelect, "runtimeConfig">,
  preferred: ModelProfileKey,
): ModelProfileKey {
  const runtimeConfig = parseObject(agent.runtimeConfig);
  const modelProfiles = parseObject(runtimeConfig.modelProfiles);
  const preferredProfile = parseObject(modelProfiles[preferred]);
  if (preferredProfile && preferredProfile.enabled !== false) {
    return preferred;
  }
  return "cheap";
}

export function mergeAdapterRecoveryMetadata(input: {
  resultJson: Record<string, unknown> | null | undefined;
  errorFamily?: string | null;
  retryNotBefore?: string | null;
}) {
  const errorFamily = readNonEmptyString(input.errorFamily);
  const retryNotBefore = readNonEmptyString(input.retryNotBefore);
  if (!input.resultJson && !errorFamily && !retryNotBefore) return input.resultJson ?? null;

  return {
    ...(input.resultJson ?? {}),
    ...(errorFamily ? { errorFamily } : {}),
    ...(retryNotBefore
      ? {
          retryNotBefore,
          transientRetryNotBefore: retryNotBefore,
        }
      : {}),
  };
}

export function computeBoundedTransientHeartbeatRetrySchedule(
  attempt: number,
  now = new Date(),
  random: () => number = Math.random,
) {
  if (!Number.isInteger(attempt) || attempt <= 0) return null;
  const baseDelayMs = BOUNDED_TRANSIENT_HEARTBEAT_RETRY_DELAYS_MS[attempt - 1];
  if (typeof baseDelayMs !== "number") return null;
  const sample = Math.min(1, Math.max(0, random()));
  const jitterMultiplier = 1 + (((sample * 2) - 1) * BOUNDED_TRANSIENT_HEARTBEAT_RETRY_JITTER_RATIO);
  const delayMs = Math.max(1_000, Math.round(baseDelayMs * jitterMultiplier));
  return {
    attempt,
    baseDelayMs,
    delayMs,
    dueAt: new Date(now.getTime() + delayMs),
    maxAttempts: BOUNDED_TRANSIENT_HEARTBEAT_RETRY_MAX_ATTEMPTS,
  };
}
