import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareOpenCodeRuntimeConfig } from "./runtime-config.js";

const cleanupPaths = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...cleanupPaths].map(async (filepath) => {
      await fs.rm(filepath, { recursive: true, force: true });
      cleanupPaths.delete(filepath);
    }),
  );
});

async function makeConfigHome(initialConfig?: Record<string, unknown>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-test-"));
  cleanupPaths.add(root);
  const configDir = path.join(root, "opencode");
  await fs.mkdir(configDir, { recursive: true });
  if (initialConfig) {
    await fs.writeFile(
      path.join(configDir, "opencode.json"),
      `${JSON.stringify(initialConfig, null, 2)}\n`,
      "utf8",
    );
  }
  return root;
}

async function makeDataHome() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-data-test-"));
  cleanupPaths.add(root);
  await fs.mkdir(path.join(root, "opencode"), { recursive: true });
  return root;
}

describe("prepareOpenCodeRuntimeConfig", () => {
  it("injects an external_directory allow rule by default", async () => {
    const configHome = await makeConfigHome({
      permission: {
        read: "allow",
      },
      theme: "system",
    });
    const dataHome = await makeDataHome();
    const agentHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-agent-home-"));
    cleanupPaths.add(agentHome);
    await fs.writeFile(path.join(dataHome, "opencode", "auth.json"), "{\"provider\":\"ok\"}\n", "utf8");
    await fs.writeFile(path.join(dataHome, "opencode", "opencode.db"), "shared db must not be copied", "utf8");

    const prepared = await prepareOpenCodeRuntimeConfig({
      env: { XDG_CONFIG_HOME: configHome, XDG_DATA_HOME: dataHome, AGENT_HOME: agentHome },
      config: {},
    });
    cleanupPaths.add(prepared.env.XDG_CONFIG_HOME);

    expect(prepared.env.XDG_CONFIG_HOME).not.toBe(configHome);
    expect(prepared.env.XDG_DATA_HOME).toBe(path.join(agentHome, ".opencode-data"));
    const runtimeConfig = JSON.parse(
      await fs.readFile(
        path.join(prepared.env.XDG_CONFIG_HOME, "opencode", "opencode.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(runtimeConfig).toMatchObject({
      theme: "system",
      permission: {
        read: "allow",
        external_directory: "allow",
      },
    });
    await expect(
      fs.readFile(path.join(prepared.env.XDG_DATA_HOME, "opencode", "auth.json"), "utf8"),
    ).resolves.toBe("{\"provider\":\"ok\"}\n");
    await expect(
      fs.access(path.join(prepared.env.XDG_DATA_HOME, "opencode", "opencode.db")),
    ).rejects.toThrow();

    await prepared.cleanup();
    cleanupPaths.delete(prepared.env.XDG_CONFIG_HOME);
    await expect(fs.access(prepared.env.XDG_CONFIG_HOME)).rejects.toThrow();
    await expect(fs.access(prepared.env.XDG_DATA_HOME)).resolves.toBeUndefined();
  });

  it("respects explicit opt-out", async () => {
    const configHome = await makeConfigHome();
    const prepared = await prepareOpenCodeRuntimeConfig({
      env: { XDG_CONFIG_HOME: configHome, XDG_DATA_HOME: "/tmp/paperclip-opencode-data" },
      config: { dangerouslySkipPermissions: false },
    });

    expect(prepared.env).toEqual({
      XDG_CONFIG_HOME: configHome,
      XDG_DATA_HOME: "/tmp/paperclip-opencode-data",
    });
    expect(prepared.notes).toEqual([]);
    await prepared.cleanup();
  });

  it("creates an isolated XDG_DATA_HOME when not explicitly provided", async () => {
    const configHome = await makeConfigHome();
    const prepared = await prepareOpenCodeRuntimeConfig({
      env: { XDG_CONFIG_HOME: configHome },
      config: {},
    });
    cleanupPaths.add(prepared.env.XDG_CONFIG_HOME);
    cleanupPaths.add(prepared.env.XDG_DATA_HOME);

    expect(prepared.env.XDG_DATA_HOME).toContain("paperclip-opencode-data-");
    await expect(fs.access(path.join(prepared.env.XDG_DATA_HOME, "opencode"))).resolves.toBeUndefined();

    await prepared.cleanup();
    cleanupPaths.delete(prepared.env.XDG_CONFIG_HOME);
    cleanupPaths.delete(prepared.env.XDG_DATA_HOME);
  });

  it("links package-managed config dependencies into the runtime config without copying them", async () => {
    const configHome = await makeConfigHome({
      theme: "system",
    });
    await fs.mkdir(path.join(configHome, "opencode", "node_modules", "some-package"), { recursive: true });
    await fs.writeFile(
      path.join(configHome, "opencode", "node_modules", "some-package", "index.js"),
      "export default true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(configHome, "opencode", "package-lock.json"),
      "{}\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(configHome, "opencode", "package.json"),
      "{\"dependencies\":{\"some-package\":\"1.0.0\"}}\n",
      "utf8",
    );

    const prepared = await prepareOpenCodeRuntimeConfig({
      env: { XDG_CONFIG_HOME: configHome },
      config: {},
    });
    cleanupPaths.add(prepared.env.XDG_CONFIG_HOME);
    cleanupPaths.add(prepared.env.XDG_DATA_HOME);

    await expect(
      fs.access(path.join(prepared.env.XDG_CONFIG_HOME, "opencode", "opencode.json")),
    ).resolves.toBeUndefined();
    const runtimeNodeModules = path.join(prepared.env.XDG_CONFIG_HOME, "opencode", "node_modules");
    const runtimeNodeModulesStat = await fs.lstat(runtimeNodeModules);
    expect(runtimeNodeModulesStat.isSymbolicLink()).toBe(true);
    await expect(
      fs.access(path.join(runtimeNodeModules, "some-package", "index.js")),
    ).resolves.toBeUndefined();
    await expect(
      fs.readFile(path.join(prepared.env.XDG_CONFIG_HOME, "opencode", "package-lock.json"), "utf8"),
    ).resolves.toBe("{}\n");

    await prepared.cleanup();
    cleanupPaths.delete(prepared.env.XDG_CONFIG_HOME);
    cleanupPaths.delete(prepared.env.XDG_DATA_HOME);
  });
});
