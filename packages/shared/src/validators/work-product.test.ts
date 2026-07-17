import { describe, expect, it } from "vitest";
import {
  attachmentArtifactWorkProductMetadataSchema,
  createIssueWorkProductSchema,
} from "./work-product.js";

describe("attachmentArtifactWorkProductMetadataSchema", () => {
  it("accepts the attachment-backed artifact metadata contract", () => {
    const parsed = attachmentArtifactWorkProductMetadataSchema.parse({
      attachmentId: "11111111-1111-4111-8111-111111111111",
      contentType: "video/mp4",
      byteSize: 1234,
      contentPath: "/api/attachments/11111111-1111-4111-8111-111111111111/content",
      openPath: "/api/attachments/11111111-1111-4111-8111-111111111111/content",
      downloadPath: "/api/attachments/11111111-1111-4111-8111-111111111111/content?download=1",
      originalFilename: "demo.mp4",
    });

    expect(parsed.contentType).toBe("video/mp4");
    expect(parsed.downloadPath).toContain("download=1");
  });

  it("rejects off-route or scriptable paths", () => {
    const parsed = attachmentArtifactWorkProductMetadataSchema.safeParse({
      attachmentId: "11111111-1111-4111-8111-111111111111",
      contentType: "video/mp4",
      byteSize: 1234,
      contentPath: "https://evil.example/video.mp4",
      openPath: "javascript:alert(1)",
      downloadPath: "/api/attachments/11111111-1111-4111-8111-111111111111/content",
      originalFilename: "demo.mp4",
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected invalid attachment artifact metadata");
    }
    expect(parsed.error.issues.map((issue) => issue.path.join("."))).toEqual([
      "contentPath",
      "openPath",
      "downloadPath",
    ]);
  });
});

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
