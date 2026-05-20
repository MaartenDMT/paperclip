import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { removeLocalServiceRegistryRecord } from "../services/local-service-supervisor.js";

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
});
