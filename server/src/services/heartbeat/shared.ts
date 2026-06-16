// Tiny shared leaf helpers used across the heartbeat modules. Kept dependency-free
// so any heartbeat submodule can import them without creating cycles.

export function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
