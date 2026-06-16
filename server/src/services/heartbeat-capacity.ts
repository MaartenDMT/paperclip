const LOCAL_ACTIVE_RUN_EXECUTIONS_FALLBACK = 5;
const LOCAL_QUEUED_RUNS_FALLBACK = 5;

function parsePositiveInteger(raw: string | undefined): number | null {
  const parsed = Math.floor(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function computeLocalActiveRunExecutionsMax(
  rawOverride: string | undefined,
  _hostParallelism?: number,
  globalRunningMax = Number.POSITIVE_INFINITY,
): number {
  const override = parsePositiveInteger(rawOverride);
  if (override !== null) {
    return Math.max(1, override);
  }

  const globalCap = Number.isFinite(globalRunningMax) && globalRunningMax > 0
    ? Math.floor(globalRunningMax)
    : LOCAL_ACTIVE_RUN_EXECUTIONS_FALLBACK;

  return Math.max(1, Math.min(LOCAL_ACTIVE_RUN_EXECUTIONS_FALLBACK, globalCap));
}

export function computeLocalQueuedRunsMax(rawOverride: string | undefined): number {
  const override = parsePositiveInteger(rawOverride);
  return override ?? LOCAL_QUEUED_RUNS_FALLBACK;
}

export function computeLocalAvailableRunExecutionSlots(input: {
  maxLocalActiveRunExecutions: number;
  inMemoryActiveRunExecutions: number;
  persistedRunningRuns: number;
}): number {
  const maxLocalActiveRunExecutions = Math.max(1, Math.floor(input.maxLocalActiveRunExecutions));
  const inMemoryActiveRunExecutions = Math.max(0, Math.floor(input.inMemoryActiveRunExecutions));
  const persistedRunningRuns = Math.max(0, Math.floor(input.persistedRunningRuns));
  const occupiedSlots = Math.max(inMemoryActiveRunExecutions, persistedRunningRuns);
  return Math.max(0, maxLocalActiveRunExecutions - occupiedSlots);
}
