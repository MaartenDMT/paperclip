import { describe, expect, it } from "vitest";
import { companyTemplateDefinitionSchema } from "./company-template.js";

const validTemplate = {
  schemaVersion: 1,
  slug: "readersbase-publishing",
  version: "1.0.0",
  name: "ReadersBase Publishing",
  description: "Reusable publishing-company setup for ReadersBase fiction production.",
  company: {
    name: "ReadersBase Publishing",
    issuePrefix: "RB",
    description: "AI publishing company for ReadersBase-native fiction and narrative content.",
    requireBoardApprovalForNewAgents: true,
    metadata: { templateSlug: "readersbase-publishing" },
  },
  agents: [
    {
      slug: "publisher-in-chief",
      name: "Publisher-in-Chief",
      role: "publisher_in_chief",
      title: "CEO / Publisher-in-Chief",
      capabilities: "Sets publishing strategy and approves governed releases.",
      adapterType: "codex_local",
      adapterConfig: {},
      metadata: { departmentSlug: "executive" },
    },
    {
      slug: "head-of-production",
      name: "Head of Production",
      role: "head_of_production",
      title: "COO / Production Manager",
      reportsToSlug: "publisher-in-chief",
      capabilities: "Coordinates schedules, budgets, and cross-phase handoffs.",
      adapterType: "codex_local",
      adapterConfig: {},
      metadata: { departmentSlug: "production" },
    },
  ],
  goals: [
    {
      slug: "company-mission",
      title: "Publish ReadersBase-native fiction with governed quality gates",
      level: "company",
      metadata: { templateSlug: "readersbase-publishing" },
    },
  ],
  projects: [
    {
      slug: "production",
      name: "Production",
      description: "Schedules and coordinates publishing campaigns.",
      metadata: { departmentSlug: "production" },
    },
  ],
  campaignTemplates: [
    {
      slug: "fiction-production",
      title: "Fiction Production Campaign",
      objective: "Move a fiction concept through research, design, drafting, editorial, and publishing gates.",
      phases: [
        {
          slug: "research",
          title: "Research",
          sequence: 1,
          objective: "Collect market, audience, setting, and source-truth evidence before story decisions.",
          ownerAgentSlug: "head-of-production",
          projectSlug: "production",
          requiredArtifactKeys: ["research-brief"],
          planTemplate: "# Research plan\n",
        },
      ],
    },
  ],
  artifactContracts: [
    {
      key: "research-brief",
      title: "Research Brief",
      phaseSlug: "research",
      projectSlug: "production",
      ownerAgentSlug: "head-of-production",
      kind: "markdown_document",
      lifecycle: "review_ready",
      reviewGates: ["lead_review"],
      required: true,
      metadata: { downstreamConsumer: "head-of-story-architecture" },
    },
  ],
};

describe("companyTemplateDefinitionSchema", () => {
  it("accepts a ReadersBase-shaped template definition", () => {
    expect(companyTemplateDefinitionSchema.parse(validTemplate).slug).toBe("readersbase-publishing");
  });

  it("rejects duplicate agent slugs", () => {
    const result = companyTemplateDefinitionSchema.safeParse({
      ...validTemplate,
      agents: [validTemplate.agents[0], { ...validTemplate.agents[1], slug: validTemplate.agents[0].slug }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("duplicate agent slug"))).toBe(true);
  });

  it("rejects missing reporting references", () => {
    const result = companyTemplateDefinitionSchema.safeParse({
      ...validTemplate,
      agents: [{ ...validTemplate.agents[0], reportsToSlug: "missing-manager" }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("unknown reportsToSlug"))).toBe(true);
  });

  it("rejects duplicate campaign phase sequence numbers", () => {
    const phase = validTemplate.campaignTemplates[0].phases[0];
    const result = companyTemplateDefinitionSchema.safeParse({
      ...validTemplate,
      campaignTemplates: [{ ...validTemplate.campaignTemplates[0], phases: [phase, { ...phase, slug: "analysis" }] }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("duplicate phase sequence"))).toBe(true);
  });

  it("rejects campaign phase required artifact keys without matching artifact contracts", () => {
    const result = companyTemplateDefinitionSchema.safeParse({
      ...validTemplate,
      campaignTemplates: [
        {
          ...validTemplate.campaignTemplates[0],
          phases: [
            {
              ...validTemplate.campaignTemplates[0].phases[0],
              requiredArtifactKeys: ["missing-contract"],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("unknown requiredArtifactKey"))).toBe(true);
  });

  it("accepts markdown documents with valid runtime targets", () => {
    const result = companyTemplateDefinitionSchema.safeParse({
      ...validTemplate,
      documents: [
        {
          slug: "research-phase-plan",
          title: "Research Phase Plan",
          scope: "campaign_phase_plan",
          targetSlug: "fiction-production:research",
          body: "# Research\n",
        },
        {
          slug: "research-issue-brief",
          title: "Research Issue Brief",
          scope: "issue",
          targetSlug: "fiction-production:research:issue",
          documentKey: "pilot-brief",
          body: "# Pilot\n",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects document definitions with missing or unknown targets", () => {
    const result = companyTemplateDefinitionSchema.safeParse({
      ...validTemplate,
      documents: [
        {
          slug: "missing-phase-plan",
          title: "Missing Phase Plan",
          scope: "campaign_phase_plan",
          targetSlug: "fiction-production:missing-phase",
          body: "# Missing\n",
        },
        {
          slug: "missing-key-issue-doc",
          title: "Missing Key Issue Doc",
          scope: "issue",
          targetSlug: "fiction-production:research:issue",
          body: "# Missing key\n",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("unknown document campaign phase targetSlug"))).toBe(true);
    expect(result.error?.issues.some((issue) => issue.message.includes("issue documents require documentKey"))).toBe(true);
  });
});
