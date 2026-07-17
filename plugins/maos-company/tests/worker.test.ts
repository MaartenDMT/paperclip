import type { PaperclipPluginManifestV1, PluginApiRequestInput } from "@paperclipai/plugin-sdk";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import manifest from "../src/manifest.mjs";
import plugin from "../src/worker.js";

const companyId = "00000000-0000-4000-8000-000000000001";

function apiInput(routeKey: string, body: Record<string, unknown> | null = null): PluginApiRequestInput {
  return {
    routeKey,
    method: body ? "POST" : "GET",
    path: body ? "/meeting-recommendations" : "/meeting-policy",
    params: {},
    query: body ? {} : { companyId },
    headers: {},
    body,
    companyId,
    actor: { actorType: "user", actorId: "user-1", userId: "user-1", agentId: null, runId: null },
  };
}

describe("MAOS company plugin worker", () => {
  it("serves meeting policy through a scoped plugin API route", async () => {
    const harness = createTestHarness({ manifest: manifest as PaperclipPluginManifestV1 });
    await plugin.definition.setup(harness.ctx);

    const response = await plugin.definition.onApiRequest!(apiInput("meeting-policy.get"));

    expect(response.status).toBe(200);
    expect((response.body as { triggerRules: Array<{ id: string }> }).triggerRules.map((rule) => rule.id)).toContain(
      "campaign_phase_review",
    );
  });

  it("persists generated meeting recommendations in the plugin namespace", async () => {
    const harness = createTestHarness({ manifest: manifest as PaperclipPluginManifestV1 });
    await plugin.definition.setup(harness.ctx);

    const response = await plugin.definition.onApiRequest!(apiInput("meeting-recommendations.create", {
      companyId,
      trigger: "blocked_without_edge",
      issueIdentifier: "REA-7",
      issueTitle: "Unblock launch",
    }));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ trigger: "blocked_without_edge", severity: "urgent" });
    expect(harness.dbExecutes).toHaveLength(1);
    expect(harness.dbExecutes[0]?.sql).toContain(".meeting_recommendations");
  });
});
