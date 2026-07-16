import { afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { resolveVersionedModuleImportUrl } from "../services/plugin-loader.js";

describe("plugin loader manifest imports", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function makeManifestFile() {
    const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-plugin-loader-"));
    tempRoots.push(root);
    const distDir = path.join(root, "dist");
    await mkdir(distDir, { recursive: true });
    return path.join(distDir, "manifest.js");
  }

  function manifestSource(version: string) {
    return `export default {
  id: "paperclip.test-cache",
  apiVersion: 1,
  version: "${version}",
  displayName: "Cache Test",
  description: "Cache busting test plugin.",
  author: "Paperclip",
  categories: ["automation"],
  capabilities: ["plugin.state.read"],
  entrypoints: { worker: "./dist/worker.js" }
};\n`;
  }

  it("changes the import URL when a manifest is rewritten in place", async () => {
    const manifestPath = await makeManifestFile();
    await writeFile(manifestPath, manifestSource("0.1.0"), "utf8");
    const firstUrl = await resolveVersionedModuleImportUrl(manifestPath);

    await writeFile(manifestPath, manifestSource("0.2.0"), "utf8");
    const secondUrl = await resolveVersionedModuleImportUrl(manifestPath);

    expect(secondUrl).not.toBe(firstUrl);
  });

  it("busts Node's module cache even when size and mtime are unchanged", async () => {
    const manifestPath = await makeManifestFile();
    const fixedTime = new Date("2026-05-17T00:00:00.000Z");

    await writeFile(manifestPath, manifestSource("0.1.0"), "utf8");
    await utimes(manifestPath, fixedTime, fixedTime);
    const firstUrl = await resolveVersionedModuleImportUrl(manifestPath);
    const firstModule = await import(firstUrl) as { default: { version: string } };

    await writeFile(manifestPath, manifestSource("0.2.0"), "utf8");
    await utimes(manifestPath, fixedTime, fixedTime);
    const secondUrl = await resolveVersionedModuleImportUrl(manifestPath);
    const secondModule = await import(secondUrl) as { default: { version: string } };

    expect(firstUrl).not.toBe(secondUrl);
    expect(firstModule.default.version).toBe("0.1.0");
    expect(secondModule.default.version).toBe("0.2.0");
  });
});
