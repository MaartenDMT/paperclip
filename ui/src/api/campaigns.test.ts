import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock("./client", () => ({
  api: mockApi,
}));

import { campaignsApi } from "./campaigns";

describe("campaignsApi", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.patch.mockReset();
    mockApi.post.mockReset();
    mockApi.put.mockReset();
    mockApi.get.mockResolvedValue({});
    mockApi.patch.mockResolvedValue({});
    mockApi.post.mockResolvedValue({});
    mockApi.put.mockResolvedValue({});
  });

  it("uses company-scoped routes for campaign list and creation", async () => {
    await campaignsApi.list("company-1");
    await campaignsApi.create("company-1", { title: "Launch", projectIds: ["project-1"] });

    expect(mockApi.get).toHaveBeenCalledWith("/companies/company-1/campaigns");
    expect(mockApi.post).toHaveBeenCalledWith(
      "/companies/company-1/campaigns",
      { title: "Launch", projectIds: ["project-1"] },
    );
  });

  it("uses campaign routes for detail updates and project replacement", async () => {
    await campaignsApi.get("campaign-1");
    await campaignsApi.update("campaign-1", { status: "active" });
    await campaignsApi.replaceProjects("campaign-1", { projectIds: ["project-1", "project-2"] });

    expect(mockApi.get).toHaveBeenCalledWith("/campaigns/campaign-1");
    expect(mockApi.patch).toHaveBeenCalledWith("/campaigns/campaign-1", { status: "active" });
    expect(mockApi.put).toHaveBeenCalledWith(
      "/campaigns/campaign-1/projects",
      { projectIds: ["project-1", "project-2"] },
    );
  });

  it("uses phase routes for phase and plan operations", async () => {
    await campaignsApi.listPhases("campaign-1");
    await campaignsApi.createPhase("campaign-1", { title: "Plan" });
    await campaignsApi.updatePhase("phase-1", { title: "Build" });
    await campaignsApi.linkExecutionIssue("phase-1", { issueId: "issue-1" });
    await campaignsApi.upsertPlan("phase-1", { body: "## Plan" });
    await campaignsApi.submitPlan("phase-1", { decisionNote: "Ready" });

    expect(mockApi.get).toHaveBeenCalledWith("/campaigns/campaign-1/phases");
    expect(mockApi.post).toHaveBeenCalledWith("/campaigns/campaign-1/phases", { title: "Plan" });
    expect(mockApi.patch).toHaveBeenCalledWith("/campaign-phases/phase-1", { title: "Build" });
    expect(mockApi.put).toHaveBeenCalledWith("/campaign-phases/phase-1/execution-issue", { issueId: "issue-1" });
    expect(mockApi.put).toHaveBeenCalledWith("/campaign-phases/phase-1/plan", { body: "## Plan" });
    expect(mockApi.post).toHaveBeenCalledWith(
      "/campaign-phases/phase-1/submit-plan",
      { decisionNote: "Ready" },
    );
  });
});
