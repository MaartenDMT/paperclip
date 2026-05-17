import { afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolveDefaultLocalPluginDir } from "../home-paths.js";
import { pluginLoader } from "../services/plugin-loader.js";

describe("plugin home paths", () => {
  const tempRoots: string[] = [];
  const previousPaperclipHome = process.env.PAPERCLIP_HOME;

  afterEach(async () => {
    if (previousPaperclipHome === undefined) {
      delete process.env.PAPERCLIP_HOME;
    } else {
      process.env.PAPERCLIP_HOME = previousPaperclipHome;
    }
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function makeHome() {
    const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-home-"));
    tempRoots.push(root);
    process.env.PAPERCLIP_HOME = root;
    return root;
  }

  async function writePluginPackage(pluginDir: string) {
    await mkdir(path.join(pluginDir, "dist"), { recursive: true });
    await writeFile(
      path.join(pluginDir, "package.json"),
      JSON.stringify({
        name: "paperclip-plugin-home-test",
        version: "0.1.0",
        type: "module",
        paperclipPlugin: { manifest: "./dist/manifest.js" },
      }),
      "utf8",
    );
    await writeFile(
      path.join(pluginDir, "dist", "manifest.js"),
      `export default {
  id: "paperclip.home-test",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Home Test",
  description: "PAPERCLIP_HOME test plugin.",
  author: "Paperclip",
  categories: ["automation"],
  capabilities: ["plugin.state.read"],
  entrypoints: { worker: "./dist/worker.js" }
};\n`,
      "utf8",
    );
  }

  it("resolves the default local plugin directory from PAPERCLIP_HOME at call time", async () => {
    const home = await makeHome();

    expect(resolveDefaultLocalPluginDir()).toBe(path.resolve(home, "plugins"));
  });

  it("discovers local plugins from PAPERCLIP_HOME when no directory override is provided", async () => {
    const home = await makeHome();
    const pluginDir = path.join(home, "plugins", "paperclip-plugin-home-test");
    await writePluginPackage(pluginDir);

    const result = await pluginLoader({} as never).discoverFromLocalFilesystem();

    expect(result.errors).toEqual([]);
    expect(result.discovered).toHaveLength(1);
    expect(result.discovered[0]).toMatchObject({
      packageName: "paperclip-plugin-home-test",
      packagePath: pluginDir,
      source: "local-filesystem",
    });
    expect(result.discovered[0]?.manifest?.id).toBe("paperclip.home-test");
  });
});
