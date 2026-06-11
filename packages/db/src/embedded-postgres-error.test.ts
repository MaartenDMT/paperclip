import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbeddedPostgresLogBuffer, formatEmbeddedPostgresError } from "./embedded-postgres-error.js";
import {
  readEmbeddedPostgresPostmasterPid,
  shouldRecoverEmbeddedPostgresStartError,
  startEmbeddedPostgresWithRecovery,
} from "./embedded-postgres-runtime.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("recognizes stale postmaster.pid lock failures that merit cleanup", () => {
    expect(
      shouldRecoverEmbeddedPostgresStartError("startup failed", [
        "FATAL:  lock file \"postmaster.pid\" already exists",
        "HINT:  Is another postmaster (PID 60180) running in data directory \"D:/WindowsData/paperclip/instances/default/db\"?",
      ]),
    ).toBe(true);
  });

  it("recognizes Windows EPERM access failures on stale postmaster.pid", () => {
    expect(
      shouldRecoverEmbeddedPostgresStartError(
        "EPERM, Permission denied: \\\\?\\D:\\WindowsData\\paperclip\\instances\\default\\db\\postmaster.pid '\\\\?\\D:\\WindowsData\\paperclip\\instances\\default\\db\\postmaster.pid'",
        [],
      ),
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

describe("readEmbeddedPostgresPostmasterPid", () => {
  it("treats EPERM from pid probing as a live process", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paperclip-embedded-postgres-"));
    const postmasterPidFile = path.join(tempDir, "postmaster.pid");
    writeFileSync(postmasterPidFile, "4242\n");

    try {
      vi.spyOn(process, "kill").mockImplementation((() => {
        const error = new Error("operation not permitted") as Error & { code: string };
        error.code = "EPERM";
        throw error;
      }) as typeof process.kill);

      expect(readEmbeddedPostgresPostmasterPid(postmasterPidFile)).toBe(4242);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("still treats missing pids as not running", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paperclip-embedded-postgres-"));
    const postmasterPidFile = path.join(tempDir, "postmaster.pid");
    writeFileSync(postmasterPidFile, "4242\n");

    try {
      vi.spyOn(process, "kill").mockImplementation((() => {
        const error = new Error("missing process") as Error & { code: string };
        error.code = "ESRCH";
        throw error;
      }) as typeof process.kill);

      expect(readEmbeddedPostgresPostmasterPid(postmasterPidFile)).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
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

  it("recovers when only a stale postmaster.pid remains and no conflicting postgres pid is live", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paperclip-embedded-postgres-"));
    const postmasterPidFile = path.join(tempDir, "postmaster.pid");
    writeFileSync(postmasterPidFile, "60180\n");

    try {
      let startCalls = 0;
      const terminatedPids: number[] = [];
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
          "The system cannot find the path specified.",
          "FATAL:  lock file \"postmaster.pid\" already exists",
          "HINT:  Is another postmaster (PID 60180) running in data directory \"D:/WindowsData/paperclip/instances/default/db\"?",
        ],
        findCandidateProcessPids: async () => [],
        terminateProcessTree: async (pid) => {
          terminatedPids.push(pid);
          return false;
        },
        onRecovered: (message) => recoveredMessages.push(message),
      });

      expect(startCalls).toBe(2);
      expect(terminatedPids).toEqual([60180]);
      expect(recoveredMessages).toHaveLength(1);
      expect(readEmbeddedPostgresPostmasterPid(postmasterPidFile, { requireRunning: false })).toBeNull();
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

  it("terminates postgres forkchildren that outlive the stale parent pid", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paperclip-embedded-postgres-"));
    const postmasterPidFile = path.join(tempDir, "postmaster.pid");
    writeFileSync(postmasterPidFile, "44840\n");

    try {
      let startCalls = 0;
      let relatedProcessLookups = 0;
      const terminatedPids: number[] = [];
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
        findRelatedProcessTreePids: async (rootPids) => {
          relatedProcessLookups += 1;
          return relatedProcessLookups === 1 && Array.from(rootPids).includes(44840)
            ? [11372]
            : [];
        },
        terminateProcessTree: async (pid) => {
          terminatedPids.push(pid);
          return true;
        },
      });

      expect(startCalls).toBe(2);
      expect(terminatedPids).toEqual([44840, 11372]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("recovers when start hangs after writing a stale postmaster.pid", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paperclip-embedded-postgres-"));
    const postmasterPidFile = path.join(tempDir, "postmaster.pid");

    try {
      let startCalls = 0;
      const terminatedPids: number[] = [];
      const instance = {
        async start() {
          startCalls += 1;
          if (startCalls === 1) {
            writeFileSync(postmasterPidFile, "4242\n");
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
        },
      };

      await startEmbeddedPostgresWithRecovery({
        instance,
        postmasterPidFile,
        getRecentLogs: () => [],
        findCandidateProcessPids: async () => [],
        terminateProcessTree: async (pid) => {
          terminatedPids.push(pid);
          return true;
        },
        startTimeoutMs: 5,
      });

      expect(startCalls).toBe(2);
      expect(terminatedPids).toEqual([4242]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("retries recovery more than once when cleanup reveals a second stale postgres pid", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paperclip-embedded-postgres-"));
    const postmasterPidFile = path.join(tempDir, "postmaster.pid");
    writeFileSync(postmasterPidFile, "4242\n");

    try {
      let startCalls = 0;
      const terminatedPids: number[] = [];
      let discoveryCalls = 0;
      const recoveredMessages: string[] = [];
      const instance = {
        async start() {
          startCalls += 1;
          if (startCalls === 1) {
            throw new Error("startup failed");
          }
          if (startCalls === 2) {
            writeFileSync(postmasterPidFile, "4343\n");
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
          return discoveryCalls === 2 ? [4343] : [];
        },
        terminateProcessTree: async (pid) => {
          terminatedPids.push(pid);
          return true;
        },
        onRecovered: (message) => recoveredMessages.push(message),
      });

      expect(startCalls).toBe(3);
      expect(terminatedPids).toEqual([4242, 4343]);
      expect(recoveredMessages).toHaveLength(2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("continues cleanup when terminating one stale postgres pid reveals another before restart", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paperclip-embedded-postgres-"));
    const postmasterPidFile = path.join(tempDir, "postmaster.pid");
    writeFileSync(postmasterPidFile, "4242\n");

    try {
      let startCalls = 0;
      const livePids = new Set([4242, 4343]);
      let firstDiscovery = true;
      const terminatedPids: number[] = [];
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
          "FATAL:  lock file \"postmaster.pid\" already exists",
          "HINT:  Is another postmaster (PID 4242) running in data directory \"D:/WindowsData/paperclip/instances/default/db\"?",
        ],
        findCandidateProcessPids: async () => {
          if (firstDiscovery) {
            firstDiscovery = false;
            return livePids.has(4242) ? [4242] : [];
          }
          return Array.from(livePids);
        },
        terminateProcessTree: async (pid) => {
          terminatedPids.push(pid);
          livePids.delete(pid);
          return true;
        },
        onRecovered: (message) => recoveredMessages.push(message),
      });

      expect(startCalls).toBe(2);
      expect(terminatedPids).toEqual([4242, 4343]);
      expect(recoveredMessages).toHaveLength(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not claim recovery when a conflicting postgres pid remains alive", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paperclip-embedded-postgres-"));
    const postmasterPidFile = path.join(tempDir, "postmaster.pid");
    writeFileSync(postmasterPidFile, "4242\n");

    try {
      let startCalls = 0;
      let discoveryCalls = 0;
      const recoveredMessages: string[] = [];
      const terminatedPids: number[] = [];
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
          getRecentLogs: () => [
            "FATAL:  pre-existing shared memory block is still in use",
            "HINT:  Check if there are any old server processes still running, and terminate them.",
          ],
          findCandidateProcessPids: async () => {
            discoveryCalls += 1;
            return discoveryCalls >= 2 ? [4242] : [4242, 4343];
          },
          terminateProcessTree: async (pid) => {
            terminatedPids.push(pid);
            return pid === 4343;
          },
          onRecovered: (message) => recoveredMessages.push(message),
        }),
      ).rejects.toThrow("embedded postgres recovery could not clear conflicting process tree(s): 4242");

      expect(startCalls).toBe(1);
      expect(terminatedPids).toEqual([4242, 4343]);
      expect(recoveredMessages).toHaveLength(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30000);

  it("allows additional recovery passes when Windows cleanup needs more than two retries", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paperclip-embedded-postgres-"));
    const postmasterPidFile = path.join(tempDir, "postmaster.pid");
    writeFileSync(postmasterPidFile, "4242\n");

    try {
      let startCalls = 0;
      const terminatedPids: number[] = [];
      const instance = {
        async start() {
          startCalls += 1;
          if (startCalls <= 4) {
            writeFileSync(postmasterPidFile, `${4241 + startCalls}\n`);
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
          terminatedPids.push(pid);
          return true;
        },
      });

      expect(startCalls).toBe(5);
      expect(terminatedPids).toEqual([4242, 4243, 4244, 4245]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30000);

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
