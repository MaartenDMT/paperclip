// OS-process lifecycle helpers extracted from heartbeat.ts.
//
// These check whether a pid is still alive, terminate a run's process (and its
// process group), and build the human-readable "process lost" message used when
// the server loses track of a local execution. Side-effecting only through the
// OS / local-service supervisor; they hold no heartbeat state.

import { terminateLocalService } from "../local-service-supervisor.js";

export function isProcessAlive(pid: number | null | undefined) {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "EPERM") return true;
    if (code === "ESRCH") return false;
    return false;
  }
}

export async function terminateHeartbeatRunProcess(input: {
  pid: number | null | undefined;
  processGroupId: number | null | undefined;
  graceMs?: number;
}) {
  const pid = input.pid ?? null;
  const processGroupId = input.processGroupId ?? null;
  const normalizedPid = typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null;
  const normalizedProcessGroupId =
    typeof processGroupId === "number" && Number.isInteger(processGroupId) && processGroupId > 0
      ? processGroupId
      : null;
  if (normalizedPid === null && normalizedProcessGroupId === null) return;

  await terminateLocalService(
    {
      // Detached cleanup must still kill pid-only orphans when no process group persisted.
      pid: normalizedPid ?? normalizedProcessGroupId ?? 0,
      processGroupId: normalizedProcessGroupId,
    },
    input.graceMs ? { forceAfterMs: input.graceMs } : undefined,
  );
}

export function buildProcessLossMessage(run: {
  processPid: number | null;
  processGroupId: number | null;
}, options?: {
  descendantOnly?: boolean;
  criticallySilentDetachedChild?: boolean;
  criticallySilentTrackedChild?: boolean;
  staleActiveWithoutTrackedChild?: boolean;
}) {
  if (options?.staleActiveWithoutTrackedChild) {
    return "Process lost -- active local execution exceeded the startup timeout before recording process metadata";
  }
  if (options?.criticallySilentDetachedChild && run.processPid) {
    return `Process lost -- child pid ${run.processPid} was still alive after the server lost its in-memory handle, but the run was critically silent and the process was terminated`;
  }
  if (options?.criticallySilentTrackedChild && run.processPid) {
    return `Process lost -- child pid ${run.processPid} remained tracked by the server, but the run was critically silent and the process was terminated`;
  }
  if (options?.descendantOnly && run.processGroupId) {
    return `Process lost -- parent pid ${run.processPid ?? "unknown"} exited, but descendant process group ${run.processGroupId} was still alive and was terminated`;
  }
  if (run.processPid) {
    return `Process lost -- child pid ${run.processPid} is no longer running`;
  }
  if (run.processGroupId) {
    return `Process lost -- process group ${run.processGroupId} is no longer running`;
  }
  return "Process lost -- server may have restarted";
}
