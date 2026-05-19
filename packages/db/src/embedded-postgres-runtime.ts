import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_EMBEDDED_POSTGRES_START_TIMEOUT_MS = 60_000;
const MAX_EMBEDDED_POSTGRES_START_RECOVERY_ATTEMPTS = 2;

type EmbeddedPostgresInstance = {
  start(): Promise<void>;
};

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "EPERM"
    ) {
      return true;
    }
    return false;
  }
}

export function readEmbeddedPostgresPostmasterPid(
  postmasterPidFile: string,
  opts?: { requireRunning?: boolean },
): number | null {
  if (!existsSync(postmasterPidFile)) return null;
  try {
    const pid = Number(readFileSync(postmasterPidFile, "utf8").split("\n")[0]?.trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    if (opts?.requireRunning === false) {
      return pid;
    }
    return isPidRunning(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function readEmbeddedPostgresPostmasterPort(postmasterPidFile: string): number | null {
  if (!existsSync(postmasterPidFile)) return null;
  try {
    const lines = readFileSync(postmasterPidFile, "utf8").split("\n");
    const port = Number(lines[3]?.trim());
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export function readEmbeddedPostgresConfiguredPort(postmasterOptionsFile: string): number | null {
  if (!existsSync(postmasterOptionsFile)) return null;
  try {
    const content = readFileSync(postmasterOptionsFile, "utf8");
    const match = content.match(/"-p"\s+"(\d+)"/);
    if (!match) return null;
    const port = Number(match[1]);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export function shouldRecoverEmbeddedPostgresStartError(
  error: unknown,
  recentLogs: string[],
): boolean {
  const errorMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error ?? "");
  const haystack = `${errorMessage}\n${recentLogs.join("\n")}`.toLowerCase();

  return (
    haystack.includes("pre-existing shared memory block is still in use") ||
    haystack.includes("check if there are any old server processes still running") ||
    haystack.includes("another server might be running")
  );
}

async function terminatePidTree(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]);
      return true;
    } catch {
      return !isPidRunning(pid);
    }
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }

  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) {
      return true;
    }
    await delay(100);
  }

  if (!isPidRunning(pid)) {
    return true;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return !isPidRunning(pid);
  }

  return !isPidRunning(pid);
}

async function findWindowsEmbeddedPostgresPidsForDataDir(dataDir: string): Promise<number[]> {
  const escapedDataDir = dataDir.replace(/'/g, "''");
  const script = [
    `$dataDir = '${escapedDataDir}'`,
    "Get-CimInstance Win32_Process",
    " | Where-Object { $_.Name -eq 'postgres.exe' -and $_.CommandLine -like \"*$dataDir*\" }",
    " | Select-Object -ExpandProperty ProcessId",
  ].join("");

  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
      windowsHide: true,
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function findWindowsListeningProcessPids(port: number): Promise<number[]> {
  const script = [
    "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue",
    ` | Where-Object { $_.LocalPort -eq ${port} }`,
    " | Select-Object -ExpandProperty OwningProcess",
  ].join("");

  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
      windowsHide: true,
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function findEmbeddedPostgresProcessPidsForDataDir(dataDir: string): Promise<number[]> {
  if (process.platform === "win32") {
    const candidatePids = new Set<number>();
    for (const pid of await findWindowsEmbeddedPostgresPidsForDataDir(dataDir)) {
      candidatePids.add(pid);
    }

    const configuredPort = readEmbeddedPostgresConfiguredPort(path.join(dataDir, "postmaster.opts"));
    if (configuredPort) {
      for (const pid of await findWindowsListeningProcessPids(configuredPort)) {
        candidatePids.add(pid);
      }
    }

    return Array.from(candidatePids);
  }

  return [];
}

async function waitForEmbeddedPostgresProcessCleanup(
  dataDir: string,
  findCandidateProcessPids: (dataDir: string) => Promise<number[]>,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const remaining = await findCandidateProcessPids(dataDir);
    if (remaining.length === 0) {
      return;
    }
    await delay(250);
  }
}

function resolveStartTimeoutMs(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_EMBEDDED_POSTGRES_START_TIMEOUT_MS;
}

async function startWithTimeout(
  instance: EmbeddedPostgresInstance,
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      instance.start(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`embedded PostgreSQL start timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function cleanupEmbeddedPostgresCandidates(input: {
  postmasterPidFile: string;
  stalePid: number | null;
  terminateProcessTree: (pid: number) => Promise<boolean>;
  findCandidateProcessPids: (dataDir: string) => Promise<number[]>;
}): Promise<{ candidatePids: number[]; terminatedAny: boolean }> {
  const dataDir = path.dirname(input.postmasterPidFile);
  const candidatePids = new Set<number>();
  if (input.stalePid) {
    candidatePids.add(input.stalePid);
  }
  for (const pid of await input.findCandidateProcessPids(dataDir)) {
    candidatePids.add(pid);
  }

  let terminatedAny = false;
  for (const pid of candidatePids) {
    const terminated = await input.terminateProcessTree(pid);
    terminatedAny ||= terminated;
  }
  if (existsSync(input.postmasterPidFile)) {
    rmSync(input.postmasterPidFile, { force: true });
  }
  if (terminatedAny) {
    await waitForEmbeddedPostgresProcessCleanup(dataDir, input.findCandidateProcessPids);
  }

  return {
    candidatePids: Array.from(candidatePids),
    terminatedAny,
  };
}

export async function startEmbeddedPostgresWithRecovery(input: {
  instance: EmbeddedPostgresInstance;
  postmasterPidFile: string;
  getRecentLogs: () => string[];
  onRecovered?: (message: string) => void;
  terminateProcessTree?: (pid: number) => Promise<boolean>;
  findCandidateProcessPids?: (dataDir: string) => Promise<number[]>;
  startTimeoutMs?: number;
}): Promise<void> {
  const initialStalePid = readEmbeddedPostgresPostmasterPid(input.postmasterPidFile, { requireRunning: false });
  const runningPid = readEmbeddedPostgresPostmasterPid(input.postmasterPidFile);
  if (!runningPid && existsSync(input.postmasterPidFile)) {
    rmSync(input.postmasterPidFile, { force: true });
  }
  const startTimeoutMs =
    input.startTimeoutMs ?? resolveStartTimeoutMs(process.env.PAPERCLIP_EMBEDDED_POSTGRES_START_TIMEOUT_MS);
  const findCandidateProcessPids =
    input.findCandidateProcessPids ?? findEmbeddedPostgresProcessPidsForDataDir;
  const terminateProcessTree = input.terminateProcessTree ?? terminatePidTree;
  for (let recoveryAttempt = 0; ; recoveryAttempt += 1) {
    try {
      await startWithTimeout(input.instance, startTimeoutMs);
      return;
    } catch (error) {
      const recentLogs = input.getRecentLogs();
      const timedOut = error instanceof Error && error.message.includes("start timed out");
      if (!timedOut && !shouldRecoverEmbeddedPostgresStartError(error, recentLogs)) {
        throw error;
      }
      if (recoveryAttempt >= MAX_EMBEDDED_POSTGRES_START_RECOVERY_ATTEMPTS) {
        throw error;
      }

      const cleanup = await cleanupEmbeddedPostgresCandidates({
        postmasterPidFile: input.postmasterPidFile,
        stalePid:
          recoveryAttempt === 0
            ? initialStalePid ?? readEmbeddedPostgresPostmasterPid(input.postmasterPidFile, { requireRunning: false })
            : readEmbeddedPostgresPostmasterPid(input.postmasterPidFile, { requireRunning: false }),
        findCandidateProcessPids,
        terminateProcessTree,
      });
      if (cleanup.candidatePids.length === 0) {
        throw error;
      }
      if (!cleanup.terminatedAny) {
        throw error;
      }

      input.onRecovered?.(
        `Recovered embedded PostgreSQL startup by terminating stale postgres process tree(s): ${cleanup.candidatePids.join(", ")}.`,
      );
    }
  }
}
