import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  doesCommandLineMatchLocalServiceRecord,
  pruneStaleLocalServiceRegistryRecords,
  removeLocalServiceRegistryRecord,
  type LocalServiceRegistryRecord,
} from "../services/local-service-supervisor.js";

describe("local service supervisor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not fail dev startup when Windows refuses stale registry cleanup", async () => {
    const error = Object.assign(new Error("operation not permitted"), {
      code: "EPERM",
      syscall: "unlink",
    });
    const rm = vi.spyOn(fs, "rm").mockRejectedValueOnce(error);

    await expect(removeLocalServiceRegistryRecord("paperclip-dev-test")).resolves.toBeUndefined();
    expect(rm).toHaveBeenCalledOnce();
  });

  it("still reports unexpected registry cleanup failures", async () => {
    const error = Object.assign(new Error("unexpected failure"), {
      code: "EIO",
      syscall: "unlink",
    });
    vi.spyOn(fs, "rm").mockRejectedValueOnce(error);

    await expect(removeLocalServiceRegistryRecord("paperclip-dev-test")).rejects.toMatchObject({
      code: "EIO",
    });
  });

  it("prunes dead local service registry records before reporting active services", async () => {
    const activeRecord = createRegistryRecord({
      serviceKey: "paperclip-dev-active",
      serviceName: "node",
      pid: process.pid,
    });
    const staleRecord = createRegistryRecord({ serviceKey: "paperclip-dev-stale", pid: 9_999_999 });

    vi.spyOn(fs, "readdir").mockResolvedValueOnce([
      { isFile: () => true, name: "paperclip-dev-active.json" },
      { isFile: () => true, name: "paperclip-dev-stale.json" },
    ] as never);
    vi.spyOn(fs, "readFile")
      .mockResolvedValueOnce(JSON.stringify(activeRecord) as never)
      .mockResolvedValueOnce(JSON.stringify(staleRecord) as never);
    const rm = vi.spyOn(fs, "rm").mockResolvedValue(undefined as never);

    const result = await pruneStaleLocalServiceRegistryRecords({
      profileKind: "paperclip-dev",
      metadata: { repoRoot: "A:\\Programming\\projects\\paperclip" },
    });

    expect(result.active.map((record) => record.serviceKey)).toEqual(["paperclip-dev-active"]);
    expect(result.stale.map((record) => record.serviceKey)).toEqual(["paperclip-dev-stale"]);
    expect(rm).toHaveBeenCalledOnce();
    expect(String(rm.mock.calls[0]?.[0])).toContain("paperclip-dev-stale.json");
  });

  it("matches recorded services against normalized command lines", () => {
    expect(
      doesCommandLineMatchLocalServiceRecord(`node "scripts/dev-runner.ts" watch`, {
        command: "node scripts/dev-runner.ts watch",
        serviceName: "paperclip-dev-watch",
      }),
    ).toBe(true);

    expect(
      doesCommandLineMatchLocalServiceRecord("node unrelated-worker.js", {
        command: "node scripts/dev-runner.ts watch",
        serviceName: "paperclip-dev-watch",
      }),
    ).toBe(false);
  });
});

function createRegistryRecord(overrides: Partial<LocalServiceRegistryRecord>): LocalServiceRegistryRecord {
  return {
    version: 1,
    serviceKey: "paperclip-dev-test",
    profileKind: "paperclip-dev",
    serviceName: "paperclip-dev-watch",
    command: "node scripts/dev-runner.ts watch",
    cwd: "A:\\Programming\\projects\\paperclip",
    envFingerprint: "test",
    port: 3100,
    url: "http://127.0.0.1:3100",
    pid: 1,
    processGroupId: null,
    provider: "local_process",
    runtimeServiceId: null,
    reuseKey: null,
    startedAt: "2026-05-29T00:00:00.000Z",
    lastSeenAt: "2026-05-29T00:00:00.000Z",
    metadata: { repoRoot: "A:\\Programming\\projects\\paperclip" },
    ...overrides,
  };
}
