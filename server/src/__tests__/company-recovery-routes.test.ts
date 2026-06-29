import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  reconcilePersistedHeartbeatRuntimeState: vi.fn(),
  reapOrphanedRuns: vi.fn(),
  scanSilentActiveRuns: vi.fn(),
  reconcileStrandedAssignedIssues: vi.fn(),
  reconcileIssueGraphLiveness: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  backfillPullRequestWorkProductsFromComments: vi.fn(),
  previewPullRequestWorkProductBackfillFromComments: vi.fn(),
  recoverPullRequestWorkProducts: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    agentService: () => mockAgentService,
    heartbeatService: () => mockHeartbeatService,
    issueService: () => mockIssueService,
    logActivity: mockLogActivity,
  }));
}

async function createApp(actor: Express.Request["actor"]) {
  const [{ companyRecoveryRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/company-recovery.js")>("../routes/company-recovery.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", companyRecoveryRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("company recovery routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/company-recovery.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockAgentService.getById.mockResolvedValue({
      id: "ceo-1",
      companyId: "company-1",
      role: "ceo",
      permissions: {},
    });
    mockHeartbeatService.reconcilePersistedHeartbeatRuntimeState.mockResolvedValue({
      terminalClaimedWakeups: 0,
      terminalQueuedWakeups: 0,
      stalePreSpawnRuns: 1,
      orphanedQueuedWakeups: 0,
      staleQueuedRuns: 2,
      blockedQueuedRuns: 1,
      staleRunningAgents: 0,
    });
    mockHeartbeatService.reapOrphanedRuns.mockResolvedValue({
      reaped: 1,
      runIds: ["run-stale"],
    });
    mockHeartbeatService.scanSilentActiveRuns.mockResolvedValue({
      scanned: 1,
      created: 0,
      existing: 0,
      escalated: 0,
      snoozed: 0,
      skipped: 0,
      closedTerminal: 0,
      closedHealthy: 1,
      evaluationIssueIds: [],
    });
    mockHeartbeatService.reconcileStrandedAssignedIssues.mockResolvedValue({
      assignmentDispatched: 0,
      dispatchRequeued: 0,
      continuationRequeued: 0,
      productiveContinuationObserved: 0,
      successfulContinuationObserved: 0,
      orphanBlockersAssigned: 0,
      successfulRunHandoffEscalated: 0,
      escalated: 1,
      skipped: 0,
      issueIds: ["issue-1"],
    });
    mockHeartbeatService.reconcileIssueGraphLiveness.mockResolvedValue({
      findings: 1,
      autoRecoveryEnabled: true,
      lookbackHours: 12,
      cutoff: "2026-05-30T00:00:00.000Z",
      escalationsCreated: 0,
      existingEscalations: 0,
      skipped: 0,
      skippedAutoRecoveryDisabled: 0,
      skippedOutsideLookback: 0,
      obsoleteRecoveriesRetired: 0,
      obsoleteRecoveriesActiveSkipped: 0,
      obsoleteRecoveryBlockerRelationsRemoved: 1,
      issueIds: ["issue-2"],
      escalationIssueIds: [],
      retiredRecoveryIssueIds: [],
    });
    mockIssueService.backfillPullRequestWorkProductsFromComments.mockResolvedValue({
      commentsScanned: 3,
      commentsWithPullRequests: 2,
      pullRequestWorkProductsCreated: 1,
      pullRequestWorkProductsUpdated: 1,
      issueIds: ["issue-3"],
    });
    mockIssueService.recoverPullRequestWorkProducts.mockResolvedValue({
      backfill: {
        commentsScanned: 3,
        commentsWithPullRequests: 2,
        pullRequestWorkProductsCreated: 1,
        pullRequestWorkProductsUpdated: 1,
        issueIds: ["issue-3"],
      },
      githubStatusSync: {
        scanned: 2,
        checked: 2,
        updated: 1,
        skippedFresh: 0,
        skippedUnparseable: 0,
        failed: 0,
        workProductIds: ["work-product-1"],
        failures: [],
      },
    });
    mockIssueService.previewPullRequestWorkProductBackfillFromComments.mockResolvedValue({
      commentsScanned: 557,
      commentsWithPullRequests: 557,
      issuesWithPullRequestComments: 246,
      distinctPullRequests: 246,
      existingPullRequestWorkProducts: 0,
      missingPullRequestWorkProducts: 246,
      pullRequestWorkProductsNeedingStatusUpdate: 0,
      issueIds: ["issue-3"],
    });
  });

  it("previews pull request work-product backfill without mutating issue work products", async () => {
    const app = await createApp({
      type: "board",
      userId: "board-1",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: true,
    });

    const res = await request(app)
      .get("/api/companies/company-1/control-plane/pull-request-work-products/backfill/preview");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockIssueService.previewPullRequestWorkProductBackfillFromComments).toHaveBeenCalledWith("company-1");
    expect(mockIssueService.backfillPullRequestWorkProductsFromComments).not.toHaveBeenCalled();
    expect(mockIssueService.recoverPullRequestWorkProducts).not.toHaveBeenCalled();
    expect(res.body.preview).toMatchObject({
      commentsScanned: 557,
      issuesWithPullRequestComments: 246,
      missingPullRequestWorkProducts: 246,
    });
  });

  it("applies pull request work-product backfill as a narrow recovery operation", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "ceo-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/companies/company-1/control-plane/pull-request-work-products/backfill/apply")
      .send({});

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockIssueService.recoverPullRequestWorkProducts).toHaveBeenCalledWith(
      "company-1",
      { runId: "run-1" },
      { force: true },
    );
    expect(mockIssueService.backfillPullRequestWorkProductsFromComments).not.toHaveBeenCalled();
    expect(mockHeartbeatService.reconcilePersistedHeartbeatRuntimeState).not.toHaveBeenCalled();
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      companyId: "company-1",
      actorType: "agent",
      action: "company.pull_request_work_product_recovery",
      details: expect.objectContaining({
        backfill: expect.objectContaining({
          pullRequestWorkProductsCreated: 1,
          pullRequestWorkProductsUpdated: 1,
        }),
        githubStatusSync: expect.objectContaining({ updated: 1 }),
      }),
    }));
    expect(res.body.result).toMatchObject({
      backfill: {
        pullRequestWorkProductsCreated: 1,
        pullRequestWorkProductsUpdated: 1,
      },
      githubStatusSync: { updated: 1 },
    });
  });

  it("allows a CEO agent to run company-scoped control-plane recovery", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "ceo-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/companies/company-1/control-plane/recovery/run")
      .send({ lookbackHours: 12 });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockHeartbeatService.reconcilePersistedHeartbeatRuntimeState).toHaveBeenCalledWith({ companyId: "company-1" });
    expect(mockHeartbeatService.reapOrphanedRuns).toHaveBeenCalledWith({ staleThresholdMs: 5 * 60 * 1000 });
    expect(mockHeartbeatService.scanSilentActiveRuns).toHaveBeenCalledWith({ companyId: "company-1" });
    expect(mockHeartbeatService.reconcileStrandedAssignedIssues).toHaveBeenCalledWith({ companyId: "company-1" });
    expect(mockHeartbeatService.reconcileIssueGraphLiveness).toHaveBeenCalledWith({
      companyId: "company-1",
      runId: "run-1",
      force: true,
      lookbackHours: 12,
    });
    expect(mockIssueService.recoverPullRequestWorkProducts).toHaveBeenCalledWith(
      "company-1",
      { runId: "run-1" },
    );
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      companyId: "company-1",
      actorType: "agent",
      actorId: "ceo-1",
      agentId: "ceo-1",
      runId: "run-1",
      action: "company.control_plane_recovery_run",
      entityType: "company",
      entityId: "company-1",
    }));
    expect(res.body).toMatchObject({
      companyId: "company-1",
      actor: { type: "agent", agentId: "ceo-1" },
      persistedHeartbeatRuntimeState: { stalePreSpawnRuns: 1, staleQueuedRuns: 2, blockedQueuedRuns: 1 },
      orphanedHeartbeatRuns: { reaped: 1, runIds: ["run-stale"] },
      silentActiveRuns: { closedHealthy: 1 },
      strandedAssignedIssues: { escalated: 1 },
      issueGraphLiveness: { obsoleteRecoveryBlockerRelationsRemoved: 1 },
      pullRequestWorkProductBackfill: {
        commentsScanned: 3,
        commentsWithPullRequests: 2,
        pullRequestWorkProductsCreated: 1,
        pullRequestWorkProductsUpdated: 1,
        issueIds: ["issue-3"],
      },
      pullRequestWorkProductStatusSync: {
        scanned: 2,
        checked: 2,
        updated: 1,
      },
    });
  });

  it("rejects non-CEO agents even in the same company", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "engineer-1",
      companyId: "company-1",
      role: "engineer",
      permissions: {},
    });
    const app = await createApp({
      type: "agent",
      agentId: "engineer-1",
      companyId: "company-1",
      source: "agent_key",
    });

    const res = await request(app)
      .post("/api/companies/company-1/control-plane/recovery/run")
      .send({});

    expect(res.status).toBe(403);
    expect(mockHeartbeatService.reconcilePersistedHeartbeatRuntimeState).not.toHaveBeenCalled();
    expect(mockHeartbeatService.reapOrphanedRuns).not.toHaveBeenCalled();
    expect(mockHeartbeatService.scanSilentActiveRuns).not.toHaveBeenCalled();
    expect(mockIssueService.backfillPullRequestWorkProductsFromComments).not.toHaveBeenCalled();
    expect(mockIssueService.recoverPullRequestWorkProducts).not.toHaveBeenCalled();
  });

  it("rejects CEO agents crossing company boundaries", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "ceo-1",
      companyId: "company-1",
      source: "agent_key",
    });

    const res = await request(app)
      .post("/api/companies/company-2/control-plane/recovery/run")
      .send({});

    expect(res.status).toBe(403);
    expect(mockHeartbeatService.reconcilePersistedHeartbeatRuntimeState).not.toHaveBeenCalled();
    expect(mockHeartbeatService.reapOrphanedRuns).not.toHaveBeenCalled();
    expect(mockHeartbeatService.scanSilentActiveRuns).not.toHaveBeenCalled();
  });
});
