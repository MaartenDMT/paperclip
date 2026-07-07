import { companyTemplateDefinitionSchema } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { READERSBASE_PUBLISHING_FORMATS, READERSBASE_PUBLISHING_TEMPLATE } from "./readersbase-publishing.js";

describe("READERSBASE_PUBLISHING_TEMPLATE", () => {
  it("is a valid reusable company template with one org root", () => {
    const parsed = companyTemplateDefinitionSchema.parse(READERSBASE_PUBLISHING_TEMPLATE);

    expect(parsed.slug).toBe("readersbase-publishing");
    expect(parsed.company.issuePrefix).toBe("RB");
    expect(parsed.agents.filter((agent) => !agent.reportsToSlug).map((agent) => agent.slug)).toEqual([
      "publisher-in-chief",
    ]);
  });

  it("includes required publishing leadership and specialist roles", () => {
    const slugs = READERSBASE_PUBLISHING_TEMPLATE.agents.map((agent) => agent.slug);

    expect(slugs).toEqual(
      expect.arrayContaining([
        "publisher-in-chief",
        "head-of-production",
        "head-of-story-architecture",
        "head-of-research",
        "research-classification-agent",
        "head-of-genre",
        "head-of-format",
        "scene-drafter",
        "developmental-editor",
        "metadata-catalog-editor",
        "artifact-librarian",
      ]),
    );
  });

  it("covers all approved ReadersBase publishing formats", () => {
    expect(READERSBASE_PUBLISHING_FORMATS).toEqual([
      "novel",
      "novella",
      "short-story",
      "interactive-novel",
      "interactive-novella",
      "interactive-short-story",
      "storybook",
      "graphic-novel",
    ]);
  });

  it("defines artifact contracts for all campaign phases and gates deep fiction plus genre quality", () => {
    const phaseSlugs = READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates[0].phases.map((phase) => phase.slug);
    const contractPhases = new Set(READERSBASE_PUBLISHING_TEMPLATE.artifactContracts.map((contract) => contract.phaseSlug));
    const contractKeys = READERSBASE_PUBLISHING_TEMPLATE.artifactContracts.map((contract) => contract.key);

    expect(phaseSlugs).toEqual(["research", "analysis", "story-design", "draft", "editorial", "publishing"]);
    expect(phaseSlugs.every((phase) => contractPhases.has(phase))).toBe(true);
    expect(contractKeys).toEqual(
      expect.arrayContaining([
        "deep-fiction-quality-gate",
        "genre-reader-promise-gate",
        "publishing-approval-manifest",
      ]),
    );
  });

  it("routes priority work to long-form and governed publishing owners", () => {
    const researchPhase = READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates[0].phases.find((phase) => phase.slug === "research");
    const publishingPhase = READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates[0].phases.find((phase) => phase.slug === "publishing");
    const priorityMetadata = READERSBASE_PUBLISHING_TEMPLATE.metadata?.priorityRouting as Record<string, unknown>;

    expect(researchPhase?.ownerAgentSlug).toBe("head-of-research");
    expect(publishingPhase?.ownerAgentSlug).toBe("head-of-publishing");
    expect(priorityMetadata.primaryFormats).toEqual(["novel", "interactive-novel", "graphic-novel"]);
    expect(priorityMetadata.requiresBoardApprovalBeforeExternalPublication).toBe(true);
  });
});
