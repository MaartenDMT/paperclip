// Tiny shared leaf helpers used across the heartbeat modules. Kept dependency-free
// so any heartbeat submodule can import them without creating cycles.

export function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

// Cap a display/session id at a sane length for storage and UI.
export function truncateDisplayId(value: string | null | undefined, max = 128) {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

// Context-snapshot key under which the structured Paperclip wake payload is
// stored. Shared by heartbeat.ts (which builds the payload) and the wake-context
// helpers (which clear it once comment ids are normalized).
export const PAPERCLIP_WAKE_PAYLOAD_KEY = "paperclipWake";

// Context-snapshot flag recording that the harness checked the issue out. Shared
// by heartbeat.ts (which sets it) and the wake-payload builder (which reports it).
export const PAPERCLIP_HARNESS_CHECKOUT_KEY = "paperclipHarnessCheckedOut";

// Terminal heartbeat-run statuses. Shared by heartbeat.ts and the run-predicate
// helpers.
export const HEARTBEAT_RUN_TERMINAL_STATUSES = ["succeeded", "failed", "cancelled", "timed_out"] as const;

// Retry reason marking a max-turn continuation retry. Shared by heartbeat.ts
// (which schedules the retry) and the wake-gating helpers (which treat it as an
// in-progress auto-checkout trigger).
export const MAX_TURN_CONTINUATION_RETRY_REASON = "max_turns_continuation";
