import { describe, expect, it } from "vitest";
import { createIssueWorkProductSchema } from "./work-product.js";

const validReadersBaseMetadata = {
  artifactContractVersion: 1,
  bridgeKind: "readersbase_phase_artifact_bridge",
  readersbaseProjectId: "rb-project-123",
  readersbaseSeriesId: null,
  readersbaseWorkId: null,
  readersbasePhase: "publishing",
  paperclipCampaignSlug: "fiction-production",
  paperclipCampaignPhaseSlug: "publishing",
  artifactKeys: ["publishing-package"],
  artifactContracts: [
    {
      key: "publishing-package",
      title: "Publishing Package",
      phaseSlug: "publishing",
      projectSlug: "publishing",
      ownerAgentSlug: "export-packaging-specialist",
      kind: "package",
      lifecycle: "review_ready",
      reviewGates: ["board_approval"],
      required: true,
    },
  ],
  sourceRefs: {
    paperclipTemplateSlug: "readersbase-publishing",
    paperclipTemplateVersion: "1.0.0",
    readersbaseArtifactInventoryPath: "plans/readersbase-artifact-phase-contract.md",
    taxonomyValidation: "readersbase-runtime",
  },
  followUpContext: {
    summary: "Ready for bridge review.",
    requiredBeforeNextPhase: ["publishing-package"],
    downstreamConsumerAgentSlugs: ["readersbase-bridge-qa"],
    approvalGate: "board_approval",
  },
  noLiveReadersBaseMutation: true,
};

describe("createIssueWorkProductSchema", () => {
  it("requires ReadersBase work products to use the read-only bridge metadata contract", () => {
    expect(() =>
      createIssueWorkProductSchema.parse({
        type: "artifact",
        provider: "readersbase",
        title: "ReadersBase artifact",
        metadata: {
          ...validReadersBaseMetadata,
          artifactKeys: ["publishing-package", "missing-contract"],
        },
      }),
    ).toThrow("artifactKeys entry has no matching artifact contract: missing-contract");
  });

  it("accepts valid metadata-only ReadersBase bridge work products", () => {
    const parsed = createIssueWorkProductSchema.parse({
      type: "artifact",
      provider: "readersbase",
      title: "ReadersBase artifact",
      metadata: validReadersBaseMetadata,
    });

    expect(parsed.provider).toBe("readersbase");
    expect(parsed.metadata?.noLiveReadersBaseMutation).toBe(true);
  });
});
