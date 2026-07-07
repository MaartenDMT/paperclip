import { createIssueWorkProductSchema } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { READERSBASE_DEEP_FICTION_PILOT } from "./readersbase-deep-fiction-pilot.js";
import {
  READERSBASE_FIRST_PILOT_ISSUE_SPECS,
  buildReadersBaseFirstPilotIssueSpecs,
} from "./readersbase-first-pilot-issues.js";

describe("READERSBASE_FIRST_PILOT_ISSUE_SPECS", () => {
  it("launches only Research, Analysis, and Story Design for the first pilot", () => {
    const specs = buildReadersBaseFirstPilotIssueSpecs();

    expect(specs.map((spec) => spec.phaseSlug)).toEqual(["research", "analysis", "story-design"]);
    expect(specs).toHaveLength(3);
    expect(specs.some((spec) => ["draft", "editorial", "publishing"].includes(spec.phaseSlug))).toBe(false);
    expect(specs.every((spec) => spec.pilotSlug === READERSBASE_DEEP_FICTION_PILOT.slug)).toBe(true);
  });

  it("carries governed roles, artifacts, approvals, gates, and safe execution policy", () => {
    for (const spec of READERSBASE_FIRST_PILOT_ISSUE_SPECS) {
      expect(spec.assigneeRoleSlug).toMatch(/^head-of-/);
      expect(spec.artifactRequirements.length).toBeGreaterThan(0);
      expect(spec.artifactRequirements.map((requirement) => requirement.key)).toEqual(
        spec.executionPolicy.requiredArtifactKeys,
      );
      expect(spec.approvalPoints.length).toBeGreaterThan(0);
      expect(spec.exitGate.length).toBeGreaterThan(0);
      expect(spec.followUpContext.stopBeforePhaseSlug).toBe("draft");
      expect(spec.executionPolicy).toMatchObject({
        noExternalPublication: true,
        noMassBookGeneration: true,
        noLiveReadersBaseMutation: true,
        stopBeforeDraft: true,
      });
      expect(spec.description).toContain("do not start Draft, Editorial, or Publishing");
    }
  });

  it("preserves phase dependencies and reviewable ReadersBase work-product seeds", () => {
    const specs = buildReadersBaseFirstPilotIssueSpecs();

    expect(specs[0]?.blockedByPhaseSlugs).toEqual([]);
    expect(specs[1]?.blockedByPhaseSlugs).toEqual(["research"]);
    expect(specs[2]?.blockedByPhaseSlugs).toEqual(["research", "analysis"]);
    expect(specs[2]?.followUpContext.allowedNextPhaseSlug).toBe(null);

    for (const spec of specs) {
      const workProduct = createIssueWorkProductSchema.parse(spec.workProductSeed);
      expect(workProduct.provider).toBe("readersbase");
      expect(workProduct.metadata?.paperclipCampaignPhaseSlug).toBe(spec.phaseSlug);
      expect(workProduct.metadata?.noLiveReadersBaseMutation).toBe(true);
    }
  });
});
