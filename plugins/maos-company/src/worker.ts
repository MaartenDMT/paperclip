import { randomUUID } from "node:crypto";
import {
  definePlugin,
  runWorker,
  type PluginApiRequestInput,
  type PluginApiResponse,
  type PluginContext,
} from "@paperclipai/plugin-sdk";
import { assertCampaignPhaseTransition, isCampaignPhaseStatus, type CampaignPhaseStatus } from "./campaign-policy.js";
import { buildMeetingRecommendation, meetingWorkflowPolicy, MEETING_TRIGGERS, type MeetingTrigger } from "./meeting-policy.js";

type JsonObject = Record<string, unknown>;
type ApiHandler = (input: PluginApiRequestInput) => Promise<PluginApiResponse>;

const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed", "cancelled", "archived"] as const;
type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

type CampaignRow = {
  id: string;
  company_id: string;
  goal_id: string | null;
  lead_agent_id: string | null;
  title: string;
  objective: string | null;
  status: CampaignStatus;
  project_ids: string[];
  created_by_agent_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type CampaignPhaseRow = {
  id: string;
  company_id: string;
  campaign_id: string;
  sequence_number: number;
  title: string;
  objective: string | null;
  status: CampaignPhaseStatus;
  assignee_agent_id: string | null;
  plan_document_id: string | null;
  result_document_id: string | null;
  approval_id: string | null;
  approved_plan_revision_id: string | null;
  execution_issue_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const handlers = new Map<string, ApiHandler>();

function objectBody(input: PluginApiRequestInput): JsonObject {
  if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) {
    throw new Error("JSON object body is required");
  }
  return input.body as JsonObject;
}

function requiredString(value: unknown, name: string, max = 20_000): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${name} exceeds ${max} characters`);
  return result;
}

function optionalString(value: unknown, name: string, max = 20_000): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${name} must be a string or null`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${name} exceeds ${max} characters`);
  return result || null;
}

function optionalId(value: unknown, name: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${name} must be a string or null`);
  return value;
}

function stringArray(value: unknown, name: string, max = 50): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  if (value.length > max) throw new Error(`${name} cannot contain more than ${max} entries`);
  return [...new Set(value as string[])];
}

function mapCampaign(row: CampaignRow) {
  return {
    id: row.id,
    companyId: row.company_id,
    goalId: row.goal_id,
    leadAgentId: row.lead_agent_id,
    title: row.title,
    objective: row.objective,
    status: row.status,
    projectIds: row.project_ids,
    createdByAgentId: row.created_by_agent_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPhase(row: CampaignPhaseRow) {
  return {
    id: row.id,
    companyId: row.company_id,
    campaignId: row.campaign_id,
    sequenceNumber: row.sequence_number,
    title: row.title,
    objective: row.objective,
    status: row.status,
    assigneeAgentId: row.assignee_agent_id,
    planDocumentId: row.plan_document_id,
    resultDocumentId: row.result_document_id,
    approvalId: row.approval_id,
    approvedPlanRevisionId: row.approved_plan_revision_id,
    executionIssueId: row.execution_issue_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertCompany(ctx: PluginContext, companyId: string) {
  if (!(await ctx.companies.get(companyId))) throw new Error("Company not found");
}

async function assertCampaignReferences(ctx: PluginContext, input: {
  companyId: string;
  goalId: string | null;
  leadAgentId: string | null;
  projectIds: string[];
}) {
  await assertCompany(ctx, input.companyId);
  if (input.goalId && !(await ctx.goals.get(input.goalId, input.companyId))) {
    throw new Error("Campaign goal must belong to the same company");
  }
  if (input.leadAgentId && !(await ctx.agents.get(input.leadAgentId, input.companyId))) {
    throw new Error("Campaign lead must belong to the same company");
  }
  for (const projectId of input.projectIds) {
    if (!(await ctx.projects.get(projectId, input.companyId))) {
      throw new Error("Campaign projects must belong to the same company");
    }
  }
}

async function getCampaign(ctx: PluginContext, companyId: string, campaignId: string) {
  const [row] = await ctx.db.query<CampaignRow>(
    `SELECT * FROM ${ctx.db.namespace}.campaigns WHERE id = $1 AND company_id = $2`,
    [campaignId, companyId],
  );
  return row ?? null;
}

function actorValues(input: PluginApiRequestInput) {
  return {
    agentId: input.actor.agentId ?? null,
    userId: input.actor.userId ?? null,
  };
}

function registerCampaignHandlers(ctx: PluginContext) {
  handlers.set("campaigns.list", async (input) => {
    const rows = await ctx.db.query<CampaignRow>(
      `SELECT * FROM ${ctx.db.namespace}.campaigns WHERE company_id = $1 ORDER BY created_at DESC`,
      [input.companyId],
    );
    return { status: 200, body: rows.map(mapCampaign) };
  });

  handlers.set("campaigns.get", async (input) => {
    const campaign = await getCampaign(ctx, input.companyId, input.params.campaignId);
    if (!campaign) return { status: 404, body: { error: "Campaign not found" } };
    const phases = await ctx.db.query<CampaignPhaseRow>(
      `SELECT * FROM ${ctx.db.namespace}.campaign_phases WHERE campaign_id = $1 AND company_id = $2 ORDER BY sequence_number`,
      [campaign.id, input.companyId],
    );
    return { status: 200, body: { ...mapCampaign(campaign), phases: phases.map(mapPhase) } };
  });

  handlers.set("campaigns.create", async (input) => {
    const body = objectBody(input);
    const title = requiredString(body.title, "title", 200);
    const objective = optionalString(body.objective, "objective");
    const goalId = optionalId(body.goalId, "goalId");
    const leadAgentId = optionalId(body.leadAgentId, "leadAgentId");
    const projectIds = stringArray(body.projectIds, "projectIds");
    const status = body.status ?? "draft";
    if (!CAMPAIGN_STATUSES.includes(status as CampaignStatus)) throw new Error("Invalid campaign status");
    await assertCampaignReferences(ctx, { companyId: input.companyId, goalId, leadAgentId, projectIds });
    const id = randomUUID();
    const actor = actorValues(input);
    await ctx.db.execute(
      `INSERT INTO ${ctx.db.namespace}.campaigns
       (id, company_id, goal_id, lead_agent_id, title, objective, status, project_ids, created_by_agent_id, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [id, input.companyId, goalId, leadAgentId, title, objective, status, JSON.stringify(projectIds), actor.agentId, actor.userId],
    );
    return {
      status: 201,
      body: { id, companyId: input.companyId, goalId, leadAgentId, title, objective, status, projectIds },
    };
  });

  handlers.set("campaigns.update", async (input) => {
    const current = await getCampaign(ctx, input.companyId, input.params.campaignId);
    if (!current) return { status: 404, body: { error: "Campaign not found" } };
    const body = objectBody(input);
    const title = body.title === undefined ? current.title : requiredString(body.title, "title", 200);
    const objective = body.objective === undefined ? current.objective : optionalString(body.objective, "objective");
    const goalId = body.goalId === undefined ? current.goal_id : optionalId(body.goalId, "goalId");
    const leadAgentId = body.leadAgentId === undefined ? current.lead_agent_id : optionalId(body.leadAgentId, "leadAgentId");
    const projectIds = body.projectIds === undefined ? current.project_ids : stringArray(body.projectIds, "projectIds");
    const status = body.status === undefined ? current.status : body.status;
    if (!CAMPAIGN_STATUSES.includes(status as CampaignStatus)) throw new Error("Invalid campaign status");
    await assertCampaignReferences(ctx, { companyId: input.companyId, goalId, leadAgentId, projectIds });
    await ctx.db.execute(
      `UPDATE ${ctx.db.namespace}.campaigns
       SET goal_id = $3, lead_agent_id = $4, title = $5, objective = $6, status = $7, project_ids = $8::jsonb, updated_at = now()
       WHERE id = $1 AND company_id = $2`,
      [current.id, input.companyId, goalId, leadAgentId, title, objective, status, JSON.stringify(projectIds)],
    );
    return { status: 200, body: { ...mapCampaign(current), goalId, leadAgentId, title, objective, status, projectIds } };
  });

  handlers.set("campaign-phases.create", async (input) => {
    const campaign = await getCampaign(ctx, input.companyId, input.params.campaignId);
    if (!campaign) return { status: 404, body: { error: "Campaign not found" } };
    const body = objectBody(input);
    const title = requiredString(body.title, "title", 200);
    const objective = optionalString(body.objective, "objective");
    const assigneeAgentId = optionalId(body.assigneeAgentId, "assigneeAgentId");
    if (assigneeAgentId && !(await ctx.agents.get(assigneeAgentId, input.companyId))) {
      throw new Error("Phase assignee must belong to the same company");
    }
    const [sequence] = await ctx.db.query<{ next_sequence: number }>(
      `SELECT coalesce(max(sequence_number), 0) + 1 AS next_sequence
       FROM ${ctx.db.namespace}.campaign_phases WHERE campaign_id = $1`,
      [campaign.id],
    );
    const sequenceNumber = typeof body.sequenceNumber === "number" ? body.sequenceNumber : sequence?.next_sequence ?? 1;
    if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) throw new Error("sequenceNumber must be a positive integer");
    const id = randomUUID();
    await ctx.db.execute(
      `INSERT INTO ${ctx.db.namespace}.campaign_phases
       (id, company_id, campaign_id, sequence_number, title, objective, assignee_agent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, input.companyId, campaign.id, sequenceNumber, title, objective, assigneeAgentId],
    );
    return { status: 201, body: { id, companyId: input.companyId, campaignId: campaign.id, sequenceNumber, title, objective, status: "planning", assigneeAgentId } };
  });

  handlers.set("campaign-phases.transition", async (input) => {
    const [phase] = await ctx.db.query<CampaignPhaseRow>(
      `SELECT * FROM ${ctx.db.namespace}.campaign_phases WHERE id = $1 AND company_id = $2`,
      [input.params.phaseId, input.companyId],
    );
    if (!phase) return { status: 404, body: { error: "Campaign phase not found" } };
    const body = objectBody(input);
    if (!isCampaignPhaseStatus(body.status)) throw new Error("Invalid campaign phase status");
    assertCampaignPhaseTransition(phase.status, body.status);
    await ctx.db.execute(
      `UPDATE ${ctx.db.namespace}.campaign_phases
       SET status = $3,
           started_at = CASE WHEN $3 = 'in_progress' THEN coalesce(started_at, now()) ELSE started_at END,
           completed_at = CASE WHEN $3 IN ('completed', 'skipped') THEN coalesce(completed_at, now()) ELSE completed_at END,
           updated_at = now()
       WHERE id = $1 AND company_id = $2`,
      [phase.id, input.companyId, body.status],
    );
    return { status: 200, body: { ...mapPhase(phase), status: body.status } };
  });
}

function registerGoalBindingHandlers(ctx: PluginContext) {
  handlers.set("goal-bindings.list", async (input) => {
    const rows = await ctx.db.query(
      `SELECT company_id, goal_id, maos_system_id, created_at, updated_at
       FROM ${ctx.db.namespace}.goal_bindings WHERE company_id = $1 ORDER BY maos_system_id`,
      [input.companyId],
    );
    return { status: 200, body: rows };
  });

  handlers.set("goal-bindings.upsert", async (input) => {
    const body = objectBody(input);
    const goalId = requiredString(body.goalId, "goalId", 100);
    const maosSystemId = requiredString(body.maosSystemId, "maosSystemId", 100);
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(maosSystemId)) {
      throw new Error("maosSystemId must use lowercase kebab-case");
    }
    if (!(await ctx.goals.get(goalId, input.companyId))) throw new Error("Goal must belong to the same company");
    await ctx.db.execute(
      `INSERT INTO ${ctx.db.namespace}.goal_bindings (company_id, goal_id, maos_system_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_id, goal_id)
       DO UPDATE SET maos_system_id = excluded.maos_system_id, updated_at = now()`,
      [input.companyId, goalId, maosSystemId],
    );
    return { status: 200, body: { companyId: input.companyId, goalId, maosSystemId } };
  });
}

function registerMeetingHandlers(ctx: PluginContext) {
  handlers.set("meeting-policy.get", async () => ({ status: 200, body: meetingWorkflowPolicy }));

  handlers.set("meeting-recommendations.create", async (input) => {
    const body = objectBody(input);
    if (!MEETING_TRIGGERS.includes(body.trigger as MeetingTrigger)) throw new Error("Invalid meeting trigger");
    const recommendation = buildMeetingRecommendation({
      trigger: body.trigger as MeetingTrigger,
      issueId: optionalId(body.issueId, "issueId"),
      issueIdentifier: optionalString(body.issueIdentifier, "issueIdentifier", 100),
      issueTitle: optionalString(body.issueTitle, "issueTitle", 200),
      participantAgentIds: stringArray(body.participantAgentIds, "participantAgentIds", 30),
    });
    if (recommendation.issueId && !(await ctx.issues.get(recommendation.issueId, input.companyId))) {
      throw new Error("Meeting source issue must belong to the same company");
    }
    for (const agentId of recommendation.participantAgentIds) {
      if (!(await ctx.agents.get(agentId, input.companyId))) {
        throw new Error("Meeting participants must belong to the same company");
      }
    }
    const id = randomUUID();
    await ctx.db.execute(
      `INSERT INTO ${ctx.db.namespace}.meeting_recommendations
       (id, company_id, trigger, severity, title, issue_id, participant_agent_ids, agenda, expected_outputs)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)`,
      [
        id,
        input.companyId,
        recommendation.trigger,
        recommendation.severity,
        recommendation.title,
        recommendation.issueId,
        JSON.stringify(recommendation.participantAgentIds),
        JSON.stringify(recommendation.agenda),
        JSON.stringify(recommendation.expectedOutputs),
      ],
    );
    return { status: 201, body: { id, companyId: input.companyId, ...recommendation, status: "recommended" } };
  });
}

const plugin = definePlugin({
  async setup(ctx) {
    handlers.clear();
    registerCampaignHandlers(ctx);
    registerGoalBindingHandlers(ctx);
    registerMeetingHandlers(ctx);
  },

  async onApiRequest(input) {
    const handler = handlers.get(input.routeKey);
    if (!handler) return { status: 404, body: { error: `Unknown MAOS company route: ${input.routeKey}` } };
    return handler(input);
  },

  async onHealth() {
    return {
      status: "ok",
      message: "MAOS company automation worker is running",
      details: { surfaces: ["campaigns", "goal-bindings", "meeting-policy", "database-namespace", "scoped-api"] },
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
