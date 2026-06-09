// Per-issue recovery-cycle budget.
//
// Paperclip's run-level and source-run-level recovery caps (bounded liveness
// continuations, successful-run handoff attempts, etc.) all reset whenever the
// stranded-issue sweep returns an issue to `todo` via the obsolete-recovery-
// wrapper cleanup, because that bounce creates a brand-new source run with a
// fresh budget. An issue that can never reach a terminal or human-owned
// disposition therefore churns forever: recover -> run makes no real progress ->
// escalate to `blocked` -> wrapper becomes obsolete -> bounce back to `todo` ->
// recover again. REA-3812 (plan-only churn) and REA-4533 (dead adapter) are two
// triggers of this same loop.
//
// The cycle budget bounds recovery at the *issue* level: each automatic
// resume-to-`todo` is recorded in the activity log, and once an issue has been
// auto-resumed this many times without a human-meaningful state change, the
// sweep stops bouncing it and parks it in `blocked` for a human instead.

// The activity-log `details.source` written each time recovery returns a source
// issue to `todo`. Counting these for an issue gives its recovery-cycle depth.
export const RECOVERY_RESUME_BOUNCE_SOURCE = "recovery.resolve_obsolete_stranded_source_resume";

export const DEFAULT_MAX_RECOVERY_RESUME_CYCLES = 3;

export const RECOVERY_BUDGET_PARK_NOTICE_BODY =
  "Paperclip stopped automatically resuming this issue: it has already been auto-recovered several times without " +
  "reaching a terminal or human-owned state, so retrying only re-enters the recover -> no-progress -> re-block loop. " +
  "The issue is parked in `blocked` for a human to break the cycle (clarify the scope, resolve the real blocker, or " +
  "mark it done/cancelled).";

export type RecoveryCycleBudgetDecision = {
  exhausted: boolean;
  priorResumeCycles: number;
  threshold: number;
};

export function decideRecoveryCycleBudget(input: {
  priorResumeCycles: number;
  threshold?: number;
}): RecoveryCycleBudgetDecision {
  const threshold = input.threshold ?? DEFAULT_MAX_RECOVERY_RESUME_CYCLES;
  return {
    exhausted: input.priorResumeCycles >= threshold,
    priorResumeCycles: input.priorResumeCycles,
    threshold,
  };
}
