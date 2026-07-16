import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "22222222-2222-4222-8222-222222222222";
const otherCompanyId = "99999999-9999-4999-8999-999999999999";
const campaignId = "33333333-3333-4333-8333-333333333333";
const phaseId = "44444444-4444-4444-8444-444444444444";
const projectId = "55555555-5555-4555-8555-555555555555";
const approvalId = "66666666-6666-4666-8666-666666666666";
const revisionId = "77777777-7777-4777-8777-777777777777";
const planDocumentId = "88888888-8888-4888-8888-888888888888";

const campaign = {
  id: campaignId,
  companyId,
  goalId: null,
  leadAgentId: null,
  title: "Readerbase fantasy world",
  objective: "Build a deeply intertwined fantasy setting.",
  status: "draft",
  createdByAgentId: null,
  createdByUserId: "board-user",
  updatedByAgentId: null,
  updatedByUserId: "board-user",
  archivedAt: null,
  createdAt: new Date("2026-05-25T00:00:00.000Z"),
  updatedAt: new Date("2026-05-25T00:00:00.000Z"),
};

const detail = {
  ...campaign,
  projects: [
    {
      id: projectId,
      name: "Production",
      description: "Production work",
      status: "in_progress",
      color: "#2563eb",
    },
  ],
  leadAgent: null,
  phaseCount: 0,
  activePhase: null,
  pendingReviewCount: 0,
  phases: [],
};

const phase = {
  id: phaseId,
  companyId,
  campaignId,
  sequenceNumber: 1,
  title: "Magical jobs",
  objective: "Define mage jobs and why each belongs.",
  status: "planning",
  planDocumentId,
  resultDocumentId: null,
  approvalId: null,
  approvedPlanRevisionId: null,
  executionIssueId: null,
  assigneeAgentId: null,
  createdByAgentId: null,
  createdByUserId: "board-user",
  updatedByAgentId: null,
  updatedByUserId: "board-user",
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2026-05-25T00:00:00.000Z"),
  updatedAt: new Date("2026-05-25T00:00:00.000Z"),
  assignee: null,
  planDocument: {
    id: planDocumentId,
    title: "Readerbase fantasy world: Magical jobs plan",
    format: "markdown",
    latestBody: "## Plan\n\n- Propose jobs",
    latestRevisionId: revisionId,
    latestRevisionNumber: 1,
    updatedAt: new Date("2026-05-25T00:00:00.000Z"),
  },
  resultDocument: null,
  approval: null,
  executionIssue: null,
};

const submission = {
  phase: {
    ...phase,
    status: "in_review",
    approvalId,
  },
  approval: {
    id: approvalId,
    companyId,
    type: "campaign_phase_plan",
    requestedByAgentId: null,
    requestedByUserId: "board-user",
    status: "pending",
    payload: {
      kind: "campaign_phase_plan",
      campaignId,
      campaignTitle: "Readerbase fantasy world",
      phaseId,
      phaseTitle: "Magical jobs",
      planDocumentId,
      planRevisionId: revisionId,
      assigneeAgentId: null,
      projectIds: [projectId],
    },
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: new Date("2026-05-25T00:00:00.000Z"),
    updatedAt: new Date("2026-05-25T00:00:00.000Z"),
  },
  planRevision: {
    id: revisionId,
    companyId,
    documentId: planDocumentId,
    revisionNumber: 1,
    title: "Readerbase fantasy world: Magical jobs plan",
    format: "markdown",
    body: "## Plan\n\n- Propose jobs",
    changeSummary: "Created campaign phase plan",
    createdByAgentId: null,
    createdByUserId: "board-user",
    createdAt: new Date("2026-05-25T00:00:00.000Z"),
  },
};

const mockCampaignService = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  getDetail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  replaceProjects: vi.fn(),
  listPhases: vi.fn(),
  getPhase: vi.fn(),
  createPhase: vi.fn(),
  updatePhase: vi.fn(),
  upsertPhasePlan: vi.fn(),
  submitPlanForReview: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    campaignService: () => mockCampaignService,
    logActivity: mockLogActivity,
  }));
}

async function createApp(actor: Record<string, unknown>) {
  const [{ errorHandler }, { campaignRoutes }] = await Promise.all([
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../routes/campaigns.js")>("../routes/campaigns.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", campaignRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("campaign routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/campaigns.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockCampaignService.list.mockResolvedValue([detail]);
    mockCampaignService.get.mockResolvedValue(campaign);
    mockCampaignService.getDetail.mockResolvedValue(detail);
    mockCampaignService.create.mockResolvedValue(campaign);
    mockCampaignService.update.mockResolvedValue({ ...detail, title: "Updated campaign" });
    mockCampaignService.replaceProjects.mockResolvedValue(detail);
    mockCampaignService.listPhases.mockResolvedValue([phase]);
    mockCampaignService.getPhase.mockResolvedValue(phase);
    mockCampaignService.createPhase.mockResolvedValue(phase);
    mockCampaignService.updatePhase.mockResolvedValue({ ...phase, title: "Updated phase" });
    mockCampaignService.upsertPhasePlan.mockResolvedValue({
      id: planDocumentId,
      title: "Readerbase fantasy world: Magical jobs plan",
      format: "markdown",
      latestBody: "## Plan\n\n- Updated jobs",
      latestRevisionId: revisionId,
      latestRevisionNumber: 2,
      updatedAt: new Date("2026-05-25T00:00:00.000Z"),
    });
    mockCampaignService.submitPlanForReview.mockResolvedValue(submission);
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("lists campaigns for the requested company only", async () => {
    const app = await createApp({
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [companyId],
    });

    const res = await request(app).get(`/api/companies/${companyId}/campaigns`);

    expect(res.status).toBe(200);
    expect(mockCampaignService.list).toHaveBeenCalledWith(companyId);
    expect(res.body.every((item: { companyId: string }) => item.companyId === companyId)).toBe(true);
  });

  it("blocks campaign lists across company scope", async () => {
    const app = await createApp({
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [otherCompanyId],
    });

    const res = await request(app).get(`/api/companies/${companyId}/campaigns`);

    expect(res.status).toBe(403);
    expect(mockCampaignService.list).not.toHaveBeenCalled();
  });

  it("creates a campaign with linked projects", async () => {
    const app = await createApp({
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [companyId],
    });

    const res = await request(app)
      .post(`/api/companies/${companyId}/campaigns`)
      .send({
        title: "Readerbase fantasy world",
        objective: "Build a deeply intertwined fantasy setting.",
        projectIds: [projectId],
      });

    expect(res.status).toBe(201);
    expect(mockCampaignService.create).toHaveBeenCalledWith(companyId, expect.objectContaining({
      title: "Readerbase fantasy world",
      projectIds: [projectId],
    }), {
      agentId: null,
      userId: "board-user",
      runId: null,
    });
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "campaign.created",
      entityType: "campaign",
      entityId: campaignId,
      details: expect.objectContaining({ projectIds: [projectId] }),
    }));
  });

  it("gets and updates one campaign with company access", async () => {
    const app = await createApp({
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [companyId],
    });

    const get = await request(app).get(`/api/campaigns/${campaignId}`);
    const patch = await request(app)
      .patch(`/api/campaigns/${campaignId}`)
      .send({ title: "Updated campaign" });

    expect(get.status).toBe(200);
    expect(patch.status).toBe(200);
    expect(mockCampaignService.getDetail).toHaveBeenCalledWith(campaignId);
    expect(mockCampaignService.update).toHaveBeenCalledWith(companyId, campaignId, expect.objectContaining({
      title: "Updated campaign",
    }), {
      agentId: null,
      userId: "board-user",
      runId: null,
    });
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "campaign.updated",
      details: { changedKeys: ["title"] },
    }));
  });

  it("replaces campaign projects with company access", async () => {
    const app = await createApp({
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [companyId],
    });

    const res = await request(app)
      .put(`/api/campaigns/${campaignId}/projects`)
      .send({ projectIds: [projectId] });

    expect(res.status).toBe(200);
    expect(mockCampaignService.replaceProjects).toHaveBeenCalledWith(companyId, campaignId, [projectId]);
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "campaign.projects_replaced",
    }));
  });

  it("lists and creates phases for a campaign", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "11111111-1111-4111-8111-111111111111",
      companyId,
      runId: "99999999-9999-4999-8999-999999999999",
    });

    const list = await request(app).get(`/api/campaigns/${campaignId}/phases`);
    const created = await request(app)
      .post(`/api/campaigns/${campaignId}/phases`)
      .send({
        title: "Magical jobs",
        objective: "Define mage jobs and why each belongs.",
        planBody: "## Plan\n\n- Propose jobs",
      });

    expect(list.status).toBe(200);
    expect(created.status).toBe(201);
    expect(mockCampaignService.listPhases).toHaveBeenCalledWith(companyId, campaignId);
    expect(mockCampaignService.createPhase).toHaveBeenCalledWith(companyId, campaignId, expect.objectContaining({
      title: "Magical jobs",
    }), {
      agentId: "11111111-1111-4111-8111-111111111111",
      userId: null,
      runId: "99999999-9999-4999-8999-999999999999",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "campaign_phase.created",
      agentId: "11111111-1111-4111-8111-111111111111",
      runId: "99999999-9999-4999-8999-999999999999",
    }));
  });

  it("upserts and submits phase plans for review", async () => {
    const app = await createApp({
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [companyId],
    });

    const upsert = await request(app)
      .put(`/api/campaign-phases/${phaseId}/plan`)
      .send({
        body: "## Plan\n\n- Updated jobs",
        changeSummary: "Updated jobs",
      });
    const submit = await request(app)
      .post(`/api/campaign-phases/${phaseId}/submit-plan`)
      .send({ decisionNote: "Ready for review." });

    expect(upsert.status).toBe(200);
    expect(submit.status).toBe(201);
    expect(mockCampaignService.upsertPhasePlan).toHaveBeenCalledWith(companyId, phaseId, expect.objectContaining({
      body: "## Plan\n\n- Updated jobs",
    }), {
      agentId: null,
      userId: "board-user",
      runId: null,
    });
    expect(mockCampaignService.submitPlanForReview).toHaveBeenCalledWith(companyId, phaseId, expect.objectContaining({
      decisionNote: "Ready for review.",
    }), {
      agentId: null,
      userId: "board-user",
      runId: null,
    });
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "campaign_phase.plan_submitted",
      details: expect.objectContaining({ approvalId, planRevisionId: revisionId }),
    }));
  });
});
