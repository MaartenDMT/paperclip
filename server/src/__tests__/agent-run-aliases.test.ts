import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  buildRunOutputSilence: vi.fn(),
  getRetryExhaustedReason: vi.fn(),
  getRun: vi.fn(),
  getRunLogAccess: vi.fn(),
  readLog: vi.fn(),
}));

const mockInstanceSettingsService = vi.hoisted(() => ({
  get: vi.fn(),
  getExperimental: vi.fn(),
  getGeneral: vi.fn(),
  listCompanyIds: vi.fn(),
}));

function registerModuleMocks() {
  vi.doMock("../services/agents.js", () => ({
    agentService: () => mockAgentService,
  }));

  vi.doMock("../services/heartbeat.js", () => ({
    heartbeatService: () => mockHeartbeatService,
  }));

  vi.doMock("../services/instance-settings.js", () => ({
    instanceSettingsService: () => mockInstanceSettingsService,
  }));

  vi.doMock("../services/index.js", () => ({
    agentService: () => mockAgentService,
    agentInstructionsService: () => ({}),
    accessService: () => ({}),
    approvalService: () => ({}),
    companySkillService: () => ({ listRuntimeSkillEntries: vi.fn() }),
    budgetService: () => ({}),
    heartbeatService: () => mockHeartbeatService,
    issueApprovalService: () => ({}),
    issueService: () => ({}),
    logActivity: vi.fn(),
    secretService: () => ({}),
    syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
    workspaceOperationService: () => ({}),
  }));

  vi.doMock("../adapters/index.js", () => ({
    findServerAdapter: vi.fn(),
    listAdapterModels: vi.fn(),
    detectAdapterModel: vi.fn(),
    findActiveServerAdapter: vi.fn(),
    requireServerAdapter: vi.fn(),
  }));

  vi.doMock("../routes/authz.js", () => ({
    assertBoard: vi.fn(),
    assertCompanyAccess: vi.fn(),
    assertInstanceAdmin: vi.fn(),
    getActorInfo: vi.fn(() => ({
      actorType: "board",
      actorId: "local-board",
      userId: "local-board",
      runId: null,
      agentId: null,
    })),
  }));
}

async function createApp() {
  const [{ agentRoutes }, { createLegacyApiCompatibilityMiddleware }] = await Promise.all([
    vi.importActual<typeof import("../routes/agents.js")>("../routes/agents.js"),
    vi.importActual<typeof import("../legacy-api-compat.js")>("../legacy-api-compat.js"),
  ]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });

  const routes = agentRoutes({} as any);
  app.use(createLegacyApiCompatibilityMiddleware(routes));
  app.use("/api", routes);
  return app;
}

describe("agent run aliases", () => {
  let app: express.Express;

  beforeAll(async () => {
    vi.resetModules();
    registerModuleMocks();
    app = await createApp();
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.getById.mockResolvedValue({
      id: AGENT_ID,
      companyId: "company-1",
      name: "Builder",
      adapterType: "codex_local",
    });
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
      agentId: AGENT_ID,
      issueId: "issue-1",
      status: "running",
      invocationSource: "on_demand",
      triggerDetail: "manual",
      startedAt: new Date("2026-04-10T09:30:00.000Z"),
      finishedAt: null,
      createdAt: new Date("2026-04-10T09:29:59.000Z"),
      logBytes: 0,
      logStore: "local_file",
      logRef: "logs/run-1.ndjson",
    });
    mockHeartbeatService.getRetryExhaustedReason.mockResolvedValue(null);
    mockHeartbeatService.buildRunOutputSilence.mockResolvedValue(null);
    mockHeartbeatService.getRunLogAccess.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
      logStore: "local_file",
      logRef: "logs/run-1.ndjson",
    });
    mockHeartbeatService.readLog.mockResolvedValue({
      runId: "run-1",
      store: "local_file",
      logRef: "logs/run-1.ndjson",
      content: "chunk",
      nextOffset: 5,
    });
    mockInstanceSettingsService.get.mockResolvedValue({
      id: "instance-settings-1",
      general: {
        censorUsernameInLogs: false,
        feedbackDataSharingPreference: "prompt",
      },
    });
    mockInstanceSettingsService.getExperimental.mockResolvedValue({});
    mockInstanceSettingsService.getGeneral.mockResolvedValue({
      censorUsernameInLogs: false,
      feedbackDataSharingPreference: "prompt",
    });
    mockInstanceSettingsService.listCompanyIds.mockResolvedValue(["company-1"]);
  });

  it("serves /api/runs/:runId/logs", async () => {
    const res = await request(app).get("/api/runs/run-1/logs?offset=12&limitBytes=64");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockHeartbeatService.getRunLogAccess).toHaveBeenCalledWith("run-1");
    expect(mockHeartbeatService.readLog).toHaveBeenCalledWith(
      {
        id: "run-1",
        companyId: "company-1",
        logStore: "local_file",
        logRef: "logs/run-1.ndjson",
      },
      {
        offset: 12,
        limitBytes: 64,
      },
    );
    expect(res.body).toEqual({
      runId: "run-1",
      store: "local_file",
      logRef: "logs/run-1.ndjson",
      content: "chunk",
      nextOffset: 5,
    });
  });

  it("serves legacy root /agents/:id/runs/:runId through compatibility routing", async () => {
    const res = await request(app).get(`/agents/${AGENT_ID}/runs/run-1`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockAgentService.getById).toHaveBeenCalledWith(AGENT_ID);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith("run-1");
    expect(res.body).toMatchObject({
      id: "run-1",
      agentId: AGENT_ID,
      companyId: "company-1",
      status: "running",
    });
  });
});
