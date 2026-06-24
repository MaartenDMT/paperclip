import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ORIGINAL_PAPERCLIP_CONFIG = process.env.PAPERCLIP_CONFIG;

async function loadConfigFileModule(configPath: string) {
  vi.resetModules();
  process.env.PAPERCLIP_CONFIG = configPath;
  return await import("./config-file.js");
}

afterEach(() => {
  if (ORIGINAL_PAPERCLIP_CONFIG === undefined) {
    delete process.env.PAPERCLIP_CONFIG;
  } else {
    process.env.PAPERCLIP_CONFIG = ORIGINAL_PAPERCLIP_CONFIG;
  }
  vi.resetModules();
});

describe("readConfigFile", () => {
  it("returns null when the configured file is missing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-config-file-"));
    try {
      const { readConfigFile } = await loadConfigFileModule(path.join(tempDir, "missing.json"));

      expect(readConfigFile()).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when a configured file exists but is invalid", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-config-file-"));
    try {
      const configPath = path.join(tempDir, "config.json");
      await writeFile(configPath, JSON.stringify({ $meta: { version: 1, updatedAt: "2026-06-22T00:00:00.000Z", source: "invalid" } }), "utf8");
      const { readConfigFile } = await loadConfigFileModule(configPath);

      expect(() => readConfigFile()).toThrow(/Invalid Paperclip config/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
