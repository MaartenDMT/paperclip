import { createIssueWorkProductSchema } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { READERSBASE_PUBLISHING_TEMPLATE } from "./readersbase-publishing.js";
import {
  READERSBASE_DEEP_FICTION_PILOT,
  buildReadersBaseDeepFictionPilotWorkProducts,
} from "./readersbase-deep-fiction-pilot.js";

const phaseSlugs = READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates[0].phases.map(
  (phase) => phase.slug,
);

describe("READERSBASE_DEEP_FICTION_PILOT", () => {
  it("defines one safe sci-fi mystery novel pilot over the template phases", () => {
    expect(READERSBASE_DEEP_FICTION_PILOT).toMatchObject({
      slug: "ashen-observatory-sci-fi-mystery-novel",
      title: "The Ashen Observatory",
      format: "novel",
      genre: "sci-fi",
      campaignTemplateSlug: "fiction-production",
      safety: {
        noExternalPublication: true,
        noMassBookGeneration: true,
        noLiveReadersBaseMutation: true,
      },
      firstRunSequence: ["research", "analysis", "story-design"],
    });
    expect(READERSBASE_DEEP_FICTION_PILOT.phaseRunbook.map((phase) => phase.phaseSlug)).toEqual(
      phaseSlugs,
    );
  });

  it("gives every phase artifacts, assigned role, gate, and approval points", () => {
    for (const phase of READERSBASE_DEEP_FICTION_PILOT.phaseRunbook) {
      const templatePhase = READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates[0].phases.find(
        (candidate) => candidate.slug === phase.phaseSlug,
      );

      expect(phase.assignedRoleSlug).toBe(templatePhase?.ownerAgentSlug);
      expect(phase.requiredArtifactKeys).toEqual(templatePhase?.requiredArtifactKeys);
      expect(phase.requiredArtifactKeys.length).toBeGreaterThan(0);
      expect(phase.approvalPoints.length).toBeGreaterThan(0);
      expect(phase.gate.length).toBeGreaterThan(0);
      expect(phase.nextAgentInstructions.length).toBeGreaterThan(0);
    }
  });

  it("builds reviewable bridge work products without live ReadersBase mutation", () => {
    const workProducts = buildReadersBaseDeepFictionPilotWorkProducts().map((workProduct) =>
      createIssueWorkProductSchema.parse(workProduct),
    );

    expect(workProducts).toHaveLength(6);
    expect(workProducts.map((workProduct) => workProduct.metadata?.paperclipCampaignPhaseSlug)).toEqual(
      phaseSlugs,
    );
    expect(workProducts.every((workProduct) => workProduct.provider === "readersbase")).toBe(true);
    expect(workProducts.every((workProduct) => workProduct.metadata?.noLiveReadersBaseMutation === true)).toBe(
      true,
    );
    expect(workProducts[workProducts.length - 1]?.reviewState).toBe("needs_board_review");
  });
});
