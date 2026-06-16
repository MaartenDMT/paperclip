// Tiny shared leaf helpers used across the heartbeat modules. Kept dependency-free
// so any heartbeat submodule can import them without creating cycles.

export function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

// Context-snapshot key under which the structured Paperclip wake payload is
// stored. Shared by heartbeat.ts (which builds the payload) and the wake-context
// helpers (which clear it once comment ids are normalized).
export const PAPERCLIP_WAKE_PAYLOAD_KEY = "paperclipWake";
