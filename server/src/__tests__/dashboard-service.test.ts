import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issueComments, issueRelations, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { dashboardService, getUtcMonthStart } from "../services/dashboard.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres dashboard service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function utcDay(offsetDays: number): Date {
  const now = new Date();
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays, 12);
  return new Date(day);
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe("getUtcMonthStart", () => {
  it("anchors the monthly spend window to UTC month boundaries", () => {
    expect(getUtcMonthStart(new Date("2026-03-31T20:30:00.000-05:00")).toISOString()).toBe(
      "2026-04-01T00:00:00.000Z",
    );
    expect(getUtcMonthStart(new Date("2026-04-01T00:30:00.000+14:00")).toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });
});

describeEmbeddedPostgres("dashboard service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-dashboard-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("aggregates the full 14-day run activity window without recent-run truncation", async () => {
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();
    const today = utcDay(0);
    const weekAgo = utcDay(-7);

    await db.insert(companies).values([
      {
        id: companyId,
        name: "Paperclip",
        issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      },
      {
        id: otherCompanyId,
        name: "Other",
        issuePrefix: `T${otherCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      },
    ]);

    await db.insert(agents).values([
      {
        id: agentId,
        companyId,
        name: "CodexCoder",
        role: "engineer",
        status: "running",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: otherAgentId,
        companyId: otherCompanyId,
        name: "OtherAgent",
        role: "engineer",
        status: "running",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    await db.insert(heartbeatRuns).values([
      ...Array.from({ length: 105 }, () => ({
        id: randomUUID(),
        companyId,
        agentId,
        invocationSource: "assignment",
        status: "succeeded",
        createdAt: today,
      })),
      {
        id: randomUUID(),
        companyId,
        agentId,
        invocationSource: "assignment",
        status: "failed",
        createdAt: weekAgo,
      },
      {
        id: randomUUID(),
        companyId,
        agentId,
        invocationSource: "assignment",
        status: "timed_out",
        createdAt: weekAgo,
      },
      {
        id: randomUUID(),
        companyId,
        agentId,
        invocationSource: "assignment",
        status: "cancelled",
        createdAt: weekAgo,
      },
      {
        id: randomUUID(),
        companyId: otherCompanyId,
        agentId: otherAgentId,
        invocationSource: "assignment",
        status: "succeeded",
        createdAt: weekAgo,
      },
    ]);

    const summary = await dashboardService(db).summary(companyId);

    expect(summary.runActivity).toHaveLength(14);
    const todayBucket = summary.runActivity.find((bucket) => bucket.date === utcDateKey(today));
    const weekAgoBucket = summary.runActivity.find((bucket) => bucket.date === utcDateKey(weekAgo));

    expect(todayBucket).toMatchObject({
      succeeded: 105,
      failed: 0,
      other: 0,
      total: 105,
    });
    expect(weekAgoBucket).toMatchObject({
      succeeded: 0,
      failed: 2,
      other: 1,
      total: 3,
    });
  });

  it("summarizes direct-report operating attention for a department head", async () => {
    const companyId = randomUUID();
    const managerId = randomUUID();
    const frontendId = randomUUID();
    const qaId = randomUUID();
    const qaSpecialistId = randomUUID();
    const outsideAgentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values([
      {
        id: managerId,
        companyId,
        name: "CTO",
        role: "cto",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: frontendId,
        companyId,
        name: "Frontend",
        role: "engineer",
        status: "running",
        reportsTo: managerId,
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: qaId,
        companyId,
        name: "QA",
        role: "qa",
        status: "idle",
        reportsTo: managerId,
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: outsideAgentId,
        companyId,
        name: "CMO",
        role: "cmo",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: qaSpecialistId,
        companyId,
        name: "QA Specialist",
        role: "qa",
        status: "idle",
        reportsTo: qaId,
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    const frontendBlockedIssueId = randomUUID();
    const qaReviewIssueId = randomUUID();
    const qaNestedTodoIssueId = randomUUID();
    const outsideIssueId = randomUUID();
    await db.insert(issues).values([
      {
        id: frontendBlockedIssueId,
        companyId,
        title: "Fix cover images",
        status: "blocked",
        priority: "critical",
        assigneeAgentId: frontendId,
        identifier: "TST-1",
        issueNumber: 1,
      },
      {
        id: qaReviewIssueId,
        companyId,
        title: "QA cover evidence",
        status: "in_review",
        priority: "high",
        assigneeAgentId: qaId,
        identifier: "TST-2",
        issueNumber: 2,
      },
      {
        id: outsideIssueId,
        companyId,
        title: "Marketing calendar",
        status: "blocked",
        priority: "high",
        assigneeAgentId: outsideAgentId,
        identifier: "TST-3",
        issueNumber: 3,
      },
      {
        id: qaNestedTodoIssueId,
        companyId,
        title: "Nested QA follow-up",
        status: "todo",
        priority: "medium",
        assigneeAgentId: qaSpecialistId,
        identifier: "TST-4",
        issueNumber: 4,
      },
    ]);

    await db.insert(issueComments).values({
      companyId,
      issueId: frontendBlockedIssueId,
      authorAgentId: frontendId,
      body: "Blocked until storage owner fixes the bucket, no first-class blocker linked.",
    });
    await db.insert(heartbeatRuns).values({
      id: randomUUID(),
      companyId,
      agentId: qaSpecialistId,
      invocationSource: "assignment",
      status: "running",
    });

    const overview = await dashboardService(db).managerOverview(companyId, managerId);

    expect(overview.manager.id).toBe(managerId);
    expect(overview.reports).toHaveLength(2);
    expect(overview.rollup).toMatchObject({
      directReports: 2,
      openIssues: 3,
      blockedIssues: 1,
      inReviewIssues: 1,
      activeRuns: 1,
      blockerTextWithoutEdges: 1,
    });
    const qaReport = overview.reports.find((report) => report.agent.id === qaId);
    expect(qaReport?.counts.openIssues).toBe(2);
    expect(qaReport?.counts.activeRuns).toBe(1);
    expect(overview.reports.find((report) => report.agent.id === frontendId)?.attention).toContain(
      "blocked_without_first_class_blocker",
    );
    expect(overview.reports.some((report) => report.agent.id === outsideAgentId)).toBe(false);
  });
});
