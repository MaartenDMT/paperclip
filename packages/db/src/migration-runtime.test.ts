import { describe, expect, it, vi } from "vitest";
import {
  isEmbeddedPostgresStartupTransientError,
  waitForEmbeddedPostgresReady,
} from "./migration-runtime.js";

describe("isEmbeddedPostgresStartupTransientError", () => {
  it("treats startup connection churn as transient", () => {
    expect(isEmbeddedPostgresStartupTransientError(new Error("write CONNECT_TIMEOUT 127.0.0.1:54329"))).toBe(true);
    expect(isEmbeddedPostgresStartupTransientError(new Error("write CONNECTION_ENDED 127.0.0.1:54329"))).toBe(true);
    expect(isEmbeddedPostgresStartupTransientError(new Error("database system is not yet accepting connections"))).toBe(
      true,
    );
  });

  it("does not hide non-startup database errors", () => {
    expect(isEmbeddedPostgresStartupTransientError(new Error("password authentication failed"))).toBe(false);
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
});
