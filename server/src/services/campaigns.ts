import { and, asc, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@paperclipai/db";
import {
  agents,
  approvals,
  campaignPhases,
  campaignProjects,
  campaigns,
  documentRevisions,
  documents,
  goals,
  issues,
  projects,
} from "@paperclipai/db";
import type {
  Approval,
  Campaign,
  CampaignAgentSummary,
  CampaignDetail,
  CampaignDocumentSummary,
  CampaignDocumentRevision,
  CampaignIssueSummary,
  CampaignListItem,
  CampaignPhase,
  CampaignPhaseDetail,
  CampaignPhaseTaskProgress,
  CampaignPhasePlanApprovalPayload,
  CampaignPhasePlanSubmission,
  CampaignPhaseStatus,
  CampaignProjectSummary,
  CampaignStatus,
  CompleteCampaignPhase,
  CreateCampaign,
  CreateCampaignPhase,
  LinkCampaignPhaseExecutionIssue,
  SubmitCampaignPhasePlanForReview,
  UpdateCampaign,
  UpdateCampaignPhase,
  UpsertCampaignPhasePlan,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { documentService } from "./documents.js";
import { issueService } from "./issues.js";

type ActorInput = {
  agentId?: string | null;
  userId?: string | null;
  runId?: string | null;
};

type CampaignRow = typeof campaigns.$inferSelect;
type CampaignPhaseRow = typeof campaignPhases.$inferSelect;
type ApprovalRow = typeof approvals.$inferSelect;
type DocumentRow = typeof documents.$inferSelect;
type DocumentRevisionRow = typeof documentRevisions.$inferSelect;
type CampaignPhaseTaskRow = Pick<
  typeof issues.$inferSelect,
  "id" | "identifier" | "title" | "status" | "priority" | "updatedAt"
>;

const CAMPAIGN_PHASE_EXECUTION_ORIGIN_KIND = "campaign_phase_execution";
const CAMPAIGN_PHASE_EXECUTION_UNIQUE_CONSTRAINT = "issues_campaign_phase_execution_uq";

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

function isCampaignPhaseExecutionUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; constraint?: string; constraint_name?: string; message?: string; cause?: unknown };
  const constraint = maybe.constraint ?? maybe.constraint_name;
  const isDuplicate = maybe.code === "23505" &&
    (
      constraint === CAMPAIGN_PHASE_EXECUTION_UNIQUE_CONSTRAINT ||
      typeof maybe.message === "string" && maybe.message.includes(CAMPAIGN_PHASE_EXECUTION_UNIQUE_CONSTRAINT)
    );
  return isDuplicate || isCampaignPhaseExecutionUniqueConflict(maybe.cause);
}

function toCampaign(row: CampaignRow): Campaign {
  return {
    ...row,
    status: row.status as CampaignStatus,
  };
}

function toCampaignPhase(row: CampaignPhaseRow): CampaignPhase {
  return {
    ...row,
    status: row.status as CampaignPhaseStatus,
  };
}

function toApproval(row: ApprovalRow | null): Approval | null {
  if (!row) return null;
  return {
    ...row,
    type: row.type as Approval["type"],
    status: row.status as Approval["status"],
  };
}

function toDocumentSummary(row: DocumentRow | null): CampaignDocumentSummary | null {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    format: "markdown",
    latestBody: row.latestBody,
    latestRevisionId: row.latestRevisionId,
    latestRevisionNumber: row.latestRevisionNumber,
    updatedAt: row.updatedAt,
  };
}

function toCampaignDocumentRevision(row: DocumentRevisionRow): CampaignDocumentRevision {
  return {
    id: row.id,
    companyId: row.companyId,
    documentId: row.documentId,
    revisionNumber: row.revisionNumber,
    title: row.title,
    format: "markdown",
    body: row.body,
    changeSummary: row.changeSummary,
    createdByAgentId: row.createdByAgentId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

function toCampaignIssueSummary(row: CampaignPhaseTaskRow): CampaignIssueSummary {
  return {
    id: row.id,
    identifier: row.identifier,
    title: row.title,
    status: row.status as CampaignIssueSummary["status"],
    priority: row.priority as CampaignIssueSummary["priority"],
    updatedAt: row.updatedAt,
  };
}

function priorityRank(priority: string): number {
  if (priority === "critical") return 0;
  if (priority === "high") return 1;
  if (priority === "medium") return 2;
  if (priority === "low") return 3;
  return 4;
}

function buildTaskProgress(
  rows: CampaignPhaseTaskRow[],
  source: CampaignPhaseTaskProgress["source"],
): CampaignPhaseTaskProgress {
  const statusCounts: CampaignPhaseTaskProgress["statusCounts"] = {
    backlog: 0,
    todo: 0,
    in_progress: 0,
    in_review: 0,
    done: 0,
    blocked: 0,
    cancelled: 0,
  };

  for (const row of rows) {
    if (row.status in statusCounts) {
      statusCounts[row.status as keyof typeof statusCounts] += 1;
    }
  }

  const nextIssues = rows
    .filter((row) => row.status !== "done" && row.status !== "cancelled")
    .sort((left, right) => {
      const leftStatusRank = left.status === "blocked" ? 0 : left.status === "in_progress" ? 1 : left.status === "in_review" ? 2 : 3;
      const rightStatusRank = right.status === "blocked" ? 0 : right.status === "in_progress" ? 1 : right.status === "in_review" ? 2 : 3;
      if (leftStatusRank !== rightStatusRank) return leftStatusRank - rightStatusRank;
      const priorityDiff = priorityRank(left.priority) - priorityRank(right.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    })
    .slice(0, 5)
    .map(toCampaignIssueSummary);

  return {
    source,
    totalCount: rows.length,
    openCount: rows.length - statusCounts.done - statusCounts.cancelled,
    completedCount: statusCounts.done,
    cancelledCount: statusCounts.cancelled,
    statusCounts,
    nextIssues,
  };
}

export function campaignService(db: Db) {
  const documentsSvc = documentService(db);

  async function getPhaseTaskProgress(
    companyId: string,
    executionIssue: CampaignPhaseTaskRow | null,
  ): Promise<CampaignPhaseTaskProgress | null> {
    if (!executionIssue) return null;

    const childIssues = alias(issues, "campaign_phase_child_issues");
    const subtreeCondition = sql<boolean>`
      ${issues.id} IN (
        WITH RECURSIVE issue_tree(id) AS (
          SELECT ${issues.id}
          FROM ${issues}
          WHERE ${issues.companyId} = ${companyId}
            AND ${issues.parentId} = ${executionIssue.id}
            AND ${issues.hiddenAt} IS NULL
          UNION ALL
          SELECT ${childIssues.id}
          FROM ${issues} ${childIssues}
          JOIN issue_tree ON ${childIssues.parentId} = issue_tree.id
          WHERE ${childIssues.companyId} = ${companyId}
            AND ${childIssues.hiddenAt} IS NULL
        )
        SELECT id FROM issue_tree
      )
    `;

    const descendants = await db
      .select({
        id: issues.id,
        identifier: issues.identifier,
        title: issues.title,
        status: issues.status,
        priority: issues.priority,
        updatedAt: issues.updatedAt,
      })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), isNull(issues.hiddenAt), subtreeCondition));

    if (descendants.length > 0) {
      return buildTaskProgress(descendants, "subtree");
    }

    return buildTaskProgress([executionIssue], "execution_issue");
  }

  async function assertProjectOwnership(companyId: string, projectIds: string[]) {
    const ids = uniqueIds(projectIds);
    if (ids.length === 0) return;

    const rows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), inArray(projects.id, ids)));

    if (rows.length !== ids.length) {
      throw unprocessable("Campaign projects must belong to the same company");
    }
  }

  async function assertAgentOwnership(companyId: string, agentId: string | null | undefined, fieldName: string) {
    if (!agentId) return;

    const row = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
      .then((rows) => rows[0] ?? null);

    if (!row) {
      throw unprocessable(`${fieldName} must belong to the same company`);
    }
  }

  async function assertGoalOwnership(companyId: string, goalId: string | null | undefined) {
    if (!goalId) return;

    const row = await db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.companyId, companyId)))
      .then((rows) => rows[0] ?? null);

    if (!row) {
      throw unprocessable("Campaign goal must belong to the same company");
    }
  }

  async function get(id: string): Promise<Campaign | null> {
    const row = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return row ? toCampaign(row) : null;
  }

  async function getByCompany(companyId: string, id: string): Promise<Campaign | null> {
    const row = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.companyId, companyId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return row ? toCampaign(row) : null;
  }

  async function getPhase(id: string): Promise<CampaignPhase | null> {
    const row = await db
      .select()
      .from(campaignPhases)
      .where(eq(campaignPhases.id, id))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return row ? toCampaignPhase(row) : null;
  }

  async function getPhaseRow(id: string): Promise<CampaignPhaseRow | null> {
    return db
      .select()
      .from(campaignPhases)
      .where(eq(campaignPhases.id, id))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function getAgentSummary(agentId: string): Promise<CampaignAgentSummary | null> {
    return db
      .select({
        id: agents.id,
        name: agents.name,
        role: agents.role,
        title: agents.title,
        icon: agents.icon,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function hydratePhase(row: CampaignPhaseRow): Promise<CampaignPhaseDetail> {
    const [planDocument, resultDocument, approval, executionIssue, assignee] = await Promise.all([
      row.planDocumentId
        ? db.select().from(documents).where(eq(documents.id, row.planDocumentId)).limit(1).then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      row.resultDocumentId
        ? db.select().from(documents).where(eq(documents.id, row.resultDocumentId)).limit(1).then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      row.approvalId
        ? db.select().from(approvals).where(eq(approvals.id, row.approvalId)).limit(1).then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      row.executionIssueId
        ? db
          .select({
            id: issues.id,
            identifier: issues.identifier,
            title: issues.title,
            status: issues.status,
            priority: issues.priority,
            updatedAt: issues.updatedAt,
          })
          .from(issues)
          .where(eq(issues.id, row.executionIssueId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      row.assigneeAgentId ? getAgentSummary(row.assigneeAgentId) : Promise.resolve(null),
    ]);

    const executionIssueSummary = executionIssue ? toCampaignIssueSummary(executionIssue) : null;

    return {
      ...toCampaignPhase(row),
      assignee,
      planDocument: toDocumentSummary(planDocument),
      resultDocument: toDocumentSummary(resultDocument),
      approval: toApproval(approval),
      executionIssue: executionIssueSummary,
      taskProgress: await getPhaseTaskProgress(row.companyId, executionIssue),
    };
  }

  async function listPhasesForCampaign(campaignId: string): Promise<CampaignPhaseDetail[]> {
    const rows = await db
      .select()
      .from(campaignPhases)
      .where(eq(campaignPhases.campaignId, campaignId))
      .orderBy(asc(campaignPhases.sequenceNumber), asc(campaignPhases.createdAt));
    return Promise.all(rows.map((row) => hydratePhase(row)));
  }

  async function listPhases(companyId: string, campaignId: string): Promise<CampaignPhaseDetail[]> {
    const campaign = await getByCompany(companyId, campaignId);
    if (!campaign) throw notFound("Campaign not found");
    return listPhasesForCampaign(campaignId);
  }

  async function hydrateListItem(row: CampaignRow): Promise<CampaignListItem> {
    const [projectRows, phaseRows, leadAgent] = await Promise.all([
      db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          status: projects.status,
          color: projects.color,
        })
        .from(campaignProjects)
        .innerJoin(projects, eq(campaignProjects.projectId, projects.id))
        .where(eq(campaignProjects.campaignId, row.id))
        .orderBy(asc(projects.name), asc(projects.id)),
      listPhasesForCampaign(row.id),
      row.leadAgentId ? getAgentSummary(row.leadAgentId) : Promise.resolve(null),
    ]);

    const activePhase =
      phaseRows.find((phase) =>
        ["in_review", "revision_requested", "approved", "executing"].includes(phase.status),
      ) ??
      phaseRows.find((phase) => !["completed", "cancelled"].includes(phase.status)) ??
      null;

    return {
      ...toCampaign(row),
      projects: projectRows as CampaignProjectSummary[],
      leadAgent,
      phaseCount: phaseRows.length,
      activePhase,
      pendingReviewCount: phaseRows.filter((phase) => phase.status === "in_review").length,
    };
  }

  async function list(companyId: string): Promise<CampaignListItem[]> {
    const rows = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.companyId, companyId))
      .orderBy(desc(campaigns.updatedAt), desc(campaigns.createdAt));
    return Promise.all(rows.map((row) => hydrateListItem(row)));
  }

  async function getDetail(id: string): Promise<CampaignDetail | null> {
    const row = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!row) return null;

    const [item, phases] = await Promise.all([
      hydrateListItem(row),
      listPhasesForCampaign(id),
    ]);

    return { ...item, phases };
  }

  async function insertProjectLinks(
    tx: any,
    companyId: string,
    campaignId: string,
    projectIds: string[],
  ) {
    const ids = uniqueIds(projectIds);
    if (ids.length === 0) return;

    await tx.insert(campaignProjects).values(
      ids.map((projectId) => ({
        companyId,
        campaignId,
        projectId,
      })),
    );
  }

  async function create(
    companyId: string,
    data: CreateCampaign,
    actor: ActorInput = {},
  ): Promise<Campaign> {
    const projectIds = data.projectIds ?? [];
    await assertGoalOwnership(companyId, data.goalId);
    await assertAgentOwnership(companyId, data.leadAgentId, "Campaign lead agent");
    await assertProjectOwnership(companyId, projectIds);

    const created = await db.transaction(async (tx) => {
      const campaign = await tx
        .insert(campaigns)
        .values({
          companyId,
          goalId: data.goalId ?? null,
          leadAgentId: data.leadAgentId ?? null,
          title: data.title,
          objective: data.objective ?? null,
          status: data.status ?? "draft",
          createdByAgentId: actor.agentId ?? null,
          createdByUserId: actor.userId ?? null,
          updatedByAgentId: actor.agentId ?? null,
          updatedByUserId: actor.userId ?? null,
        })
        .returning()
        .then((rows) => rows[0]!);

      await insertProjectLinks(tx, companyId, campaign.id, projectIds);

      return campaign;
    });

    return toCampaign(created);
  }

  async function replaceProjects(
    companyId: string,
    campaignId: string,
    projectIds: string[],
  ): Promise<CampaignDetail | null> {
    const campaign = await getByCompany(companyId, campaignId);
    if (!campaign) throw notFound("Campaign not found");

    await assertProjectOwnership(companyId, projectIds);

    await db.transaction(async (tx) => {
      await tx.delete(campaignProjects).where(eq(campaignProjects.campaignId, campaignId));
      await insertProjectLinks(tx, companyId, campaignId, projectIds);
      await tx.update(campaigns).set({ updatedAt: new Date() }).where(eq(campaigns.id, campaignId));
    });

    return getDetail(campaignId);
  }

  async function update(
    companyId: string,
    campaignId: string,
    data: UpdateCampaign,
    actor: ActorInput = {},
  ): Promise<CampaignDetail | null> {
    const existing = await getByCompany(companyId, campaignId);
    if (!existing) throw notFound("Campaign not found");

    if (data.goalId !== undefined) {
      await assertGoalOwnership(companyId, data.goalId);
    }
    if (data.leadAgentId !== undefined) {
      await assertAgentOwnership(companyId, data.leadAgentId, "Campaign lead agent");
    }
    if (data.projectIds !== undefined) {
      await assertProjectOwnership(companyId, data.projectIds);
    }

    await db.transaction(async (tx) => {
      await tx
        .update(campaigns)
        .set({
          ...(data.goalId !== undefined ? { goalId: data.goalId } : {}),
          ...(data.leadAgentId !== undefined ? { leadAgentId: data.leadAgentId } : {}),
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.objective !== undefined ? { objective: data.objective } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.archivedAt !== undefined ? { archivedAt: data.archivedAt ? new Date(data.archivedAt) : null } : {}),
          updatedByAgentId: actor.agentId ?? null,
          updatedByUserId: actor.userId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(campaigns.id, campaignId));

      if (data.projectIds !== undefined) {
        await tx.delete(campaignProjects).where(eq(campaignProjects.campaignId, campaignId));
        await insertProjectLinks(tx, companyId, campaignId, data.projectIds);
      }
    });

    return getDetail(campaignId);
  }

  async function createPhase(
    companyId: string,
    campaignId: string,
    data: CreateCampaignPhase,
    actor: ActorInput = {},
  ): Promise<CampaignPhaseDetail> {
    const campaign = await getByCompany(companyId, campaignId);
    if (!campaign) throw notFound("Campaign not found");

    const assigneeAgentId = data.assigneeAgentId ?? campaign.leadAgentId ?? null;
    await assertAgentOwnership(companyId, assigneeAgentId, "Campaign phase assignee");

    const created = await db.transaction(async (tx) => {
      const sequenceNumber: number =
        data.sequenceNumber ??
        (await tx
          .select({ value: max(campaignPhases.sequenceNumber) })
          .from(campaignPhases)
          .where(eq(campaignPhases.campaignId, campaignId))
          .then((rows) => Number(rows[0]?.value ?? 0) + 1));

      const planDocument =
        data.planBody !== undefined && data.planBody !== null
          ? await documentsSvc.upsertStandaloneDocument(tx, {
              companyId: campaign.companyId,
              title: `${campaign.title}: ${data.title} plan`,
              body: data.planBody,
              createdByAgentId: actor.agentId ?? null,
              createdByUserId: actor.userId ?? null,
              updatedByAgentId: actor.agentId ?? null,
              updatedByUserId: actor.userId ?? null,
              changeSummary: "Created campaign phase plan",
            })
          : null;

      return tx
        .insert(campaignPhases)
        .values({
          companyId: campaign.companyId,
          campaignId,
          sequenceNumber,
          title: data.title,
          objective: data.objective ?? null,
          assigneeAgentId,
          planDocumentId: planDocument?.id ?? null,
          createdByAgentId: actor.agentId ?? null,
          createdByUserId: actor.userId ?? null,
          updatedByAgentId: actor.agentId ?? null,
          updatedByUserId: actor.userId ?? null,
        })
        .returning()
        .then((rows) => rows[0]!);
    });

    return hydratePhase(created);
  }

  async function updatePhase(
    companyId: string,
    phaseId: string,
    data: UpdateCampaignPhase,
    actor: ActorInput = {},
  ): Promise<CampaignPhaseDetail> {
    const phase = await getPhaseRow(phaseId);
    if (!phase || phase.companyId !== companyId) throw notFound("Campaign phase not found");

    if (data.assigneeAgentId !== undefined) {
      await assertAgentOwnership(companyId, data.assigneeAgentId, "Campaign phase assignee");
    }

    const [updated] = await db
      .update(campaignPhases)
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.objective !== undefined ? { objective: data.objective } : {}),
        ...(data.sequenceNumber !== undefined ? { sequenceNumber: data.sequenceNumber } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.assigneeAgentId !== undefined ? { assigneeAgentId: data.assigneeAgentId } : {}),
        updatedByAgentId: actor.agentId ?? null,
        updatedByUserId: actor.userId ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(campaignPhases.id, phaseId), eq(campaignPhases.companyId, companyId)))
      .returning();

    if (!updated) throw notFound("Campaign phase not found");
    return hydratePhase(updated);
  }

  async function linkExecutionIssue(
    companyId: string,
    phaseId: string,
    data: LinkCampaignPhaseExecutionIssue,
    actor: ActorInput = {},
  ): Promise<CampaignPhaseDetail> {
    const phase = await getPhaseRow(phaseId);
    if (!phase || phase.companyId !== companyId) throw notFound("Campaign phase not found");

    if (data.issueId) {
      const [issue] = await db
        .select({ id: issues.id, companyId: issues.companyId })
        .from(issues)
        .where(and(eq(issues.id, data.issueId), eq(issues.companyId, companyId)))
        .limit(1);
      if (!issue) throw notFound("Issue not found");
    }

    const [updated] = await db
      .update(campaignPhases)
      .set({
        executionIssueId: data.issueId,
        updatedByAgentId: actor.agentId ?? null,
        updatedByUserId: actor.userId ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(campaignPhases.id, phaseId), eq(campaignPhases.companyId, companyId)))
      .returning();

    if (!updated) throw notFound("Campaign phase not found");
    return hydratePhase(updated);
  }

  async function completePhase(
    companyId: string,
    phaseId: string,
    data: CompleteCampaignPhase,
    actor: ActorInput = {},
  ): Promise<CampaignPhaseDetail> {
    const phase = await getPhaseRow(phaseId);
    if (!phase || phase.companyId !== companyId) throw notFound("Campaign phase not found");
    if (phase.status === "completed") throw conflict("Campaign phase is already completed");
    if (phase.status === "cancelled") throw conflict("Cancelled campaign phases cannot be completed");

    const campaign = await get(phase.campaignId);
    if (!campaign) throw notFound("Campaign not found");

    const executionIssue = phase.executionIssueId
      ? await db
          .select({ identifier: issues.identifier, title: issues.title, status: issues.status })
          .from(issues)
          .where(and(eq(issues.companyId, companyId), eq(issues.id, phase.executionIssueId)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;
    if (phase.executionIssueId && !executionIssue) throw notFound("Campaign phase execution issue not found");
    if (executionIssue && !["done", "cancelled"].includes(executionIssue.status)) {
      throw conflict("Campaign phase execution issue must be done or cancelled before completion");
    }

    const resultBody = data.resultBody?.trim() || [
      `# ${phase.title} result`,
      "",
      executionIssue
        ? `Execution issue ${executionIssue.identifier ?? phase.executionIssueId} is ${executionIssue.status}: ${executionIssue.title}`
        : "Completed by board action.",
    ].join("\n");
    const resultTitle = data.resultTitle?.trim() || `${campaign.title}: ${phase.title} result`;
    const now = new Date();

    const updated = await db.transaction(async (tx) => {
      const document = await documentsSvc.upsertStandaloneDocument(tx, {
        companyId,
        documentId: phase.resultDocumentId,
        title: resultTitle,
        body: resultBody,
        createdByAgentId: actor.agentId ?? null,
        createdByUserId: actor.userId ?? null,
        updatedByAgentId: actor.agentId ?? null,
        updatedByUserId: actor.userId ?? null,
        changeSummary: phase.resultDocumentId ? "Updated campaign phase result" : "Created campaign phase result",
      });

      const [row] = await tx
        .update(campaignPhases)
        .set({
          status: "completed",
          resultDocumentId: document.id,
          startedAt: phase.startedAt ?? now,
          completedAt: now,
          updatedByAgentId: actor.agentId ?? null,
          updatedByUserId: actor.userId ?? null,
          updatedAt: now,
        })
        .where(and(eq(campaignPhases.id, phase.id), eq(campaignPhases.companyId, companyId)))
        .returning();
      return row ?? null;
    });

    if (!updated) throw notFound("Campaign phase not found");
    return hydratePhase(updated);
  }

  async function upsertPhasePlan(
    companyId: string,
    phaseId: string,
    data: UpsertCampaignPhasePlan,
    actor: ActorInput = {},
  ): Promise<CampaignDocumentSummary> {
    const phase = await getPhaseRow(phaseId);
    if (!phase) throw notFound("Campaign phase not found");
    if (phase.companyId !== companyId) throw notFound("Campaign phase not found");
    if (["approved", "executing", "completed", "cancelled"].includes(phase.status)) {
      throw conflict("Approved, executing, completed, or cancelled phase plans cannot be edited");
    }

    const campaign = await get(phase.campaignId);
    if (!campaign) throw notFound("Campaign not found");

    const updated = await db.transaction(async (tx) => {
      const document = await documentsSvc.upsertStandaloneDocument(tx, {
        companyId: phase.companyId,
        documentId: phase.planDocumentId,
        title: `${campaign.title}: ${phase.title} plan`,
        body: data.body,
        createdByAgentId: actor.agentId ?? null,
        createdByUserId: actor.userId ?? null,
        updatedByAgentId: actor.agentId ?? null,
        updatedByUserId: actor.userId ?? null,
        changeSummary: data.changeSummary ?? "Updated campaign phase plan",
      });

      await tx
        .update(campaignPhases)
        .set({
          planDocumentId: document.id,
          status: phase.status === "in_review" ? "planning" : phase.status,
          updatedByAgentId: actor.agentId ?? null,
          updatedByUserId: actor.userId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(campaignPhases.id, phase.id));

      return document;
    });

    return toDocumentSummary(updated)!;
  }

  async function submitPlanForReview(
    companyId: string,
    phaseId: string,
    data: SubmitCampaignPhasePlanForReview,
    actor: ActorInput = {},
  ): Promise<CampaignPhasePlanSubmission> {
    const { approval, planRevision, updatedPhase } = await db.transaction(async (tx) => {
      const phase = await tx
        .select()
        .from(campaignPhases)
        .where(and(eq(campaignPhases.id, phaseId), eq(campaignPhases.companyId, companyId)))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (!phase) throw notFound("Campaign phase not found");
      if (!phase.planDocumentId) throw conflict("Campaign phase is missing a plan document");
      if (phase.status === "in_review") throw conflict("Campaign phase plan is already in review");
      if (["approved", "executing", "completed", "cancelled"].includes(phase.status)) {
        throw conflict("Campaign phase cannot be submitted from its current status");
      }

      const campaign = await tx
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, phase.campaignId), eq(campaigns.companyId, phase.companyId)))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (!campaign) throw notFound("Campaign not found");

      const planDocument = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, phase.planDocumentId), eq(documents.companyId, phase.companyId)))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (!planDocument?.latestRevisionId) throw conflict("Plan document has no revision to approve");

      const projectRows = await tx
        .select({ projectId: campaignProjects.projectId })
        .from(campaignProjects)
        .where(and(eq(campaignProjects.campaignId, campaign.id), eq(campaignProjects.companyId, campaign.companyId)))
        .orderBy(asc(campaignProjects.projectId));

      const planRevision = await tx
        .select()
        .from(documentRevisions)
        .where(
          and(
            eq(documentRevisions.id, planDocument.latestRevisionId),
            eq(documentRevisions.companyId, phase.companyId),
            eq(documentRevisions.documentId, planDocument.id),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (!planRevision) throw conflict("Plan document has no revision to approve");

      const now = new Date();
      const claimedPhase = await tx
        .update(campaignPhases)
        .set({
          status: "in_review",
          updatedByAgentId: actor.agentId ?? null,
          updatedByUserId: actor.userId ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(campaignPhases.id, phase.id),
            eq(campaignPhases.companyId, companyId),
            inArray(campaignPhases.status, ["planning", "revision_requested"]),
          ),
        )
        .returning()
        .then((rows) => rows[0] ?? null);

      if (!claimedPhase) {
        const latest = await tx
          .select()
          .from(campaignPhases)
          .where(and(eq(campaignPhases.id, phase.id), eq(campaignPhases.companyId, companyId)))
          .limit(1)
          .then((rows) => rows[0] ?? null);
        if (!latest) throw notFound("Campaign phase not found");
        if (latest.status === "in_review") throw conflict("Campaign phase plan is already in review");
        throw conflict("Campaign phase cannot be submitted from its current status");
      }

      const payload: CampaignPhasePlanApprovalPayload = {
        kind: "campaign_phase_plan",
        campaignId: campaign.id,
        campaignTitle: campaign.title,
        phaseId: claimedPhase.id,
        phaseTitle: claimedPhase.title,
        planDocumentId: planDocument.id,
        planRevisionId: planRevision.id,
        assigneeAgentId: claimedPhase.assigneeAgentId,
        projectIds: projectRows.map((row) => row.projectId),
      };

      const createdApproval = await tx
        .insert(approvals)
        .values({
          companyId: campaign.companyId,
          type: "campaign_phase_plan",
          requestedByAgentId: actor.agentId ?? null,
          requestedByUserId: actor.userId ?? null,
          status: "pending",
          payload: { ...payload },
          decisionNote: data.decisionNote ?? null,
          decidedByUserId: null,
          decidedAt: null,
        })
        .returning()
        .then((rows) => rows[0]!);

      const updatedPhase = await tx
        .update(campaignPhases)
        .set({
          approvalId: createdApproval.id,
          updatedAt: now,
        })
        .where(and(eq(campaignPhases.id, claimedPhase.id), eq(campaignPhases.companyId, companyId)))
        .returning()
        .then((rows) => rows[0]!);

      return { approval: createdApproval, planRevision, updatedPhase };
    });

    return {
      phase: await hydratePhase(updatedPhase),
      approval: toApproval(approval)!,
      planRevision: toCampaignDocumentRevision(planRevision),
    };
  }

  async function handleApprovalApproved(
    approvalId: string,
    actor: ActorInput = {},
  ): Promise<CampaignPhaseDetail | null> {
    const approval = await db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!approval || approval.type !== "campaign_phase_plan") return null;

    const payload = approval.payload as Partial<CampaignPhasePlanApprovalPayload>;
    const currentPhase = await db
      .select()
      .from(campaignPhases)
      .where(and(eq(campaignPhases.approvalId, approval.id), eq(campaignPhases.companyId, approval.companyId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!currentPhase) return null;

    const now = new Date();
    const preservesStatus = ["executing", "completed", "cancelled"].includes(currentPhase.status);
    const updated = await db
      .update(campaignPhases)
      .set({
        status: preservesStatus ? currentPhase.status : "approved",
        approvedPlanRevisionId: typeof payload.planRevisionId === "string" ? payload.planRevisionId : null,
        updatedByAgentId: actor.agentId ?? null,
        updatedByUserId: actor.userId ?? null,
        updatedAt: now,
      })
      .where(and(eq(campaignPhases.approvalId, approval.id), eq(campaignPhases.companyId, approval.companyId)))
      .returning()
      .then((rows) => rows[0] ?? null);

    if (!updated) return null;
    if (updated.executionIssueId) return hydratePhase(updated);

    const campaign = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, updated.campaignId), eq(campaigns.companyId, approval.companyId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!campaign) throw notFound("Campaign not found");

    const findExecutionIssue = () =>
      db
        .select({ id: issues.id })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, approval.companyId),
            eq(issues.originKind, CAMPAIGN_PHASE_EXECUTION_ORIGIN_KIND),
            eq(issues.originId, updated.id),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);

    const existingExecutionIssue = await findExecutionIssue();

    let executionIssueId = existingExecutionIssue?.id ?? null;
    if (!executionIssueId) {
      const projectRows = await db
        .select({ projectId: campaignProjects.projectId })
        .from(campaignProjects)
        .where(
          and(
            eq(campaignProjects.companyId, approval.companyId),
            eq(campaignProjects.campaignId, campaign.id),
          ),
        )
        .orderBy(asc(campaignProjects.projectId));
      const projectIds = uniqueIds(projectRows.map((row) => row.projectId));
      const projectId = projectIds.length === 1 ? projectIds[0] : null;
      const approvedPlanRevisionId =
        typeof payload.planRevisionId === "string" ? payload.planRevisionId : updated.approvedPlanRevisionId;
      try {
        const issue = await issueService(db).create(approval.companyId, {
          projectId,
          goalId: campaign.goalId ?? undefined,
          title: `Execute campaign phase: ${campaign.title} - ${updated.title}`,
          description: [
            `Execute the approved campaign phase plan for "${updated.title}" in campaign "${campaign.title}".`,
            "",
            `Campaign ID: ${campaign.id}`,
            `Campaign phase ID: ${updated.id}`,
            approvedPlanRevisionId ? `Approved plan revision ID: ${approvedPlanRevisionId}` : null,
            updated.planDocumentId ? `Plan document ID: ${updated.planDocumentId}` : null,
            "",
            "This issue was created automatically when the campaign phase plan was approved. Approval is the execution gate; no second start-work approval is required.",
          ].filter((line): line is string => line !== null).join("\n"),
          status: "todo",
          priority: "medium",
          assigneeAgentId: updated.assigneeAgentId,
          createdByAgentId: actor.agentId ?? null,
          createdByUserId: actor.userId ?? null,
          originKind: CAMPAIGN_PHASE_EXECUTION_ORIGIN_KIND,
          originId: updated.id,
          originRunId: actor.runId ?? null,
          originFingerprint: approvedPlanRevisionId ?? approval.id,
        });
        executionIssueId = issue.id;
      } catch (error) {
        if (!isCampaignPhaseExecutionUniqueConflict(error)) throw error;
        const racedIssue = await findExecutionIssue();
        if (!racedIssue) throw error;
        executionIssueId = racedIssue.id;
      }
    }

    const phaseWithExecutionIssue = await db
      .update(campaignPhases)
      .set({
        executionIssueId,
        updatedByAgentId: actor.agentId ?? null,
        updatedByUserId: actor.userId ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(campaignPhases.id, updated.id),
          eq(campaignPhases.companyId, approval.companyId),
        ),
      )
      .returning()
      .then((rows) => rows[0] ?? updated);

    return hydratePhase(phaseWithExecutionIssue);
  }

  async function handleApprovalRevisionRequested(
    approvalId: string,
    actor: ActorInput = {},
  ): Promise<CampaignPhaseDetail | null> {
    const approval = await db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!approval || approval.type !== "campaign_phase_plan") return null;

    const updated = await db
      .update(campaignPhases)
      .set({
        status: "revision_requested",
        updatedByAgentId: actor.agentId ?? null,
        updatedByUserId: actor.userId ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(campaignPhases.approvalId, approval.id), eq(campaignPhases.companyId, approval.companyId)))
      .returning()
      .then((rows) => rows[0] ?? null);

    return updated ? hydratePhase(updated) : null;
  }

  return {
    get,
    getPhase,
    list,
    getDetail,
    hydrateListItem,
    getAgentSummary,
    create,
    replaceProjects,
    update,
    listPhases,
    hydratePhase,
    createPhase,
    updatePhase,
    linkExecutionIssue,
    completePhase,
    upsertPhasePlan,
    submitPlanForReview,
    handleApprovalApproved,
    handleApprovalRevisionRequested,
  };
}
