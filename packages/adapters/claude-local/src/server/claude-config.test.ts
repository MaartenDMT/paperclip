import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareClaudeConfigSeed, prepareClaudeRuntimeConfigDir } from "./claude-config.js";

describe("prepareClaudeConfigSeed", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  function createEnv(root: string, sourceDir: string): NodeJS.ProcessEnv {
    return {
      HOME: root,
      PAPERCLIP_HOME: path.join(root, "paperclip-home"),
      PAPERCLIP_INSTANCE_ID: "test-instance",
      CLAUDE_CONFIG_DIR: sourceDir,
    };
  }

  it("reuses the same snapshot path when the seeded files are unchanged", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-config-seed-"));
    cleanupDirs.push(root);
    const sourceDir = path.join(root, "claude-source");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, "settings.json"), JSON.stringify({ theme: "light" }), "utf8");

    const onLog = vi.fn(async () => {});
    const env = createEnv(root, sourceDir);

    const first = await prepareClaudeConfigSeed(env, onLog, "company-1");
    const second = await prepareClaudeConfigSeed(env, onLog, "company-1");

    expect(first).toBe(second);
    await expect(fs.readFile(path.join(first, "settings.json"), "utf8"))
      .resolves.toBe(JSON.stringify({ theme: "light" }));
  });

  it("keeps an existing snapshot intact when the seeded files change", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-config-race-"));
    cleanupDirs.push(root);
    const sourceDir = path.join(root, "claude-source");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, "settings.json"), JSON.stringify({ theme: "light" }), "utf8");

    const onLog = vi.fn(async () => {});
    const env = createEnv(root, sourceDir);
    const first = await prepareClaudeConfigSeed(env, onLog, "company-1");

    await fs.writeFile(path.join(sourceDir, "settings.json"), JSON.stringify({ theme: "dark" }), "utf8");
    const second = await prepareClaudeConfigSeed(env, onLog, "company-1");

    expect(second).not.toBe(first);
    await expect(fs.readFile(path.join(first, "settings.json"), "utf8"))
      .resolves.toBe(JSON.stringify({ theme: "light" }));
    await expect(fs.readFile(path.join(second, "settings.json"), "utf8"))
      .resolves.toBe(JSON.stringify({ theme: "dark" }));
  });

  it("prepares mutable agent-scoped runtime config without copying shared project memory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-config-runtime-"));
    cleanupDirs.push(root);
    const sourceDir = path.join(root, "claude-source");
    await fs.mkdir(path.join(sourceDir, "projects", "shared"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "settings.json"), JSON.stringify({ hooks: [] }), "utf8");
    await fs.writeFile(path.join(sourceDir, "projects", "shared", "MEMORY.md"), "stale shared memory\n", "utf8");

    const onLog = vi.fn(async () => {});
    const env = createEnv(root, sourceDir);
    const runtimeDir = await prepareClaudeRuntimeConfigDir(env, onLog, "company-1", "agent-1");

    expect(runtimeDir).toContain(path.join("company-1", "claude-config-runtime", "agents", "agent-1"));
    await expect(fs.readFile(path.join(runtimeDir, "settings.json"), "utf8"))
      .resolves.toBe(JSON.stringify({ hooks: [] }));
    await expect(fs.access(path.join(runtimeDir, "projects", "shared", "MEMORY.md")))
      .rejects.toThrow();

    await fs.writeFile(path.join(runtimeDir, "agent-local.txt"), "keep\n", "utf8");
    await prepareClaudeRuntimeConfigDir(env, onLog, "company-1", "agent-1");
    await expect(fs.readFile(path.join(runtimeDir, "agent-local.txt"), "utf8"))
      .resolves.toBe("keep\n");
  });
});
