// Dead-adapter circuit breaker.
//
// When an agent's adapter is broken (e.g. the `opencode` binary cannot launch,
// the runtime process keeps getting lost, or the upstream provider rejects every
// invocation for billing/quota reasons), every recovery wake we enqueue for that
// agent fails again at the adapter level before any issue work — or even any
// disposition summary — can be produced.
//
// Without a circuit breaker the stranded-issue sweep keeps re-dispatching the
// same dead agent: dispatch -> adapter_failed -> escalate to `blocked` -> the
// obsolete-recovery-wrapper cleanup returns the source issue to `todo` -> the
// next sweep re-dispatches it. That bounce runs once per sweep interval forever,
// burning budget and spamming "Missing issue disposition" / "recovery blocked"
// notices on the issue thread (see REA-4533 for the canonical example).
//
// The breaker detects a run of consecutive terminal adapter-level failures and
// tells the sweep to stop re-dispatching and leave the issue parked in `blocked`
// for a human/runtime fix instead. A single later success resets it, so a
// transient adapter blip does not permanently freeze an issue.

export const ADAPTER_LEVEL_FAILURE_ERROR_CODES = new Set<string>([
  "adapter_failed",
  "process_lost",
]);

// Terminal run statuses that can carry an adapter-level failure. `cancelled` is
// an intentional stop and never counts toward the breaker.
const ADAPTER_FAILURE_RUN_STATUSES = new Set<string>(["failed", "timed_out"]);

export const DEFAULT_DEAD_ADAPTER_FAILURE_THRESHOLD = 3;

export const DEAD_ADAPTER_PARK_NOTICE_BODY =
  "Paperclip stopped automatically retrying this issue because the assigned agent has no live execution path: " +
  "its recent runs all failed at the adapter/runtime level (for example a broken adapter binary, a lost process, " +
  "or an upstream billing/quota rejection). The issue is parked in `blocked` for a human until a live execution " +
  "path is restored.";

export type CircuitBreakerRun = {
  status: string;
  errorCode: string | null;
};

export function isAdapterLevelFailureRun(run: CircuitBreakerRun | null | undefined): boolean {
  if (!run) return false;
  if (!ADAPTER_FAILURE_RUN_STATUSES.has(run.status)) return false;
  return run.errorCode != null && ADAPTER_LEVEL_FAILURE_ERROR_CODES.has(run.errorCode);
}

// Count how many of the most-recent runs were adapter-level failures, stopping at
// the first run that was not (a success, an intentional cancel, or a failure with
// a non-adapter error code). `runs` MUST be ordered newest-first.
export function countConsecutiveAdapterFailures(runs: ReadonlyArray<CircuitBreakerRun>): number {
  let count = 0;
  for (const run of runs) {
    if (!isAdapterLevelFailureRun(run)) break;
    count += 1;
  }
  return count;
}

export type DeadAdapterCircuitBreakerDecision = {
  tripped: boolean;
  consecutiveAdapterFailures: number;
  threshold: number;
};

// `runs` MUST be ordered newest-first.
export function decideDeadAdapterCircuitBreaker(input: {
  runs: ReadonlyArray<CircuitBreakerRun>;
  threshold?: number;
}): DeadAdapterCircuitBreakerDecision {
  const threshold = input.threshold ?? DEFAULT_DEAD_ADAPTER_FAILURE_THRESHOLD;
  const consecutiveAdapterFailures = countConsecutiveAdapterFailures(input.runs);
  return {
    tripped: consecutiveAdapterFailures >= threshold,
    consecutiveAdapterFailures,
    threshold,
  };
}
