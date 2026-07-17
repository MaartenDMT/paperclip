export const CAMPAIGN_PHASE_STATUSES = [
  "planning",
  "plan_in_review",
  "revision_requested",
  "approved",
  "in_progress",
  "completed",
  "skipped",
] as const;

export type CampaignPhaseStatus = (typeof CAMPAIGN_PHASE_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<CampaignPhaseStatus, ReadonlySet<CampaignPhaseStatus>> = {
  planning: new Set(["plan_in_review", "skipped"]),
  plan_in_review: new Set(["revision_requested", "approved", "skipped"]),
  revision_requested: new Set(["planning", "plan_in_review", "skipped"]),
  approved: new Set(["in_progress", "skipped"]),
  in_progress: new Set(["completed", "skipped"]),
  completed: new Set(),
  skipped: new Set(),
};

export function isCampaignPhaseStatus(value: unknown): value is CampaignPhaseStatus {
  return typeof value === "string" && CAMPAIGN_PHASE_STATUSES.includes(value as CampaignPhaseStatus);
}

export function assertCampaignPhaseTransition(current: CampaignPhaseStatus, next: CampaignPhaseStatus): void {
  if (current === next) return;
  if (!ALLOWED_TRANSITIONS[current].has(next)) {
    throw new Error(`Invalid campaign phase transition: ${current} -> ${next}`);
  }
}
