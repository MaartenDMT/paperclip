import { availableParallelism } from "node:os";

const LOCAL_ACTIVE_RUN_EXECUTIONS_FALLBACK = 6;

function parsePositiveInteger(raw: string | undefined): number | null {
  const parsed = Math.floor(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function computeLocalActiveRunExecutionsMax(
  rawOverride: string | undefined,
  hostParallelism = availableParallelism(),
  globalRunningMax = Number.POSITIVE_INFINITY,
): number {
  const override = parsePositiveInteger(rawOverride);
  if (override !== null) {
    return Math.max(1, override);
  }

  const derived = Number.isFinite(hostParallelism) && hostParallelism > 0
    ? Math.floor(hostParallelism)
    : LOCAL_ACTIVE_RUN_EXECUTIONS_FALLBACK;
  const derivedCap = Number.isFinite(globalRunningMax) && globalRunningMax > 0
    ? Math.floor(globalRunningMax)
    : derived;

  return Math.max(
    LOCAL_ACTIVE_RUN_EXECUTIONS_FALLBACK,
    Math.min(derivedCap, derived),
  );
}
