import os from "node:os";
import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalFileRunLogStore } from "../services/run-log-store.ts";
import { retryTransientFilesystemError } from "../services/transient-fs.ts";

describe("retryTransientFilesystemError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries transient EPERM failures until the operation succeeds", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error("locked"), { code: "EPERM" }))
      .mockRejectedValueOnce(Object.assign(new Error("still locked"), { code: "EPERM" }))
      .mockResolvedValue("ok");

    await expect(retryTransientFilesystemError(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-transient filesystem errors", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));

    await expect(retryTransientFilesystemError(operation)).rejects.toMatchObject({ code: "ENOENT" });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("createLocalFileRunLogStore", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0).map((dir) => fsPromises.rm(dir, { recursive: true, force: true })),
    );
  });

  it("creates and appends run log files", async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "paperclip-run-log-"));
    tempDirs.push(tempDir);
    const store = createLocalFileRunLogStore(tempDir);

    const handle = await store.begin({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "run-1",
    });

    expect(handle.logRef).toBe(path.join("company-1", "agent-1", "run-1.ndjson"));
    await expect(
      store.append(handle, {
        stream: "stdout",
        chunk: "hello",
        ts: "2026-05-21T17:00:00.000Z",
      }),
    ).resolves.toBeGreaterThan(0);

    await expect(
      fsPromises.readFile(path.join(tempDir, "company-1", "agent-1", "run-1.ndjson"), "utf8"),
    ).resolves.toContain("\"chunk\":\"hello\"");
  });
});
