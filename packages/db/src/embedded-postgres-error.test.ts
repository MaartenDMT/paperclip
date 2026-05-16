import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEmbeddedPostgresLogBuffer, formatEmbeddedPostgresError } from "./embedded-postgres-error.js";
import {
  shouldRecoverEmbeddedPostgresStartError,
  startEmbeddedPostgresWithRecovery,
} from "./embedded-postgres-runtime.js";

describe("formatEmbeddedPostgresError", () => {
  it("adds a shared-memory hint when initdb logs expose the real cause", () => {
    const error = formatEmbeddedPostgresError("Postgres init script exited with code 1.", {
      fallbackMessage: "Failed to initialize embedded PostgreSQL cluster",
      recentLogs: [
        "running bootstrap script ...",
        "FATAL:  could not create shared memory segment: Cannot allocate memory",
        "DETAIL:  Failed system call was shmget(key=123, size=56, 03600).",
      ],
    });

    expect(error.message).toContain("could not allocate shared memory");
    expect(error.message).toContain("kern.sysv.shm");
    expect(error.message).toContain("could not create shared memory segment");
  });

  it("keeps only recent non-empty log lines in the collector", () => {
    const buffer = createEmbeddedPostgresLogBuffer(2);
    buffer.append("line one\n\n");
    buffer.append("line two");
    buffer.append("line three");

    expect(buffer.getRecentLogs()).toEqual(["line two", "line three"]);
  });

  it("adds a stale-process hint for Windows shared-memory leftovers", () => {
    const error = formatEmbeddedPostgresError("Postgres init script exited with code 1.", {
      fallbackMessage: "Failed to start embedded PostgreSQL",
      recentLogs: [
        "The system cannot find the path specified.",
        "FATAL:  pre-existing shared memory block is still in use",
        "HINT:  Check if there are any old server processes still running, and terminate them.",
      ],
    });

    expect(error.message).toContain("stale shared-memory block");
    expect(error.message).toContain("terminating the stale process tree");
    expect(error.message).toContain("pre-existing shared memory block is still in use");
  });
});

describe("shouldRecoverEmbeddedPostgresStartError", () => {
  it("recognizes stale-process startup failures that merit one cleanup retry", () => {
    expect(
      shouldRecoverEmbeddedPostgresStartError("startup failed", [
        "FATAL:  pre-existing shared memory block is still in use",
        "HINT:  Check if there are any old server processes still running, and terminate them.",
      ]),
    ).toBe(true);
  });

  it("does not retry unrelated startup failures", () => {
    expect(
      shouldRecoverEmbeddedPostgresStartError("startup failed", [
        "FATAL:  data directory has wrong ownership",
      ]),
    ).toBe(false);
  });
});

describe("startEmbeddedPostgresWithRecovery", () => {
  it("keeps postmaster.pid in place while the recorded pid is still running", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paperclip-embedded-postgres-"));
    const postmasterPidFile = path.join(tempDir, "postmaster.pid");
    writeFileSync(postmasterPidFile, `${process.pid}\n`);

    try {
      let startCalls = 0;
      const instance = {
        async start() {
          startCalls += 1;
        },
      };

      await startEmbeddedPostgresWithRecovery({
        instance,
        postmasterPidFile,
        getRecentLogs: () => [],
      });

      expect(startCalls).toBe(1);
      expect(readFileSync(postmasterPidFile, "utf8")).toContain(String(process.pid));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("terminates the stale process tree and retries once for Windows shared-memory leftovers", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paperclip-embedded-postgres-"));
    const postmasterPidFile = path.join(tempDir, "postmaster.pid");
    writeFileSync(postmasterPidFile, "4242\n");

    try {
      let startCalls = 0;
      let terminatedPid: number | null = null;
      const recoveredMessages: string[] = [];
      const instance = {
        async start() {
          startCalls += 1;
          if (startCalls === 1) {
            throw new Error("startup failed");
          }
        },
      };

      await startEmbeddedPostgresWithRecovery({
        instance,
        postmasterPidFile,
        getRecentLogs: () => [
          "FATAL:  pre-existing shared memory block is still in use",
          "HINT:  Check if there are any old server processes still running, and terminate them.",
        ],
        findCandidateProcessPids: async () => [],
        terminateProcessTree: async (pid) => {
          terminatedPid = pid;
          return true;
        },
        onRecovered: (message) => recoveredMessages.push(message),
      });

      expect(startCalls).toBe(2);
      expect(terminatedPid).toBe(4242);
      expect(recoveredMessages[0]).toContain("4242");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to data-dir process discovery when postmaster.pid is already missing", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paperclip-embedded-postgres-"));
    const postmasterPidFile = path.join(tempDir, "postmaster.pid");

    try {
      let startCalls = 0;
      const terminatedPids: number[] = [];
      let discoveryCalls = 0;
      const instance = {
        async start() {
          startCalls += 1;
          if (startCalls === 1) {
            throw new Error("startup failed");
          }
        },
      };

      await startEmbeddedPostgresWithRecovery({
        instance,
        postmasterPidFile,
        getRecentLogs: () => [
          "FATAL:  pre-existing shared memory block is still in use",
          "HINT:  Check if there are any old server processes still running, and terminate them.",
        ],
        findCandidateProcessPids: async () => {
          discoveryCalls += 1;
          return discoveryCalls === 1 ? [54321] : [];
        },
        terminateProcessTree: async (pid) => {
          terminatedPids.push(pid);
          return true;
        },
      });

      expect(startCalls).toBe(2);
      expect(terminatedPids).toEqual([54321]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not retry unrelated startup failures", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paperclip-embedded-postgres-"));
    const postmasterPidFile = path.join(tempDir, "postmaster.pid");
    writeFileSync(postmasterPidFile, "4242\n");

    try {
      let startCalls = 0;
      let terminateCalls = 0;
      const instance = {
        async start() {
          startCalls += 1;
          throw new Error("startup failed");
        },
      };

      await expect(
        startEmbeddedPostgresWithRecovery({
          instance,
          postmasterPidFile,
          getRecentLogs: () => ["FATAL: data directory has wrong ownership"],
          terminateProcessTree: async () => {
            terminateCalls += 1;
            return true;
          },
        }),
      ).rejects.toThrow("startup failed");
      expect(startCalls).toBe(1);
      expect(terminateCalls).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
