import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalService } from "../services/approvals.ts";

const mockAgentService = vi.hoisted(() => ({
  activatePendingApproval: vi.fn(),
  create: vi.fn(),
  terminate: vi.fn(),
}));

const mockNotifyHireApproved = vi.hoisted(() => vi.fn());

const mockCampaignService = vi.hoisted(() => ({
  handleApprovalApproved: vi.fn(),
  handleApprovalRevisionRequested: vi.fn(),
}));

vi.mock("../services/agents.js", () => ({
  agentService: vi.fn(() => mockAgentService),
}));

vi.mock("../services/campaigns.js", () => ({
  campaignService: vi.fn(() => mockCampaignService),
}));

vi.mock("../services/hire-hook.js", () => ({
  notifyHireApproved: mockNotifyHireApproved,
}));

type ApprovalRecord = {
  id: string;
  companyId: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  requestedByAgentId: string | null;
};

function createApproval(status: string, type = "hire_agent"): ApprovalRecord {
  return {
    id: "approval-1",
    companyId: "company-1",
    type,
    status,
    payload: type === "hire_agent" ? { agentId: "agent-1" } : { phaseId: "phase-1" },
    requestedByAgentId: "requester-1",
  };
}

function createDbStub(selectResults: ApprovalRecord[][], updateResults: ApprovalRecord[]) {
  const pendingSelectResults = [...selectResults];
  const selectWhere = vi.fn(async () => pendingSelectResults.shift() ?? []);
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));

  const returning = vi.fn(async () => updateResults);
  const updateWhere = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return {
    db: { select, update },
    selectWhere,
    returning,
  };
}

describe("approvalService resolution idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.activatePendingApproval.mockResolvedValue({ agent: { id: "agent-1" }, activated: true });
    mockAgentService.create.mockResolvedValue({ id: "agent-1" });
    mockAgentService.terminate.mockResolvedValue(undefined);
    mockNotifyHireApproved.mockResolvedValue(undefined);
    mockCampaignService.handleApprovalApproved.mockResolvedValue(null);
    mockCampaignService.handleApprovalRevisionRequested.mockResolvedValue(null);
  });

  it("treats repeated approve retries as no-ops after another worker resolves the approval", async () => {
    const dbStub = createDbStub(
      [[createApproval("pending")], [createApproval("approved")]],
      [],
    );

    const svc = approvalService(dbStub.db as any);
    const result = await svc.approve("approval-1", "board", "ship it");

    expect(result.applied).toBe(false);
    expect(result.approval.status).toBe("approved");
    expect(mockAgentService.activatePendingApproval).not.toHaveBeenCalled();
    expect(mockNotifyHireApproved).not.toHaveBeenCalled();
    expect(mockCampaignService.handleApprovalApproved).not.toHaveBeenCalled();
  });

  it("repairs campaign approval side effects on approved retry", async () => {
    const approvedCampaignApproval = createApproval("approved", "campaign_phase_plan");
    const dbStub = createDbStub(
      [[createApproval("approved", "campaign_phase_plan")]],
      [],
    );

    const svc = approvalService(dbStub.db as any);
    const result = await svc.approve("approval-1", "board", "ship it");

    expect(result.applied).toBe(false);
    expect(result.approval.status).toBe("approved");
    expect(result.approval.type).toBe("campaign_phase_plan");
    expect(mockCampaignService.handleApprovalApproved).toHaveBeenCalledWith(
      approvedCampaignApproval.id,
      { userId: "board" },
    );
    expect(mockAgentService.activatePendingApproval).not.toHaveBeenCalled();
  });

  it("treats repeated reject retries as no-ops after another worker resolves the approval", async () => {
    const dbStub = createDbStub(
      [[createApproval("pending")], [createApproval("rejected")]],
      [],
    );

    const svc = approvalService(dbStub.db as any);
    const result = await svc.reject("approval-1", "board", "not now");

    expect(result.applied).toBe(false);
    expect(result.approval.status).toBe("rejected");
    expect(mockAgentService.terminate).not.toHaveBeenCalled();
    expect(mockCampaignService.handleApprovalRevisionRequested).not.toHaveBeenCalled();
  });

  it("repairs campaign revision side effects on rejected retry", async () => {
    const dbStub = createDbStub(
      [[createApproval("rejected", "campaign_phase_plan")]],
      [],
    );

    const svc = approvalService(dbStub.db as any);
    const result = await svc.reject("approval-1", "board", "not now");

    expect(result.applied).toBe(false);
    expect(result.approval.status).toBe("rejected");
    expect(result.approval.type).toBe("campaign_phase_plan");
    expect(mockCampaignService.handleApprovalRevisionRequested).toHaveBeenCalledWith(
      "approval-1",
      { userId: "board" },
    );
  });

  it("repairs campaign revision side effects on request-revision retry", async () => {
    const dbStub = createDbStub(
      [[createApproval("revision_requested", "campaign_phase_plan")]],
      [],
    );

    const svc = approvalService(dbStub.db as any);
    const result = await svc.requestRevision("approval-1", "board", "more detail");

    expect(result.status).toBe("revision_requested");
    expect(result.type).toBe("campaign_phase_plan");
    expect(mockCampaignService.handleApprovalRevisionRequested).toHaveBeenCalledWith(
      "approval-1",
      { userId: "board" },
    );
    expect(dbStub.returning).not.toHaveBeenCalled();
  });

  it("does not approve revision-requested approvals without resubmission", async () => {
    const dbStub = createDbStub([[createApproval("revision_requested")]], []);

    const svc = approvalService(dbStub.db as any);

    await expect(svc.approve("approval-1", "board", "ship it")).rejects.toMatchObject({
      status: 422,
    });
    expect(dbStub.returning).not.toHaveBeenCalled();
  });

  it("does not reject revision-requested approvals without resubmission", async () => {
    const dbStub = createDbStub([[createApproval("revision_requested")]], []);

    const svc = approvalService(dbStub.db as any);

    await expect(svc.reject("approval-1", "board", "not now")).rejects.toMatchObject({
      status: 422,
    });
    expect(dbStub.returning).not.toHaveBeenCalled();
  });

  it("still performs side effects when the resolution update is newly applied", async () => {
    const approved = createApproval("approved");
    const dbStub = createDbStub([[createApproval("pending")]], [approved]);

    const svc = approvalService(dbStub.db as any);
    const result = await svc.approve("approval-1", "board", "ship it");

    expect(result.applied).toBe(true);
    expect(mockAgentService.activatePendingApproval).toHaveBeenCalledWith("agent-1", approved.payload);
    expect(mockNotifyHireApproved).toHaveBeenCalledTimes(1);
    expect(mockCampaignService.handleApprovalApproved).not.toHaveBeenCalled();
  });

  it("creates the agent from payload when approval does not reference a pending agent", async () => {
    const approved = {
      ...createApproval("approved"),
      payload: {
        name: "New Agent",
        adapterConfig: {
          env: {
            API_KEY: {
              type: "secret_ref",
              secretId: "secret-1",
              version: "latest",
            },
          },
        },
      },
    };
    const dbStub = createDbStub([[{ ...createApproval("pending"), payload: approved.payload }]], [approved]);

    const svc = approvalService(dbStub.db as any);
    const result = await svc.approve("approval-1", "board", "ship it");

    expect(result.applied).toBe(true);
    expect(mockAgentService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        adapterConfig: approved.payload.adapterConfig,
      }),
    );
  });
});

describe("approvalService.findOpenHireApprovalForAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the open hire approval the company/type/status/agentId filter yields", async () => {
    const match = {
      ...createApproval("pending"),
      id: "approval-match",
      payload: { agentId: "agent-1" },
    };
    // The company, type, open-status and payload->>'agentId' predicates run in
    // SQL, so the DB hands back only the matching row.
    const dbStub = createDbStub([[match]], []);

    const svc = approvalService(dbStub.db as any);
    const result = await svc.findOpenHireApprovalForAgent("company-1", "agent-1");

    expect(result?.id).toBe("approval-match");
    expect(dbStub.selectWhere).toHaveBeenCalledTimes(1);
  });

  it("returns null when no open approval matches the agent", async () => {
    const dbStub = createDbStub([[]], []);

    const svc = approvalService(dbStub.db as any);
    const result = await svc.findOpenHireApprovalForAgent("company-1", "agent-1");

    expect(result).toBeNull();
  });
});
