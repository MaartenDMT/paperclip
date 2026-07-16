import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

const mockRegistry = vi.hoisted(() => ({
  getById: vi.fn(),
  getByKey: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => mockRegistry,
}));

describe("plugin UI static home path", () => {
  const tempRoots: string[] = [];
  const previousPaperclipHome = process.env.PAPERCLIP_HOME;

  beforeEach(() => {
    mockRegistry.getById.mockReset();
    mockRegistry.getByKey.mockReset();
    mockRegistry.getConfig.mockReset();
  });

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
    const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-ui-home-"));
    tempRoots.push(root);
    process.env.PAPERCLIP_HOME = root;
    return root;
  }

  it("serves plugin UI bundles from PAPERCLIP_HOME/plugins by default", async () => {
    const home = await makeHome();
    const uiDir = path.join(home, "plugins", "node_modules", "@paperclip", "test-plugin", "dist", "ui");
    await mkdir(uiDir, { recursive: true });
    await writeFile(path.join(uiDir, "index.js"), "export const value = 1;\n", "utf8");

    mockRegistry.getById.mockResolvedValue(null);
    mockRegistry.getByKey.mockResolvedValue({
      id: "plugin-1",
      pluginKey: "paperclip.test-plugin",
      packageName: "@paperclip/test-plugin",
      packagePath: null,
      status: "ready",
      manifestJson: {
        entrypoints: { ui: "./dist/ui" },
      },
    });
    mockRegistry.getConfig.mockResolvedValue(null);

    const { pluginUiStaticRoutes } = await import("../routes/plugin-ui-static.js");
    const app = express();
    app.use(pluginUiStaticRoutes({} as never));

    const res = await request(app).get("/_plugins/paperclip.test-plugin/ui/index.js");

    expect(res.status).toBe(200);
    expect(res.text).toBe("export const value = 1;\n");
  });
});
