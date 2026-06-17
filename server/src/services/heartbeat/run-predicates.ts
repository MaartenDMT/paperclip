// Small run/task predicate helpers extracted from heartbeat.ts.
//
// Pure classification helpers: derive a run's task key, compare task scopes,
// detect adapters whose local child processes are tracked across runs, narrow a
// status to a terminal heartbeat-run status, and normalize an agent name key.

import { heartbeatRuns } from "@paperclipai/db";
import type { EnvironmentLeaseStatus } from "@paperclipai/shared";
import { deriveTaskKey } from "./wake-context.js";
import { HEARTBEAT_RUN_TERMINAL_STATUSES } from "./shared.js";

const SESSIONED_LOCAL_ADAPTERS = new Set([
  "claude_local",
  "codex_local",
  "cursor",
  "gemini_local",
  "hermes_local",
  "kimi_local",
  "minimax_local",
  "opencode_local",
  "pi_local",
  "zai_local",
]);

export function runTaskKey(run: typeof heartbeatRuns.$inferSelect) {
  return deriveTaskKey(run.contextSnapshot as Record<string, unknown> | null, null);
}

export function isSameTaskScope(left: string | null, right: string | null) {
  return (left ?? null) === (right ?? null);
}

export function isTrackedLocalChildProcessAdapter(adapterType: string) {
  return SESSIONED_LOCAL_ADAPTERS.has(adapterType);
}

export function isHeartbeatRunTerminalStatus(
  status: string | null | undefined,
): status is (typeof HEARTBEAT_RUN_TERMINAL_STATUSES)[number] {
  return HEARTBEAT_RUN_TERMINAL_STATUSES.includes(
    status as (typeof HEARTBEAT_RUN_TERMINAL_STATUSES)[number],
  );
}

export function normalizeAgentNameKey(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function leaseReleaseStatusForRunStatus(
  status: string | null | undefined,
): Extract<EnvironmentLeaseStatus, "released" | "expired" | "failed"> {
  return status === "failed" || status === "timed_out" ? "failed" : "released";
}
