import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  api: mockApi,
}));

import { heartbeatsApi } from "./heartbeats";

describe("heartbeatsApi.liveRunsForCompany", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.get.mockResolvedValue([]);
  });

  it("keeps the legacy numeric minCount signature", async () => {
    await heartbeatsApi.liveRunsForCompany("company-1", 4);

    expect(mockApi.get).toHaveBeenCalledWith("/companies/company-1/live-runs?minCount=4");
  });

  it("passes minCount and limit options to the company live-runs endpoint", async () => {
    await heartbeatsApi.liveRunsForCompany("company-1", { minCount: 50, limit: 50 });

    expect(mockApi.get).toHaveBeenCalledWith("/companies/company-1/live-runs?minCount=50&limit=50");
  });
});

describe("heartbeatsApi.listPage", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.get.mockResolvedValue({ runs: [], nextCursor: null });
  });

  it("requests cursor-paginated heartbeat runs", async () => {
    await heartbeatsApi.listPage("company-1", {
      agentId: "agent-1",
      limit: 25,
      cursor: { createdAt: "2026-05-17T10:11:12.000Z", id: "run-1" },
    });

    expect(mockApi.get).toHaveBeenCalledWith(
      "/companies/company-1/heartbeat-runs?page=cursor&agentId=agent-1&limit=25&cursorCreatedAt=2026-05-17T10%3A11%3A12.000Z&cursorId=run-1",
    );
  });
});

describe("heartbeatsApi.logMetadata", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.get.mockResolvedValue({ runId: "run-1", store: "local_file", logRef: "run-1.ndjson", bytes: 123 });
  });

  it("requests log metadata without reading content", async () => {
    await heartbeatsApi.logMetadata("run-1");

    expect(mockApi.get).toHaveBeenCalledWith("/heartbeat-runs/run-1/log?metadataOnly=true");
  });
});
