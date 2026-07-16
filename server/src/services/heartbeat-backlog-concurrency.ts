const BACKLOG_BURST_QUEUE_THRESHOLD = 3;
const BACKLOG_BURST_MAX_CONCURRENT_RUNS = 2;

export function effectiveMaxConcurrentRunsForQueuedBacklog(
  configuredMaxConcurrentRuns: number,
  queuedRunCount: number,
) {
  const configured = Number.isFinite(configuredMaxConcurrentRuns)
    ? Math.max(1, Math.trunc(configuredMaxConcurrentRuns))
    : 1;
  if (queuedRunCount < BACKLOG_BURST_QUEUE_THRESHOLD) return configured;
  return Math.max(configured, BACKLOG_BURST_MAX_CONCURRENT_RUNS);
}
