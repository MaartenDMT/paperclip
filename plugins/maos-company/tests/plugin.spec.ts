import { describe, expect, it } from "vitest";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import manifest from "../src/manifest.mjs";

describe("MAOS company plugin manifest", () => {
  it("declares an automation plugin with scoped API and namespace persistence", () => {
    expect(pluginManifestV1Schema.parse(manifest)).toEqual(manifest);
    expect(manifest.categories).toEqual(["automation"]);
    expect(manifest.database).toMatchObject({ namespaceSlug: "maos_company", migrationsDir: "migrations" });
    expect(manifest.capabilities).toContain("api.routes.register");
    expect(manifest.apiRoutes.map((route) => route.routeKey)).toEqual(expect.arrayContaining([
      "campaigns.list",
      "campaigns.create",
      "campaign-phases.transition",
      "goal-bindings.upsert",
      "meeting-policy.get",
      "meeting-recommendations.create",
    ]));
  });
});
