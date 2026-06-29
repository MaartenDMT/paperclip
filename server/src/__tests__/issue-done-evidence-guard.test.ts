import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { activityLog, companies, createDb, issueComments, issueWorkProducts, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue done evidence tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

function mockGitHubPullRequestFetch(body: Record<string, unknown>, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })),
  );
}

describeEmbeddedPostgres("issue done evidence guard", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-done-evidence-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 180_000);

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.delete(issueWorkProducts);
    await db.delete(issueComments);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  }, 180_000);

  async function seedIssue(overrides: Partial<typeof issues.$inferInsert> = {}) {
    const companyId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Readersbase Production",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Issue under test",
      status: "in_review",
      priority: "medium",
      ...overrides,
    });

    return { companyId, issueId };
  }

  it("rejects branch-only code evidence when an agent tries to close the issue", async () => {
    const { companyId, issueId } = await seedIssue({ title: "Ship branch only" });

    await db.insert(issueWorkProducts).values({
      id: randomUUID(),
      companyId,
      issueId,
      type: "branch",
      provider: "github",
      externalId: "codex/readersbase-runtime-fix",
      title: "codex/readersbase-runtime-fix",
      url: "https://github.com/MaartenDMT/base/tree/codex/readersbase-runtime-fix",
      status: "active",
      reviewState: "none",
      isPrimary: true,
    });

    await expect(svc.update(issueId, { status: "done" })).rejects.toMatchObject({
      status: 422,
      message:
        "Issue cannot be marked done with branch or commit work products that still need PR, merge, deployment, or review evidence",
      details: {
        incompleteCodeWorkProducts: [
          expect.objectContaining({
            type: "branch",
            externalId: "codex/readersbase-runtime-fix",
          }),
        ],
      },
    });

    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("in_review");
    expect(issue?.completedAt).toBeNull();
  });

  it("rejects likely code-shipping work with no structured review or artifact evidence", async () => {
    const { issueId } = await seedIssue({
      title: "Fix reader login 500",
      description: "Changed the backend route handler and updated tests.",
    });

    await expect(svc.update(issueId, { status: "done" })).rejects.toMatchObject({
      status: 422,
      message: "Issue cannot be marked done without PR, merge, deployment, review, or artifact evidence for code-like work",
      details: {
        completionEvidence: expect.objectContaining({
          kind: "code_review_missing",
          prExpected: true,
          blockingWorkProductIds: [],
        }),
      },
    });

    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("in_review");
    expect(issue?.completedAt).toBeNull();
  });

  it("captures a closeout PR link before done and blocks while that PR is open", async () => {
    const { issueId } = await seedIssue({ title: "Closeout with open PR" });

    await svc.capturePullRequestWorkProductsFromText(
      issueId,
      "Code is pushed for review: https://github.com/MaartenDMT/base/pull/1009",
    );
    mockGitHubPullRequestFetch({
      state: "open",
      draft: false,
      title: "MaartenDMT/base#1009",
      html_url: "https://github.com/MaartenDMT/base/pull/1009",
    });

    await expect(svc.update(issueId, { status: "done" })).rejects.toMatchObject({
      status: 422,
      message: "Issue cannot be marked done while linked pull requests are still open",
    });

    const products = await db.select().from(issueWorkProducts).where(eq(issueWorkProducts.issueId, issueId));
    expect(products).toEqual([
      expect.objectContaining({
        type: "pull_request",
        provider: "github",
        externalId: "MaartenDMT/base#1009",
        status: "ready_for_review",
      }),
    ]);
  });

  it("allows done when branch evidence is paired with merged PR evidence", async () => {
    const { companyId, issueId } = await seedIssue({ title: "Ship branch with merged PR" });

    await db.insert(issueWorkProducts).values([
      {
        id: randomUUID(),
        companyId,
        issueId,
        type: "branch",
        provider: "github",
        externalId: "codex/readersbase-runtime-fix",
        title: "codex/readersbase-runtime-fix",
        url: "https://github.com/MaartenDMT/base/tree/codex/readersbase-runtime-fix",
        status: "active",
        reviewState: "none",
        isPrimary: false,
      },
      {
        id: randomUUID(),
        companyId,
        issueId,
        type: "pull_request",
        provider: "github",
        externalId: "MaartenDMT/base#1007",
        title: "Merged Readersbase runtime fix",
        url: "https://github.com/MaartenDMT/base/pull/1007",
        status: "merged",
        reviewState: "approved",
        isPrimary: true,
      },
    ]);
    mockGitHubPullRequestFetch({
      state: "closed",
      draft: false,
      merged_at: "2026-04-01T00:00:00Z",
      closed_at: "2026-04-01T00:00:00Z",
      title: "Merged Readersbase runtime fix",
      html_url: "https://github.com/MaartenDMT/base/pull/1007",
    });

    const updated = await svc.update(issueId, { status: "done" });

    expect(updated?.status).toBe("done");
    expect(updated?.completedAt).toBeInstanceOf(Date);
  });

  it("keeps operational repair issues closable without PR evidence", async () => {
    const { issueId } = await seedIssue({
      title: "Restore Readersbase production worktree",
      description: "Recovered the checkout and verified pnpm dev starts again.",
    });

    const updated = await svc.update(issueId, { status: "done" });

    expect(updated?.status).toBe("done");
    expect(updated?.completedAt).toBeInstanceOf(Date);
  });

  it("backfills PR work products from historical comments and preserves merged evidence", async () => {
    const { companyId, issueId } = await seedIssue({
      title: "Historical PR comments",
      status: "done",
    });

    await db.insert(issueComments).values([
      {
        id: randomUUID(),
        companyId,
        issueId,
        body: "PR opened before structured capture existed: https://github.com/MaartenDMT/base/pull/1010",
        createdAt: new Date("2026-04-01T10:00:00.000Z"),
      },
      {
        id: randomUUID(),
        companyId,
        issueId,
        body: "PR merged later: https://github.com/MaartenDMT/base/pull/1010",
        createdAt: new Date("2026-04-01T10:05:00.000Z"),
      },
    ]);

    const result = await svc.backfillPullRequestWorkProductsFromComments(companyId, { runId: null });

    expect(result).toMatchObject({
      commentsScanned: 2,
      commentsWithPullRequests: 2,
      pullRequestWorkProductsCreated: 1,
      pullRequestWorkProductsUpdated: 1,
      issueIds: [issueId],
    });
    const products = await db.select().from(issueWorkProducts).where(eq(issueWorkProducts.issueId, issueId));
    expect(products).toEqual([
      expect.objectContaining({
        type: "pull_request",
        provider: "github",
        externalId: "MaartenDMT/base#1010",
        status: "merged",
      }),
    ]);
  });
});
