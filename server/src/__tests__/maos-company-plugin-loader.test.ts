import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pluginLoader } from "../services/plugin-loader.js";

const pluginRoot = fileURLToPath(new URL("../../../plugins/maos-company/", import.meta.url));

describe("MAOS company plugin package", () => {
  it("loads its manifest through the production plugin loader", async () => {
    const loader = pluginLoader({} as never, {
      enableLocalFilesystem: false,
      enableNpmDiscovery: false,
    });

    const manifest = await loader.loadManifest(pluginRoot);

    expect(manifest).toMatchObject({
      id: "maos.company-automation",
      categories: ["automation"],
      database: { namespaceSlug: "maos_company", migrationsDir: "migrations" },
      entrypoints: { worker: "./dist/worker.js" },
    });
  });
});
