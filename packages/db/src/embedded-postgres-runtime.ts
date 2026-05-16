import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type EmbeddedPostgresInstance = {
  start(): Promise<void>;
};

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
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

export async function startEmbeddedPostgresWithRecovery(input: {
  instance: EmbeddedPostgresInstance;
  postmasterPidFile: string;
  getRecentLogs: () => string[];
  onRecovered?: (message: string) => void;
  terminateProcessTree?: (pid: number) => Promise<boolean>;
  findCandidateProcessPids?: (dataDir: string) => Promise<number[]>;
}): Promise<void> {
  const stalePid = readEmbeddedPostgresPostmasterPid(input.postmasterPidFile, { requireRunning: false });
  const runningPid = readEmbeddedPostgresPostmasterPid(input.postmasterPidFile);
  if (!runningPid && existsSync(input.postmasterPidFile)) {
    rmSync(input.postmasterPidFile, { force: true });
  }

  try {
    await input.instance.start();
    return;
  } catch (error) {
    const recentLogs = input.getRecentLogs();
    if (!shouldRecoverEmbeddedPostgresStartError(error, recentLogs)) {
      throw error;
    }

    const dataDir = path.dirname(input.postmasterPidFile);
    const candidatePids = new Set<number>();
    if (stalePid) {
      candidatePids.add(stalePid);
    }
    const findCandidateProcessPids =
      input.findCandidateProcessPids ?? findEmbeddedPostgresProcessPidsForDataDir;
    for (const pid of await findCandidateProcessPids(dataDir)) {
      candidatePids.add(pid);
    }
    if (candidatePids.size === 0) {
      throw error;
    }

    let terminatedAny = false;
    for (const pid of candidatePids) {
      const terminated = await (input.terminateProcessTree ?? terminatePidTree)(pid);
      terminatedAny ||= terminated;
    }
    if (existsSync(input.postmasterPidFile)) {
      rmSync(input.postmasterPidFile, { force: true });
    }
    if (!terminatedAny) {
      throw error;
    }

    await waitForEmbeddedPostgresProcessCleanup(dataDir, findCandidateProcessPids);
    input.onRecovered?.(
      `Recovered embedded PostgreSQL startup by terminating stale postgres process tree(s): ${Array.from(candidatePids).join(", ")}.`,
    );
    await input.instance.start();
  }
}
