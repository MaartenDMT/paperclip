import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";

const CHILD_TIMEOUT_MS = process.platform === "win32" ? 240_000 : 30_000;
const TEST_TIMEOUT_MS = process.platform === "win32" ? 270_000 : 40_000;

async function terminateProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => resolve());
      killer.on("exit", () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
}

describe("migration-status CLI", () => {
  it("exits after printing JSON status", async () => {
    const paperclipHome = await mkdtemp(path.join(tmpdir(), "paperclip-migration-status-"));
    const child = spawn(process.execPath, ["--import", "tsx", "packages/db/src/migration-status.ts", "--json"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PAPERCLIP_HOME: paperclipHome,
        PAPERCLIP_INSTANCE_ID: "migration-status-test",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    try {
      const result = await Promise.race([
        new Promise<{ timedOut: false; code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
          child.on("error", reject);
          child.on("exit", (code, signal) => resolve({ timedOut: false, code, signal }));
        }),
        delay(CHILD_TIMEOUT_MS).then(async () => {
          await terminateProcessTree(child.pid);
          return { timedOut: true as const, code: null, signal: null };
        }),
      ]);

      expect({ result, stdout, stderr }).toMatchObject({
        result: { timedOut: false, code: 0 },
      });
      expect(JSON.parse(stdout)).toMatchObject({
        status: expect.stringMatching(/^(upToDate|needsMigrations)$/),
      });
    } finally {
      await terminateProcessTree(child.pid);
      await rm(paperclipHome, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);
});
