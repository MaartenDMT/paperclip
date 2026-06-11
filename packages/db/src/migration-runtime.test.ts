import { describe, expect, it, vi } from "vitest";
import {
  isEmbeddedPostgresStartupTransientError,
  selectEmbeddedPostgresStartPort,
  waitForEmbeddedPostgresReady,
} from "./migration-runtime.js";

describe("isEmbeddedPostgresStartupTransientError", () => {
  it("treats startup connection churn as transient", () => {
    expect(isEmbeddedPostgresStartupTransientError(new Error("write CONNECT_TIMEOUT 127.0.0.1:54329"))).toBe(true);
    expect(isEmbeddedPostgresStartupTransientError(new Error("write CONNECTION_ENDED 127.0.0.1:54329"))).toBe(true);
    expect(
      isEmbeddedPostgresStartupTransientError(Object.assign(new Error("read ECONNRESET"), {
        code: "ECONNRESET",
        syscall: "read",
      })),
    ).toBe(true);
    expect(isEmbeddedPostgresStartupTransientError(new Error("database system is not yet accepting connections"))).toBe(
      true,
    );
  });

  it("does not hide non-startup database errors", () => {
    expect(isEmbeddedPostgresStartupTransientError(new Error("password authentication failed"))).toBe(false);
  });
});

describe("selectEmbeddedPostgresStartPort", () => {
  it("keeps initialized embedded clusters on the configured port", () => {
    expect(
      selectEmbeddedPostgresStartPort({
        clusterAlreadyInitialized: true,
        preferredPort: 54421,
        preferredAvailablePort: 54422,
      }),
    ).toBe(54421);
  });

  it("uses the available port for a fresh embedded cluster", () => {
    expect(
      selectEmbeddedPostgresStartPort({
        clusterAlreadyInitialized: false,
        preferredPort: 54421,
        preferredAvailablePort: 54422,
      }),
    ).toBe(54422);
  });
});

describe("waitForEmbeddedPostgresReady", () => {
  it("waits through transient startup errors until postgres becomes ready", async () => {
    let calls = 0;
    const ensureDatabase = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("write CONNECTION_ENDED 127.0.0.1:54329");
      }
      return "exists" as const;
    });

    await expect(
      waitForEmbeddedPostgresReady({
        adminConnectionString: "postgres://paperclip:paperclip@127.0.0.1:54329/postgres",
        ensureDatabase,
        timeoutMs: 50,
        pollMs: 1,
      }),
    ).resolves.toBe(true);
    expect(ensureDatabase).toHaveBeenCalledTimes(3);
  });

  it("waits through connection resets while verifying the target database", async () => {
    const ensureDatabase = vi.fn(async () => "exists" as const);
    let verifyCalls = 0;
    const verifyConnection = vi.fn(async () => {
      verifyCalls += 1;
      if (verifyCalls < 2) {
        throw Object.assign(new Error("read ECONNRESET"), {
          code: "ECONNRESET",
          syscall: "read",
        });
      }
    });

    await expect(
      waitForEmbeddedPostgresReady({
        adminConnectionString: "postgres://paperclip:paperclip@127.0.0.1:54329/postgres",
        targetConnectionString: "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip",
        ensureDatabase,
        verifyConnection,
        timeoutMs: 5,
        stabilityGraceMs: 3,
        pollMs: 1,
      }),
    ).resolves.toBe(true);
    expect(ensureDatabase).toHaveBeenCalledTimes(1);
    expect(verifyConnection.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("returns false when transient startup churn outlasts the grace window", async () => {
    const ensureDatabase = vi.fn(async () => {
      throw new Error("write CONNECT_TIMEOUT 127.0.0.1:54329");
    });

    await expect(
      waitForEmbeddedPostgresReady({
        adminConnectionString: "postgres://paperclip:paperclip@127.0.0.1:54329/postgres",
        ensureDatabase,
        timeoutMs: 5,
        pollMs: 1,
      }),
    ).resolves.toBe(false);
    expect(ensureDatabase).toHaveBeenCalled();
  });

  it("throws immediately for non-transient failures", async () => {
    const ensureDatabase = vi.fn(async () => {
      throw new Error("password authentication failed");
    });

    await expect(
      waitForEmbeddedPostgresReady({
        adminConnectionString: "postgres://paperclip:paperclip@127.0.0.1:54329/postgres",
        ensureDatabase,
        timeoutMs: 5,
        pollMs: 1,
      }),
    ).rejects.toThrow("password authentication failed");
    expect(ensureDatabase).toHaveBeenCalledTimes(1);
  });

  it("returns false when the target database drops during the stability window", async () => {
    const ensureDatabase = vi.fn(async () => "exists" as const);
    let verifyCalls = 0;
    const verifyConnection = vi.fn(async () => {
      verifyCalls += 1;
      if (verifyCalls >= 2) {
        throw new Error("connect ECONNREFUSED 127.0.0.1:54329");
      }
    });

    await expect(
      waitForEmbeddedPostgresReady({
        adminConnectionString: "postgres://paperclip:paperclip@127.0.0.1:54329/postgres",
        targetConnectionString: "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip",
        ensureDatabase,
        verifyConnection,
        timeoutMs: 5,
        stabilityGraceMs: 5,
        pollMs: 1,
      }),
    ).resolves.toBe(false);
    expect(ensureDatabase).toHaveBeenCalledTimes(1);
    expect(verifyConnection.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps probing until the target database survives the stability window", async () => {
    const ensureDatabase = vi.fn(async () => "exists" as const);
    const verifyConnection = vi.fn(async () => {});

    await expect(
      waitForEmbeddedPostgresReady({
        adminConnectionString: "postgres://paperclip:paperclip@127.0.0.1:54329/postgres",
        targetConnectionString: "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip",
        ensureDatabase,
        verifyConnection,
        timeoutMs: 5,
        stabilityGraceMs: 3,
        pollMs: 1,
      }),
    ).resolves.toBe(true);
    expect(ensureDatabase).toHaveBeenCalledTimes(1);
    expect(verifyConnection).toHaveBeenCalled();
  });
});
