import { companyTemplateDefinitionSchema, type CompanyTemplateDefinition, type CompanyTemplateMaterializationAction, type CompanyTemplateMaterializationPlan, type CompanyTemplateSeedOptions } from "@paperclipai/shared";

function createAction(
  entityType: CompanyTemplateMaterializationAction["entityType"],
  slug: string,
  label: string,
  metadata?: Record<string, unknown>,
): CompanyTemplateMaterializationAction {
  return {
    kind: "create",
    entityType,
    slug,
    label,
    metadata,
  };
}

function orderAgentsByReportsTo(template: CompanyTemplateDefinition): CompanyTemplateDefinition["agents"] {
  const remaining = new Map(template.agents.map((agent) => [agent.slug, agent]));
  const ordered: CompanyTemplateDefinition["agents"] = [];
  const planned = new Set<string>();

  while (remaining.size > 0) {
    const batch = Array.from(remaining.values()).filter((agent) => !agent.reportsToSlug || planned.has(agent.reportsToSlug));
    if (batch.length === 0) {
      throw new Error("company template agent reporting tree contains a cycle or unresolved manager");
    }
    for (const agent of batch) {
      ordered.push(agent);
      planned.add(agent.slug);
      remaining.delete(agent.slug);
    }
  }

  return ordered;
}

export function planCompanyTemplateInstall(
  template: CompanyTemplateDefinition,
  options: CompanyTemplateSeedOptions = {},
): CompanyTemplateMaterializationPlan {
  const parsed = companyTemplateDefinitionSchema.parse(template) as CompanyTemplateDefinition;
  const actions: CompanyTemplateMaterializationAction[] = [
    createAction("company", parsed.slug, parsed.company.name, parsed.company.metadata),
  ];

  for (const agent of orderAgentsByReportsTo(parsed)) {
    actions.push(createAction("agent", agent.slug, agent.name, agent.metadata));
  }

  for (const goal of parsed.goals) {
    actions.push(createAction("goal", goal.slug, goal.title, goal.metadata));
  }

  for (const project of parsed.projects) {
    actions.push(createAction("project", project.slug, project.name, project.metadata));
  }

  for (const campaign of parsed.campaignTemplates) {
    actions.push(createAction("campaign", campaign.slug, campaign.title, campaign.metadata));
    for (const phase of campaign.phases.sort((a, b) => a.sequence - b.sequence)) {
      actions.push(createAction("campaign_phase", `${campaign.slug}:${phase.slug}`, phase.title, phase.metadata));
    }
  }

  for (const artifactContract of parsed.artifactContracts) {
    actions.push(createAction("artifact_contract", artifactContract.key, artifactContract.title, artifactContract.metadata));
  }

  for (const issue of parsed.starterIssues ?? []) {
    actions.push(createAction("issue", issue.slug, issue.title, issue.metadata));
  }

  return {
    templateSlug: parsed.slug,
    templateVersion: parsed.version,
    dryRun: options.dryRun ?? true,
    actions,
    warnings: [
      "ReadersBase bridge validation is metadata-only in v1; no live taxonomy or catalog mutation will run.",
    ],
  };
}
