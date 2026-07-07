import { and, eq, sql } from "drizzle-orm";
import {
  companyTemplateDefinitionSchema,
  type CompanyTemplateDefinition,
  type CompanyTemplateMaterializationAction,
  type CompanyTemplateMaterializationPlan,
  type CompanyTemplateMaterializationResult,
  type CompanyTemplateSeedOptions,
} from "@paperclipai/shared";
import type { Db } from "../client.js";
import {
  agents,
  campaignPhases,
  campaignProjects,
  campaigns,
  companies,
  goals,
  issueWorkProducts,
  issues,
  projects,
} from "../schema/index.js";
import {
  READERSBASE_DEEP_FICTION_PILOT,
  buildReadersBaseDeepFictionPilotWorkProducts,
} from "./readersbase-deep-fiction-pilot.js";
import { READERSBASE_PUBLISHING_TEMPLATE } from "./readersbase-publishing.js";

export type CompanyTemplateMaterializerEntity =
  | "company"
  | "agent"
  | "goal"
  | "project"
  | "campaign"
  | "campaign_phase"
  | "issue"
  | "work_product"
  | "artifact_contract";

type MaterializedEntity = { id: string; [key: string]: unknown };

interface MaterializerEntityScope {
  companyId?: string | null;
  parentId?: string | null;
  slug: string;
  label?: string;
  data?: Record<string, unknown>;
}

export interface CompanyTemplateMaterializerTx {
  findEntity(entityType: CompanyTemplateMaterializerEntity, scope: MaterializerEntityScope): Promise<MaterializedEntity | null>;
  createEntity(
    entityType: CompanyTemplateMaterializerEntity,
    input: MaterializerEntityScope & { label: string; data: Record<string, unknown> },
  ): Promise<MaterializedEntity>;
}

export interface CompanyTemplateMaterializerStore {
  transaction<T>(action: (tx: CompanyTemplateMaterializerTx) => Promise<T>): Promise<T>;
}

interface PlannedEntity {
  action: CompanyTemplateMaterializationAction;
  lookupSlug?: string;
  companySlug?: string;
  parentSlug?: string;
  data: Record<string, unknown>;
}

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
    for (const phase of [...campaign.phases].sort((a, b) => a.sequence - b.sequence)) {
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

function withTemplateMetadata(
  template: CompanyTemplateDefinition,
  entitySlug: string,
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    ...metadata,
    templateSlug: template.slug,
    templateVersion: template.version,
    templateEntitySlug: entitySlug,
    preserveByDefault: true,
  };
}

function readersBasePilotPlan(options: CompanyTemplateSeedOptions = {}): CompanyTemplateMaterializationPlan {
  const plan = planCompanyTemplateInstall(READERSBASE_PUBLISHING_TEMPLATE, options);
  const campaignSlug = READERSBASE_DEEP_FICTION_PILOT.campaignTemplateSlug;
  for (const phase of READERSBASE_DEEP_FICTION_PILOT.phaseRunbook) {
    plan.actions.push(
      createAction("issue", `${campaignSlug}:${phase.phaseSlug}:issue`, `${READERSBASE_DEEP_FICTION_PILOT.title}: ${phase.phaseSlug} phase`, {
        templateSlug: READERSBASE_PUBLISHING_TEMPLATE.slug,
        pilotSlug: READERSBASE_DEEP_FICTION_PILOT.slug,
        phaseSlug: phase.phaseSlug,
      }),
    );
    plan.actions.push(
      createAction("work_product", `${campaignSlug}:${phase.phaseSlug}:work-product`, `${READERSBASE_DEEP_FICTION_PILOT.title}: ${phase.phaseSlug} artifact handoff`, {
        templateSlug: READERSBASE_PUBLISHING_TEMPLATE.slug,
        pilotSlug: READERSBASE_DEEP_FICTION_PILOT.slug,
        phaseSlug: phase.phaseSlug,
        noLiveReadersBaseMutation: true,
      }),
    );
  }
  return plan;
}

function buildReadersBasePilotEntities(template: CompanyTemplateDefinition): PlannedEntity[] {
  const entities: PlannedEntity[] = [];
  const companySlug = template.slug;
  const campaign = template.campaignTemplates.find((candidate) => candidate.slug === READERSBASE_DEEP_FICTION_PILOT.campaignTemplateSlug);
  if (!campaign) {
    throw new Error(`unknown ReadersBase pilot campaign template: ${READERSBASE_DEEP_FICTION_PILOT.campaignTemplateSlug}`);
  }

  entities.push({
    action: createAction("company", template.slug, template.company.name, template.company.metadata),
    lookupSlug: template.company.issuePrefix,
    data: {
      name: template.company.name,
      description: template.company.description,
      issuePrefix: template.company.issuePrefix,
      budgetMonthlyCents: template.company.budgetMonthlyCents ?? 0,
      requireBoardApprovalForNewAgents: template.company.requireBoardApprovalForNewAgents ?? false,
    },
  });

  for (const agent of orderAgentsByReportsTo(template)) {
    entities.push({
      action: createAction("agent", agent.slug, agent.name, agent.metadata),
      companySlug,
      parentSlug: agent.reportsToSlug,
      data: {
        name: agent.name,
        role: agent.role,
        title: agent.title,
        icon: agent.icon,
        capabilities: agent.capabilities,
        adapterType: agent.adapterType,
        adapterConfig: agent.adapterConfig,
        runtimeConfig: agent.runtimeConfig ?? {},
        metadata: {
          ...withTemplateMetadata(template, agent.slug, agent.metadata),
          templateAgentSlug: agent.slug,
        },
      },
    });
  }

  for (const goal of template.goals) {
    entities.push({
      action: createAction("goal", goal.slug, goal.title, goal.metadata),
      companySlug,
      parentSlug: goal.parentSlug,
      data: {
        title: goal.title,
        description: goal.description,
        level: goal.level,
        status: "active",
        ownerAgentSlug: goal.ownerAgentSlug,
      },
    });
  }

  for (const project of template.projects) {
    entities.push({
      action: createAction("project", project.slug, project.name, project.metadata),
      companySlug,
      data: {
        name: project.name,
        description: project.description,
        status: "planned",
        goalSlug: project.goalSlug,
        leadAgentSlug: project.leadAgentSlug,
      },
    });
  }

  entities.push({
    action: createAction("campaign", campaign.slug, campaign.title, campaign.metadata),
    companySlug,
    data: {
      title: campaign.title,
      objective: campaign.objective,
      status: "draft",
      goalSlug: template.goals[0]?.slug,
      leadAgentSlug: campaign.leadAgentSlug,
      projectSlugs: campaign.projectSlugs ?? [],
    },
  });

  for (const phase of [...campaign.phases].sort((a, b) => a.sequence - b.sequence)) {
    entities.push({
      action: createAction("campaign_phase", `${campaign.slug}:${phase.slug}`, phase.title, phase.metadata),
      companySlug,
      parentSlug: campaign.slug,
      data: {
        sequenceNumber: phase.sequence,
        title: phase.title,
        objective: phase.objective,
        status: "planning",
        ownerAgentSlug: phase.ownerAgentSlug,
        projectSlug: phase.projectSlug,
        requiredArtifactKeys: phase.requiredArtifactKeys ?? [],
        planTemplate: phase.planTemplate,
      },
    });
  }

  const workProducts = buildReadersBaseDeepFictionPilotWorkProducts();
  for (const [index, phase] of READERSBASE_DEEP_FICTION_PILOT.phaseRunbook.entries()) {
    const issueSlug = `${campaign.slug}:${phase.phaseSlug}:issue`;
    const phaseSlug = `${campaign.slug}:${phase.phaseSlug}`;
    entities.push({
      action: createAction("issue", issueSlug, `${READERSBASE_DEEP_FICTION_PILOT.title}: ${phase.phaseSlug} phase`),
      companySlug,
      parentSlug: phaseSlug,
      data: {
        title: `${READERSBASE_DEEP_FICTION_PILOT.title}: ${phase.phaseSlug} phase`,
        description: `${phase.objective}\n\nGate: ${phase.gate}\n\n${phase.nextAgentInstructions}`,
        status: "backlog",
        priority: phase.phaseSlug === "publishing" ? "high" : "medium",
        projectSlug: template.artifactContracts.find((contract) => contract.phaseSlug === phase.phaseSlug)?.projectSlug,
        goalSlug: template.goals[0]?.slug,
        assigneeAgentSlug: phase.assignedRoleSlug,
        originKind: "company_template_materializer",
        originId: `${template.slug}:${READERSBASE_DEEP_FICTION_PILOT.slug}:${phase.phaseSlug}`,
        originFingerprint: "readersbase-publishing-pilot-v1",
        executionPolicy: {
          noExternalPublication: true,
          noLiveReadersBaseMutation: true,
          requiredArtifactKeys: phase.requiredArtifactKeys,
          approvalPoints: phase.approvalPoints,
        },
      },
    });
    entities.push({
      action: createAction("work_product", `${campaign.slug}:${phase.phaseSlug}:work-product`, workProducts[index]?.title ?? `${phase.phaseSlug} artifact handoff`),
      companySlug,
      parentSlug: issueSlug,
      data: {
        projectSlug: template.artifactContracts.find((contract) => contract.phaseSlug === phase.phaseSlug)?.projectSlug,
        ...workProducts[index],
      },
    });
  }

  return entities;
}

function skippedAction(action: CompanyTemplateMaterializationAction): CompanyTemplateMaterializationAction {
  return {
    ...action,
    kind: "skip",
    reason: "existing row found; preserved by default",
  };
}

function resolveEntityDataReferences(data: Record<string, unknown>, ids: Map<string, string>): Record<string, unknown> {
  const resolved = { ...data };
  for (const [slugKey, idKey] of [
    ["goalSlug", "goalId"],
    ["leadAgentSlug", "leadAgentId"],
    ["ownerAgentSlug", "ownerAgentId"],
    ["projectSlug", "projectId"],
    ["assigneeAgentSlug", "assigneeAgentId"],
  ] as const) {
    const slug = resolved[slugKey];
    if (typeof slug === "string") {
      resolved[idKey] = ids.get(slug) ?? null;
    }
  }
  if (Array.isArray(resolved.projectSlugs)) {
    resolved.projectIds = resolved.projectSlugs
      .map((slug) => (typeof slug === "string" ? ids.get(slug) : null))
      .filter((id): id is string => typeof id === "string");
  }
  return resolved;
}

async function materializePlannedEntities(
  store: CompanyTemplateMaterializerStore,
  template: CompanyTemplateDefinition,
  plan: CompanyTemplateMaterializationPlan,
  entities: PlannedEntity[],
  options: CompanyTemplateSeedOptions,
): Promise<CompanyTemplateMaterializationResult> {
  if (options.dryRun ?? true) {
    return {
      templateSlug: template.slug,
      templateVersion: template.version,
      companyId: options.companyId,
      applied: false,
      plan,
      created: [],
      updated: [],
      skipped: [],
      warnings: plan.warnings,
    };
  }

  const created: CompanyTemplateMaterializationAction[] = [];
  const skipped: CompanyTemplateMaterializationAction[] = [];
  const ids = new Map<string, string>();

  const companyId = await store.transaction(async (tx) => {
    for (const entity of entities) {
      const action = entity.action;
      const parentId = entity.parentSlug ? ids.get(entity.parentSlug) : null;
      const scopedCompanyId = action.entityType === "company" ? null : ids.get(entity.companySlug ?? template.slug) ?? options.companyId ?? null;
      const data = resolveEntityDataReferences(entity.data, ids);
      const existing = await tx.findEntity(action.entityType, {
        companyId: scopedCompanyId,
        parentId,
        slug: entity.lookupSlug ?? action.slug,
        label: action.label,
        data,
      });
      if (existing) {
        ids.set(action.slug, existing.id);
        skipped.push(skippedAction(action));
        continue;
      }

      const row = await tx.createEntity(action.entityType, {
        companyId: scopedCompanyId,
        parentId,
        slug: entity.lookupSlug ?? action.slug,
        label: action.label,
        data,
      });
      ids.set(action.slug, row.id);
      created.push(action);
    }
    return ids.get(template.slug);
  });

  return {
    templateSlug: template.slug,
    templateVersion: template.version,
    companyId,
    applied: true,
    plan,
    created,
    updated: [],
    skipped,
    warnings: plan.warnings,
  };
}

export async function materializeReadersBasePublishingPilot(
  store: CompanyTemplateMaterializerStore,
  options: CompanyTemplateSeedOptions = {},
): Promise<CompanyTemplateMaterializationResult> {
  const template = companyTemplateDefinitionSchema.parse(READERSBASE_PUBLISHING_TEMPLATE) as CompanyTemplateDefinition;
  const plan = readersBasePilotPlan(options);
  const entities = buildReadersBasePilotEntities(template);
  return materializePlannedEntities(store, template, plan, entities, options);
}

function firstRow<T extends MaterializedEntity>(rows: T[]): T | null {
  return rows[0] ?? null;
}

export function createDrizzleCompanyTemplateMaterializerStore(db: Db): CompanyTemplateMaterializerStore {
  return {
    async transaction(action) {
      return db.transaction(async (tx) => action(createDrizzleTx(tx as unknown as Db)));
    },
  };
}

function createDrizzleTx(db: Db): CompanyTemplateMaterializerTx {
  return {
    async findEntity(entityType, scope) {
      switch (entityType) {
        case "company": {
          if (scope.data?.companyId) {
            return firstRow(await db.select().from(companies).where(eq(companies.id, String(scope.data.companyId))).limit(1)) as MaterializedEntity | null;
          }
          return firstRow(await db.select().from(companies).where(eq(companies.issuePrefix, scope.slug)).limit(1)) as MaterializedEntity | null;
        }
        case "agent":
          return firstRow(await db.select().from(agents).where(and(eq(agents.companyId, String(scope.companyId)), sql`${agents.metadata}->>'templateAgentSlug' = ${scope.slug}`)).limit(1)) as MaterializedEntity | null;
        case "goal":
          return firstRow(await db.select().from(goals).where(and(eq(goals.companyId, String(scope.companyId)), eq(goals.title, String(scope.label)))).limit(1)) as MaterializedEntity | null;
        case "project":
          return firstRow(await db.select().from(projects).where(and(eq(projects.companyId, String(scope.companyId)), eq(projects.name, String(scope.label)))).limit(1)) as MaterializedEntity | null;
        case "campaign":
          return firstRow(await db.select().from(campaigns).where(and(eq(campaigns.companyId, String(scope.companyId)), eq(campaigns.title, String(scope.label)))).limit(1)) as MaterializedEntity | null;
        case "campaign_phase":
          return firstRow(await db.select().from(campaignPhases).where(and(eq(campaignPhases.campaignId, String(scope.parentId)), eq(campaignPhases.sequenceNumber, Number(scope.data?.sequenceNumber)))).limit(1)) as MaterializedEntity | null;
        case "issue":
          return firstRow(await db.select().from(issues).where(and(eq(issues.companyId, String(scope.companyId)), eq(issues.originKind, String(scope.data?.originKind ?? "company_template_materializer")), eq(issues.originId, String(scope.data?.originId)))).limit(1)) as MaterializedEntity | null;
        case "work_product":
          return firstRow(await db.select().from(issueWorkProducts).where(and(eq(issueWorkProducts.companyId, String(scope.companyId)), eq(issueWorkProducts.issueId, String(scope.parentId)), eq(issueWorkProducts.provider, String(scope.data?.provider)), eq(issueWorkProducts.externalId, String(scope.data?.externalId)))).limit(1)) as MaterializedEntity | null;
        case "artifact_contract":
          return null;
      }
    },
    async createEntity(entityType, input) {
      switch (entityType) {
        case "company":
          return firstRow(await db.insert(companies).values({
            name: String(input.data.name),
            description: input.data.description ? String(input.data.description) : null,
            issuePrefix: String(input.data.issuePrefix),
            budgetMonthlyCents: Number(input.data.budgetMonthlyCents ?? 0),
            requireBoardApprovalForNewAgents: Boolean(input.data.requireBoardApprovalForNewAgents),
          }).returning()) as MaterializedEntity;
        case "agent":
          return firstRow(await db.insert(agents).values({
            companyId: String(input.companyId),
            name: String(input.data.name),
            role: String(input.data.role),
            title: input.data.title ? String(input.data.title) : null,
            icon: input.data.icon ? String(input.data.icon) : null,
            reportsTo: input.parentId ? String(input.parentId) : null,
            capabilities: String(input.data.capabilities),
            adapterType: String(input.data.adapterType),
            adapterConfig: input.data.adapterConfig as Record<string, unknown>,
            runtimeConfig: input.data.runtimeConfig as Record<string, unknown>,
            metadata: input.data.metadata as Record<string, unknown>,
          }).returning()) as MaterializedEntity;
        case "goal":
          return firstRow(await db.insert(goals).values({
            companyId: String(input.companyId),
            title: String(input.data.title),
            description: input.data.description ? String(input.data.description) : null,
            level: String(input.data.level),
            status: String(input.data.status ?? "active"),
            parentId: input.parentId ? String(input.parentId) : null,
            ownerAgentId: input.data.ownerAgentId ? String(input.data.ownerAgentId) : null,
          }).returning()) as MaterializedEntity;
        case "project":
          return firstRow(await db.insert(projects).values({
            companyId: String(input.companyId),
            goalId: input.data.goalId ? String(input.data.goalId) : null,
            leadAgentId: input.data.leadAgentId ? String(input.data.leadAgentId) : null,
            name: String(input.data.name),
            description: input.data.description ? String(input.data.description) : null,
            status: String(input.data.status ?? "planned"),
          }).returning()) as MaterializedEntity;
        case "campaign": {
          const row = firstRow(await db.insert(campaigns).values({
            companyId: String(input.companyId),
            goalId: input.data.goalId ? String(input.data.goalId) : null,
            leadAgentId: input.data.leadAgentId ? String(input.data.leadAgentId) : null,
            title: String(input.data.title),
            objective: input.data.objective ? String(input.data.objective) : null,
            status: String(input.data.status ?? "draft"),
          }).returning()) as MaterializedEntity;
          for (const projectId of (input.data.projectIds as string[] | undefined) ?? []) {
            await db.insert(campaignProjects).values({ campaignId: row.id, projectId, companyId: String(input.companyId) }).onConflictDoNothing();
          }
          return row;
        }
        case "campaign_phase":
          return firstRow(await db.insert(campaignPhases).values({
            companyId: String(input.companyId),
            campaignId: String(input.parentId),
            sequenceNumber: Number(input.data.sequenceNumber),
            title: String(input.data.title),
            objective: input.data.objective ? String(input.data.objective) : null,
            status: String(input.data.status ?? "planning"),
            assigneeAgentId: input.data.ownerAgentSlug ? String(input.data.ownerAgentSlug) : null,
          }).returning()) as MaterializedEntity;
        case "issue":
          return firstRow(await db.insert(issues).values({
            companyId: String(input.companyId),
            projectId: input.data.projectId ? String(input.data.projectId) : null,
            goalId: input.data.goalId ? String(input.data.goalId) : null,
            title: String(input.data.title),
            description: input.data.description ? String(input.data.description) : null,
            status: String(input.data.status ?? "backlog"),
            priority: String(input.data.priority ?? "medium"),
            assigneeAgentId: input.data.assigneeAgentId ? String(input.data.assigneeAgentId) : null,
            originKind: String(input.data.originKind ?? "company_template_materializer"),
            originId: String(input.data.originId),
            originFingerprint: String(input.data.originFingerprint ?? "default"),
            executionPolicy: input.data.executionPolicy as Record<string, unknown>,
          }).returning()) as MaterializedEntity;
        case "work_product":
          return firstRow(await db.insert(issueWorkProducts).values({
            companyId: String(input.companyId),
            projectId: input.data.projectId ? String(input.data.projectId) : null,
            issueId: String(input.parentId),
            type: String(input.data.type),
            provider: String(input.data.provider),
            externalId: input.data.externalId ? String(input.data.externalId) : null,
            title: String(input.data.title),
            status: String(input.data.status),
            reviewState: String(input.data.reviewState ?? "none"),
            isPrimary: Boolean(input.data.isPrimary),
            healthStatus: String(input.data.healthStatus ?? "unknown"),
            summary: input.data.summary ? String(input.data.summary) : null,
            metadata: input.data.metadata as Record<string, unknown>,
          }).returning()) as MaterializedEntity;
        case "artifact_contract":
          return { id: input.slug };
      }
    },
  };
}
