import { afterEach, describe, expect, it, vi } from "vitest";
import { syncGitHubPullRequestWorkProducts } from "../services/github-pull-request-sync.ts";

function workProductRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-01T00:00:00.000Z");
  return {
    id: "work-product-1",
    companyId: "company-1",
    projectId: "project-1",
    issueId: "issue-1",
    executionWorkspaceId: null,
    runtimeServiceId: null,
    type: "pull_request",
    provider: "github",
    externalId: "MaartenDMT/base#712",
    title: "Old title",
    url: "https://github.com/MaartenDMT/base/pull/712",
    status: "ready_for_review",
    reviewState: "none",
    isPrimary: true,
    healthStatus: "unknown",
    summary: null,
    metadata: null,
    createdByRunId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockDb(rows: Array<ReturnType<typeof workProductRow>>) {
  const limit = vi.fn(async () => rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    db: { select, update },
    calls: { select, from, where, limit, update, updateSet, updateWhere },
  };
}

function mockGitHubPullRequest(body: Record<string, unknown>, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })));
}

describe("syncGitHubPullRequestWorkProducts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates stale Paperclip PR status from live GitHub state", async () => {
    mockGitHubPullRequest({
      state: "closed",
      draft: false,
      merged_at: "2026-06-06T15:33:08Z",
      closed_at: "2026-06-06T15:33:08Z",
      title: "fix(backend): enforce public publish metadata guardrails",
      html_url: "https://github.com/MaartenDMT/base/pull/712",
      head: { ref: "fix/rea-4353-publish-metadata-validation" },
      base: { ref: "develop" },
    });
    const { db, calls } = createMockDb([workProductRow()]);

    const result = await syncGitHubPullRequestWorkProducts(db as any, {
      companyId: "company-1",
      force: true,
      now: new Date("2026-06-26T08:00:00.000Z"),
    });

    expect(result).toMatchObject({
      scanned: 1,
      checked: 1,
      updated: 1,
      failed: 0,
      workProductIds: ["work-product-1"],
    });
    expect(calls.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "merged",
      title: "fix(backend): enforce public publish metadata guardrails",
      externalId: "MaartenDMT/base#712",
      metadata: expect.objectContaining({
        githubStatusSync: expect.objectContaining({
          syncedAt: "2026-06-26T08:00:00.000Z",
          mergedAt: "2026-06-06T15:33:08Z",
          baseRefName: "develop",
        }),
      }),
    }));
  });

  it("skips recently synced rows unless forced", async () => {
    mockGitHubPullRequest({ state: "closed", merged_at: "2026-06-06T15:33:08Z" });
    const { db, calls } = createMockDb([
      workProductRow({
        metadata: {
          githubStatusSync: {
            syncedAt: "2026-06-26T07:00:00.000Z",
          },
        },
      }),
    ]);

    const result = await syncGitHubPullRequestWorkProducts(db as any, {
      companyId: "company-1",
      now: new Date("2026-06-26T08:00:00.000Z"),
    });

    expect(result).toMatchObject({ scanned: 1, checked: 0, skippedFresh: 1, updated: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(calls.update).not.toHaveBeenCalled();
  });

  it("records GitHub fetch failures without throwing", async () => {
    mockGitHubPullRequest({ message: "rate limited" }, 403);
    const { db, calls } = createMockDb([workProductRow()]);

    const result = await syncGitHubPullRequestWorkProducts(db as any, {
      companyId: "company-1",
      force: true,
    });

    expect(result).toMatchObject({
      scanned: 1,
      checked: 1,
      updated: 0,
      failed: 1,
      failures: [
        expect.objectContaining({
          workProductId: "work-product-1",
          reason: "GitHub PR status fetch failed with HTTP 403",
        }),
      ],
    });
    expect(calls.update).not.toHaveBeenCalled();
  });
});

