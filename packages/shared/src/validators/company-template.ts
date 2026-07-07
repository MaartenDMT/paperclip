import { z } from "zod";

const metadataSchema = z.record(z.unknown());
const slugSchema = z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case");
const adapterConfigSchema = z.record(z.unknown());

export const companyTemplateArtifactKindSchema = z.enum([
  "markdown_document",
  "json_manifest",
  "manuscript",
  "outline",
  "bible",
  "checklist",
  "qa_report",
  "package",
  "external_link",
]);

export const companyTemplateArtifactLifecycleStatusSchema = z.enum([
  "draft",
  "review_ready",
  "approved",
  "superseded",
  "published",
]);

export const companyTemplateArtifactReviewGateSchema = z.enum([
  "lead_review",
  "ceo_review",
  "board_approval",
  "bridge_validation",
  "final_acceptance",
]);

export const companyTemplateCompanyDefinitionSchema = z.object({
  name: z.string().min(1),
  issuePrefix: z.string().min(1).max(12).regex(/^[A-Z][A-Z0-9]*$/, "issuePrefix must be uppercase alphanumeric"),
  description: z.string().min(1).optional(),
  requireBoardApprovalForNewAgents: z.boolean().optional(),
  budgetMonthlyCents: z.number().int().nonnegative().optional(),
  metadata: metadataSchema.optional(),
});

export const companyTemplateAgentDefinitionSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  role: z.string().min(1),
  title: z.string().min(1).optional(),
  icon: z.string().min(1).optional(),
  reportsToSlug: slugSchema.optional(),
  capabilities: z.string().min(1),
  adapterType: z.string().min(1),
  adapterConfig: adapterConfigSchema,
  runtimeConfig: z.record(z.unknown()).optional(),
  metadata: metadataSchema.optional(),
});

export const companyTemplateGoalDefinitionSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  level: z.enum(["company", "team", "agent", "task"]),
  parentSlug: slugSchema.optional(),
  ownerAgentSlug: slugSchema.optional(),
  metadata: metadataSchema.optional(),
});

export const companyTemplateProjectDefinitionSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  goalSlug: slugSchema.optional(),
  leadAgentSlug: slugSchema.optional(),
  metadata: metadataSchema.optional(),
});

export const companyTemplateCampaignPhaseDefinitionSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1),
  sequence: z.number().int().positive(),
  objective: z.string().min(1),
  ownerAgentSlug: slugSchema.optional(),
  projectSlug: slugSchema.optional(),
  requiredArtifactKeys: z.array(z.string().min(1)).optional(),
  planTemplate: z.string().optional(),
  metadata: metadataSchema.optional(),
});

export const companyTemplateCampaignDefinitionSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1),
  objective: z.string().min(1),
  leadAgentSlug: slugSchema.optional(),
  projectSlugs: z.array(slugSchema).optional(),
  phases: z.array(companyTemplateCampaignPhaseDefinitionSchema).min(1),
  metadata: metadataSchema.optional(),
});

export const companyTemplateIssueDefinitionSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  assigneeAgentSlug: slugSchema.optional(),
  projectSlug: slugSchema.optional(),
  goalSlug: slugSchema.optional(),
  metadata: metadataSchema.optional(),
});

export const companyTemplateArtifactContractSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  phaseSlug: slugSchema,
  projectSlug: slugSchema.optional(),
  ownerAgentSlug: slugSchema.optional(),
  kind: companyTemplateArtifactKindSchema,
  lifecycle: companyTemplateArtifactLifecycleStatusSchema,
  reviewGates: z.array(companyTemplateArtifactReviewGateSchema).min(1),
  required: z.boolean(),
  metadata: metadataSchema.optional(),
});

function addDuplicateIssues(
  ctx: z.RefinementCtx,
  values: string[],
  label: string,
  pathPrefix: (index: number) => (string | number)[],
): void {
  const seen = new Map<string, number>();
  values.forEach((value, index) => {
    const firstIndex = seen.get(value);
    if (firstIndex === undefined) {
      seen.set(value, index);
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `duplicate ${label}: ${value}`,
      path: pathPrefix(index),
    });
  });
}

export const companyTemplateDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  slug: slugSchema,
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  company: companyTemplateCompanyDefinitionSchema,
  agents: z.array(companyTemplateAgentDefinitionSchema).min(1),
  goals: z.array(companyTemplateGoalDefinitionSchema),
  projects: z.array(companyTemplateProjectDefinitionSchema),
  campaignTemplates: z.array(companyTemplateCampaignDefinitionSchema),
  artifactContracts: z.array(companyTemplateArtifactContractSchema),
  starterIssues: z.array(companyTemplateIssueDefinitionSchema).optional(),
  metadata: metadataSchema.optional(),
}).superRefine((template, ctx) => {
  const agentSlugs = template.agents.map((agent) => agent.slug);
  const goalSlugs = template.goals.map((goal) => goal.slug);
  const projectSlugs = template.projects.map((project) => project.slug);
  const campaignSlugs = template.campaignTemplates.map((campaign) => campaign.slug);
  const artifactKeys = template.artifactContracts.map((contract) => contract.key);
  const knownAgents = new Set(agentSlugs);
  const knownGoals = new Set(goalSlugs);
  const knownProjects = new Set(projectSlugs);
  const phaseSlugs = new Set(template.campaignTemplates.flatMap((campaign) => campaign.phases.map((phase) => phase.slug)));

  addDuplicateIssues(ctx, agentSlugs, "agent slug", (index) => ["agents", index, "slug"]);
  addDuplicateIssues(ctx, goalSlugs, "goal slug", (index) => ["goals", index, "slug"]);
  addDuplicateIssues(ctx, projectSlugs, "project slug", (index) => ["projects", index, "slug"]);
  addDuplicateIssues(ctx, campaignSlugs, "campaign slug", (index) => ["campaignTemplates", index, "slug"]);
  addDuplicateIssues(ctx, artifactKeys, "artifact key", (index) => ["artifactContracts", index, "key"]);

  const rootAgents = template.agents.filter((agent) => !agent.reportsToSlug);
  if (rootAgents.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `expected exactly one root agent, found ${rootAgents.length}`,
      path: ["agents"],
    });
  }

  template.agents.forEach((agent, index) => {
    if (agent.reportsToSlug && !knownAgents.has(agent.reportsToSlug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unknown reportsToSlug: ${agent.reportsToSlug}`,
        path: ["agents", index, "reportsToSlug"],
      });
    }
  });

  template.goals.forEach((goal, index) => {
    if (goal.parentSlug && !knownGoals.has(goal.parentSlug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown parent goal slug: ${goal.parentSlug}`, path: ["goals", index, "parentSlug"] });
    }
    if (goal.ownerAgentSlug && !knownAgents.has(goal.ownerAgentSlug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown ownerAgentSlug: ${goal.ownerAgentSlug}`, path: ["goals", index, "ownerAgentSlug"] });
    }
  });

  template.projects.forEach((project, index) => {
    if (project.goalSlug && !knownGoals.has(project.goalSlug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown goalSlug: ${project.goalSlug}`, path: ["projects", index, "goalSlug"] });
    }
    if (project.leadAgentSlug && !knownAgents.has(project.leadAgentSlug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown leadAgentSlug: ${project.leadAgentSlug}`, path: ["projects", index, "leadAgentSlug"] });
    }
  });

  template.campaignTemplates.forEach((campaign, campaignIndex) => {
    if (campaign.leadAgentSlug && !knownAgents.has(campaign.leadAgentSlug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown campaign leadAgentSlug: ${campaign.leadAgentSlug}`, path: ["campaignTemplates", campaignIndex, "leadAgentSlug"] });
    }
    campaign.projectSlugs?.forEach((projectSlug, projectIndex) => {
      if (!knownProjects.has(projectSlug)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown campaign projectSlug: ${projectSlug}`, path: ["campaignTemplates", campaignIndex, "projectSlugs", projectIndex] });
      }
    });
    addDuplicateIssues(
      ctx,
      campaign.phases.map((phase) => phase.slug),
      "phase slug",
      (index) => ["campaignTemplates", campaignIndex, "phases", index, "slug"],
    );
    addDuplicateIssues(
      ctx,
      campaign.phases.map((phase) => String(phase.sequence)),
      "phase sequence",
      (index) => ["campaignTemplates", campaignIndex, "phases", index, "sequence"],
    );
    campaign.phases.forEach((phase, phaseIndex) => {
      if (phase.ownerAgentSlug && !knownAgents.has(phase.ownerAgentSlug)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown phase ownerAgentSlug: ${phase.ownerAgentSlug}`, path: ["campaignTemplates", campaignIndex, "phases", phaseIndex, "ownerAgentSlug"] });
      }
      if (phase.projectSlug && !knownProjects.has(phase.projectSlug)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown phase projectSlug: ${phase.projectSlug}`, path: ["campaignTemplates", campaignIndex, "phases", phaseIndex, "projectSlug"] });
      }
    });
  });

  template.artifactContracts.forEach((contract, index) => {
    if (!phaseSlugs.has(contract.phaseSlug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown artifact phaseSlug: ${contract.phaseSlug}`, path: ["artifactContracts", index, "phaseSlug"] });
    }
    if (contract.projectSlug && !knownProjects.has(contract.projectSlug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown artifact projectSlug: ${contract.projectSlug}`, path: ["artifactContracts", index, "projectSlug"] });
    }
    if (contract.ownerAgentSlug && !knownAgents.has(contract.ownerAgentSlug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown artifact ownerAgentSlug: ${contract.ownerAgentSlug}`, path: ["artifactContracts", index, "ownerAgentSlug"] });
    }
  });

  template.starterIssues?.forEach((issue, index) => {
    if (issue.assigneeAgentSlug && !knownAgents.has(issue.assigneeAgentSlug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown issue assigneeAgentSlug: ${issue.assigneeAgentSlug}`, path: ["starterIssues", index, "assigneeAgentSlug"] });
    }
    if (issue.projectSlug && !knownProjects.has(issue.projectSlug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown issue projectSlug: ${issue.projectSlug}`, path: ["starterIssues", index, "projectSlug"] });
    }
    if (issue.goalSlug && !knownGoals.has(issue.goalSlug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown issue goalSlug: ${issue.goalSlug}`, path: ["starterIssues", index, "goalSlug"] });
    }
  });
});

export type CompanyTemplateDefinitionInput = z.input<typeof companyTemplateDefinitionSchema>;
