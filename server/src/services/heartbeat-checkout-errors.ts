import { HttpError } from "../errors.js";

export function readBlockedCheckoutUnresolvedBlockerIssueIds(error: unknown): string[] | null {
  if (!(error instanceof HttpError)) return null;
  if (error.status !== 422) return null;
  if (error.message !== "Issue is blocked by unresolved blockers") return null;

  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];

  const unresolvedBlockerIssueIds = (details as Record<string, unknown>).unresolvedBlockerIssueIds;
  if (!Array.isArray(unresolvedBlockerIssueIds)) return [];

  return unresolvedBlockerIssueIds.filter((value): value is string =>
    typeof value === "string" && value.length > 0
  );
}
