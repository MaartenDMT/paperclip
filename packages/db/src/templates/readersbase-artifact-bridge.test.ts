import { createIssueWorkProductSchema } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { READERSBASE_PUBLISHING_TEMPLATE } from "./readersbase-publishing.js";
import { buildReadersBaseArtifactWorkProductInput } from "./readersbase-artifact-bridge.js";

describe("buildReadersBaseArtifactWorkProductInput", () => {
  it("maps a ReadersBase campaign phase to issue_work_products metadata without duplicating artifact keys", () => {
    const workProduct = buildReadersBaseArtifactWorkProductInput({
      template: READERSBASE_PUBLISHING_TEMPLATE,
      campaignSlug: "fiction-production",
      phaseSlug: "publishing",
      readersbaseProjectId: "rb-project-123",
      readersbaseSeriesId: "rb-series-456",
      readersbaseWorkId: "rb-work-789",
      summary: "Publishing package is ready for bridge QA and board approval.",
      nextAgentInstructions:
        "Validate the manifest against ReadersBase before any catalog mutation.",
    });

    const parsed = createIssueWorkProductSchema.parse(workProduct);

    expect(parsed.type).toBe("artifact");
    expect(parsed.provider).toBe("readersbase");
    expect(parsed.status).toBe("ready_for_review");
    expect(parsed.reviewState).toBe("needs_board_review");
    expect(parsed.title).toBe("ReadersBase publishing phase artifacts");
    expect(parsed.metadata).toMatchObject({
      artifactContractVersion: 1,
      bridgeKind: "readersbase_phase_artifact_bridge",
      readersbaseProjectId: "rb-project-123",
      readersbaseSeriesId: "rb-series-456",
      readersbaseWorkId: "rb-work-789",
      readersbasePhase: "publishing",
      paperclipCampaignSlug: "fiction-production",
      paperclipCampaignPhaseSlug: "publishing",
      artifactKeys: ["publishing-package", "publishing-approval-manifest"],
      noLiveReadersBaseMutation: true,
      sourceRefs: {
        paperclipTemplateSlug: "readersbase-publishing",
        paperclipTemplateVersion: "1.0.0",
        readersbaseArtifactInventoryPath:
          "plans/readersbase-artifact-phase-contract.md",
        taxonomyValidation: "readersbase-runtime",
      },
      followUpContext: {
        summary:
          "Publishing package is ready for bridge QA and board approval.",
        nextAgentInstructions:
          "Validate the manifest against ReadersBase before any catalog mutation.",
        requiredBeforeNextPhase: [
          "publishing-package",
          "publishing-approval-manifest",
        ],
        approvalGate: "board_approval",
      },
    });
  });

  it("rejects a phase whose required artifact key is not declared by the template", () => {
    const invalidTemplate = {
      ...READERSBASE_PUBLISHING_TEMPLATE,
      campaignTemplates: [
        {
          ...READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates[0],
          phases: [
            {
              ...READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates[0].phases[0],
              requiredArtifactKeys: ["missing-contract"],
            },
          ],
        },
      ],
    };

    expect(() =>
      buildReadersBaseArtifactWorkProductInput({
        template: invalidTemplate,
        campaignSlug: "fiction-production",
        phaseSlug: "research",
        readersbaseProjectId: "rb-project-123",
        summary: "Research handoff.",
      }),
    ).toThrow("missing artifact contracts for required keys: missing-contract");
  });
});
