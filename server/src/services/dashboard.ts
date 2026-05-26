import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, approvals, companies, costEvents, heartbeatRuns, issueComments, issueRelations, issueThreadInteractions, issues } from "@paperclipai/db";
import { notFound } from "../errors.js";
import { budgetService } from "./budgets.js";
import type { ManagerOverviewAttention, ManagerOverviewIssueWorkloadKind } from "@paperclipai/shared";

const DASHBOARD_RUN_ACTIVITY_DAYS = 14;
const COORDINATION_ISSUE_ORIGIN_KINDS = new Set([
  "routine_execution",
  "harness_liveness_escalation",
  "stale_active_run_evaluation",
  "issue_productivity_review",
  "stranded_issue_recovery",
]);

type WorkloadIssue = {
  assigneeAgentId: string | null;
  originKind: string;
};

export function classifyManagerIssueWorkload(issue: Pick<WorkloadIssue, "originKind">): ManagerOverviewIssueWorkloadKind {
  return COORDINATION_ISSUE_ORIGIN_KINDS.has(issue.originKind) ? "coordination" : "execution";
}

export function summarizeManagerIssueWorkload(input: {
  issues: WorkloadIssue[];
  reportAgentId: string;
  descendantAgentIds: string[];
  managerAgentIds: Set<string>;
}) {
  const descendantAgentIdSet = new Set(input.descendantAgentIds);
  let executableIssues = 0;
  let coordinationIssues = 0;
  let managerHeldExecutableIssues = 0;
  let delegatedExecutableIssues = 0;

  for (const issue of input.issues) {
    if (!issue.assigneeAgentId || !descendantAgentIdSet.has(issue.assigneeAgentId)) continue;
    const workloadKind = classifyManagerIssueWorkload(issue);
    if (workloadKind === "coordination") {
      coordinationIssues += 1;
      continue;
    }

    executableIssues += 1;
    if (issue.assigneeAgentId === input.reportAgentId && input.managerAgentIds.has(input.reportAgentId)) {
      managerHeldExecutableIssues += 1;
    } else {
      delegatedExecutableIssues += 1;
    }
  }

  return {
    executableIssues,
    coordinationIssues,
    managerHeldExecutableIssues,
    delegatedExecutableIssues,
  };
}

function formatUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getUtcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function getRecentUtcDateKeys(now: Date, days: number): string[] {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) => {
    const dayOffset = index - (days - 1);
    return formatUtcDateKey(new Date(todayUtc + dayOffset * 24 * 60 * 60 * 1000));
  });
}

export function dashboardService(db: Db) {
  const budgets = budgetService(db);
  return {
    summary: async (companyId: string) => {
      const company = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null);

      if (!company) throw notFound("Company not found");

      const agentRows = await db
        .select({ status: agents.status, count: sql<number>`count(*)` })
        .from(agents)
        .where(eq(agents.companyId, companyId))
        .groupBy(agents.status);

      const taskRows = await db
        .select({ status: issues.status, count: sql<number>`count(*)` })
        .from(issues)
        .where(eq(issues.companyId, companyId))
        .groupBy(issues.status);

      const pendingApprovals = await db
        .select({ count: sql<number>`count(*)` })
        .from(approvals)
        .where(and(eq(approvals.companyId, companyId), eq(approvals.status, "pending")))
        .then((rows) => Number(rows[0]?.count ?? 0));

      const agentCounts: Record<string, number> = {
        active: 0,
        running: 0,
        paused: 0,
        error: 0,
      };
      for (const row of agentRows) {
        const count = Number(row.count);
        // "idle" agents are operational — count them as active
        const bucket = row.status === "idle" ? "active" : row.status;
        agentCounts[bucket] = (agentCounts[bucket] ?? 0) + count;
      }

      const taskCounts: Record<string, number> = {
        open: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
      };
      for (const row of taskRows) {
        const count = Number(row.count);
        if (row.status === "in_progress") taskCounts.inProgress += count;
        if (row.status === "blocked") taskCounts.blocked += count;
        if (row.status === "done") taskCounts.done += count;
        if (row.status !== "done" && row.status !== "cancelled") taskCounts.open += count;
      }

      const now = new Date();
      const monthStart = getUtcMonthStart(now);
      const runActivityDays = getRecentUtcDateKeys(now, DASHBOARD_RUN_ACTIVITY_DAYS);
      const runActivityStart = new Date(`${runActivityDays[0]}T00:00:00.000Z`);
      const [{ monthSpend }] = await db
        .select({
          monthSpend: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
        })
        .from(costEvents)
        .where(
          and(
            eq(costEvents.companyId, companyId),
            gte(costEvents.occurredAt, monthStart),
          ),
        );

      const monthSpendCents = Number(monthSpend);
      const runActivityDayExpr = sql<string>`to_char(${heartbeatRuns.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
      const runActivityRows = await db
        .select({
          date: runActivityDayExpr,
          status: heartbeatRuns.status,
          count: sql<number>`count(*)::double precision`,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            gte(heartbeatRuns.createdAt, runActivityStart),
          ),
        )
        .groupBy(runActivityDayExpr, heartbeatRuns.status);

      const runActivity = new Map(
        runActivityDays.map((date) => [
          date,
          { date, succeeded: 0, failed: 0, other: 0, total: 0 },
        ]),
      );
      for (const row of runActivityRows) {
        const bucket = runActivity.get(row.date);
        if (!bucket) continue;
        const count = Number(row.count);
        if (row.status === "succeeded") bucket.succeeded += count;
        else if (row.status === "failed" || row.status === "timed_out") bucket.failed += count;
        else bucket.other += count;
        bucket.total += count;
      }

      const utilization =
        company.budgetMonthlyCents > 0
          ? (monthSpendCents / company.budgetMonthlyCents) * 100
          : 0;
      const budgetOverview = await budgets.overview(companyId);

      return {
        companyId,
        agents: {
          active: agentCounts.active,
          running: agentCounts.running,
          paused: agentCounts.paused,
          error: agentCounts.error,
        },
        tasks: taskCounts,
        costs: {
          monthSpendCents,
          monthBudgetCents: company.budgetMonthlyCents,
          monthUtilizationPercent: Number(utilization.toFixed(2)),
        },
        pendingApprovals,
        budgets: {
          activeIncidents: budgetOverview.activeIncidents.length,
          pendingApprovals: budgetOverview.pendingApprovalCount,
          pausedAgents: budgetOverview.pausedAgentCount,
          pausedProjects: budgetOverview.pausedProjectCount,
        },
        runActivity: Array.from(runActivity.values()),
      };
    },

    managerOverview: async (companyId: string, managerAgentId: string) => {
      const manager = await db
        .select()
        .from(agents)
        .where(and(eq(agents.companyId, companyId), eq(agents.id, managerAgentId)))
        .then((rows) => rows[0] ?? null);
      if (!manager) throw notFound("Manager agent not found");

      const companyAgentRows = await db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.companyId, companyId),
            ne(agents.status, "terminated"),
          ),
        )
        .orderBy(agents.name);
      const reportRows = companyAgentRows.filter((row) => row.reportsTo === managerAgentId);
      const reportIds = reportRows.map((row) => row.id);
      const childrenByManagerId = new Map<string, typeof companyAgentRows>();
      for (const row of companyAgentRows) {
        if (!row.reportsTo) continue;
        const group = childrenByManagerId.get(row.reportsTo) ?? [];
        group.push(row);
        childrenByManagerId.set(row.reportsTo, group);
      }
      const descendantIdsByReportId = new Map<string, string[]>();
      const collectDescendantIds = (agentId: string, visited = new Set<string>()): string[] => {
        if (visited.has(agentId)) return [];
        visited.add(agentId);
        const children = childrenByManagerId.get(agentId) ?? [];
        return [
          agentId,
          ...children.flatMap((child) => collectDescendantIds(child.id, visited)),
        ];
      };
      for (const report of reportRows) {
        descendantIdsByReportId.set(report.id, collectDescendantIds(report.id));
      }
      const scopedAgentIds = [...new Set([...descendantIdsByReportId.values()].flat())];
      const managerAgentIds = new Set(
        companyAgentRows
          .filter((agent) => (childrenByManagerId.get(agent.id)?.length ?? 0) > 0)
          .map((agent) => agent.id),
      );

      const issueRows = scopedAgentIds.length > 0
        ? await db
            .select()
            .from(issues)
            .where(
              and(
                eq(issues.companyId, companyId),
                inArray(issues.assigneeAgentId, scopedAgentIds),
                sql`${issues.status} not in ('done', 'cancelled')`,
              ),
            )
        : [];
      const issueIds = issueRows.map((row) => row.id);

      const blockerCommentRows = issueIds.length > 0
        ? await db
            .select({
              issueId: issueComments.issueId,
              count: sql<number>`count(*)::double precision`,
            })
            .from(issueComments)
            .where(
              and(
                eq(issueComments.companyId, companyId),
                inArray(issueComments.issueId, issueIds),
                sql`${issueComments.body} ~* '\\m(blocked|blocker|stuck|cannot continue|waiting on)\\M'`,
              ),
            )
            .groupBy(issueComments.issueId)
        : [];
      const blockerCommentIssueIds = new Set(blockerCommentRows.map((row) => row.issueId));

      const blockerEdgeRows = issueIds.length > 0
        ? await db
            .select({
              issueId: issueRelations.issueId,
              count: sql<number>`count(*)::double precision`,
            })
            .from(issueRelations)
            .where(
              and(
                eq(issueRelations.companyId, companyId),
                inArray(issueRelations.issueId, issueIds),
                eq(issueRelations.type, "blocks"),
              ),
            )
            .groupBy(issueRelations.issueId)
        : [];
      const blockerEdgeIssueIds = new Set(blockerEdgeRows.map((row) => row.issueId));

      const activeRunRows = scopedAgentIds.length > 0
        ? await db
            .select({
              agentId: heartbeatRuns.agentId,
              count: sql<number>`count(*)::double precision`,
            })
            .from(heartbeatRuns)
            .where(
              and(
                eq(heartbeatRuns.companyId, companyId),
                inArray(heartbeatRuns.agentId, scopedAgentIds),
                inArray(heartbeatRuns.status, ["queued", "running"]),
              ),
            )
            .groupBy(heartbeatRuns.agentId)
        : [];
      const activeRunsByAgentId = new Map(activeRunRows.map((row) => [row.agentId, Number(row.count)]));

      const meetingRows = scopedAgentIds.length > 0
        ? await db
            .select({
              id: issueThreadInteractions.id,
              issueId: issueThreadInteractions.issueId,
              issueIdentifier: issues.identifier,
              title: issueThreadInteractions.title,
              status: issueThreadInteractions.status,
              payload: issueThreadInteractions.payload,
              createdAt: issueThreadInteractions.createdAt,
            })
            .from(issueThreadInteractions)
            .innerJoin(issues, eq(issues.id, issueThreadInteractions.issueId))
            .where(and(
              eq(issueThreadInteractions.companyId, companyId),
              eq(issueThreadInteractions.kind, "agent_meeting"),
            ))
            .orderBy(sql`${issueThreadInteractions.createdAt} desc`)
            .limit(100)
        : [];

      const issuesByAgentId = new Map<string, typeof issueRows>();
      for (const issue of issueRows) {
        if (!issue.assigneeAgentId) continue;
        const group = issuesByAgentId.get(issue.assigneeAgentId) ?? [];
        group.push(issue);
        issuesByAgentId.set(issue.assigneeAgentId, group);
      }

      let blockerTextWithoutEdges = 0;
      let stalePendingMeetings = 0;
      let executableIssues = 0;
      let coordinationIssues = 0;
      let managerHeldExecutableIssues = 0;
      let delegatedExecutableIssues = 0;
      const nowMs = Date.now();
      const reports = reportRows.map((report) => {
        const subtreeAgentIds = descendantIdsByReportId.get(report.id) ?? [report.id];
        const subtreeAgentIdSet = new Set(subtreeAgentIds);
        const assignedIssues = subtreeAgentIds.flatMap((agentId) => issuesByAgentId.get(agentId) ?? []);
        const workloadSummary = summarizeManagerIssueWorkload({
          issues: assignedIssues,
          reportAgentId: report.id,
          descendantAgentIds: subtreeAgentIds,
          managerAgentIds,
        });
        executableIssues += workloadSummary.executableIssues;
        coordinationIssues += workloadSummary.coordinationIssues;
        managerHeldExecutableIssues += workloadSummary.managerHeldExecutableIssues;
        delegatedExecutableIssues += workloadSummary.delegatedExecutableIssues;
        const reportMeetings = meetingRows
          .filter((meeting) => {
            const participantAgentIds = Array.isArray((meeting.payload as any)?.participantAgentIds)
              ? ((meeting.payload as any).participantAgentIds as unknown[])
              : [];
            return participantAgentIds.some((agentId) => typeof agentId === "string" && subtreeAgentIdSet.has(agentId));
          })
          .slice(0, 5)
          .map((meeting) => {
            const pendingAgeHours = meeting.status === "pending"
              ? Math.max(0, (nowMs - meeting.createdAt.getTime()) / (1000 * 60 * 60))
              : null;
            return {
              id: meeting.id,
              issueId: meeting.issueId,
              issueIdentifier: meeting.issueIdentifier,
              title: meeting.title,
              purpose: String((meeting.payload as any)?.purpose ?? ""),
              status: meeting.status,
              participantAgentIds: Array.isArray((meeting.payload as any)?.participantAgentIds)
                ? ((meeting.payload as any).participantAgentIds as string[])
                : [],
              pendingAgeHours,
              createdAt: meeting.createdAt,
            };
          });
        const reportStaleMeetings = reportMeetings.filter((meeting) => (meeting.pendingAgeHours ?? 0) >= 24).length;
        stalePendingMeetings += reportStaleMeetings;
        const openIssues = assignedIssues.length;
        const blockedIssues = assignedIssues.filter((issue) => issue.status === "blocked").length;
        const inProgressIssues = assignedIssues.filter((issue) => issue.status === "in_progress").length;
        const inReviewIssues = assignedIssues.filter((issue) => issue.status === "in_review").length;
        const todoIssues = assignedIssues.filter((issue) => issue.status === "todo" || issue.status === "backlog").length;
        const missingBlockerEdges = assignedIssues.filter(
          (issue) => blockerCommentIssueIds.has(issue.id) && !blockerEdgeIssueIds.has(issue.id),
        ).length;
        blockerTextWithoutEdges += missingBlockerEdges;

        const activeRuns = subtreeAgentIds.reduce(
          (sum, agentId) => sum + (activeRunsByAgentId.get(agentId) ?? 0),
          0,
        );
        const attention: ManagerOverviewAttention[] = [];
        if (report.status === "paused" || report.status === "error") {
          attention.push(`agent_${report.status}` as ManagerOverviewAttention);
        }
        if (activeRuns > 1) attention.push("multiple_active_runs");
        if (blockedIssues > 0) attention.push("blocked_work");
        if (missingBlockerEdges > 0) attention.push("blocked_without_first_class_blocker");
        if (inReviewIssues > 0) attention.push("review_waiting");
        if (reportStaleMeetings > 0) attention.push("stale_meeting");
        if (workloadSummary.managerHeldExecutableIssues > 0) attention.push("manager_implementation_load");

        return {
          agent: {
            id: report.id,
            companyId: report.companyId,
            name: report.name,
            role: report.role,
            title: report.title,
            status: report.status,
            reportsTo: report.reportsTo,
          },
          counts: {
            openIssues,
            todoIssues,
            inProgressIssues,
            inReviewIssues,
            blockedIssues,
            executableIssues: workloadSummary.executableIssues,
            coordinationIssues: workloadSummary.coordinationIssues,
            managerHeldExecutableIssues: workloadSummary.managerHeldExecutableIssues,
            delegatedExecutableIssues: workloadSummary.delegatedExecutableIssues,
            activeRuns,
            recentMeetings: reportMeetings.length,
            stalePendingMeetings: reportStaleMeetings,
            blockerTextWithoutEdges: missingBlockerEdges,
          },
          attention,
          recentIssues: assignedIssues
            .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
            .slice(0, 5)
            .map((issue) => ({
              id: issue.id,
              identifier: issue.identifier,
              title: issue.title,
              status: issue.status,
              priority: issue.priority,
              workloadKind: classifyManagerIssueWorkload(issue),
              updatedAt: issue.updatedAt,
            })),
          recentMeetings: reportMeetings,
        };
      });

      return {
        companyId,
        manager: {
          id: manager.id,
          companyId: manager.companyId,
          name: manager.name,
          role: manager.role,
          title: manager.title,
          status: manager.status,
          reportsTo: manager.reportsTo,
        },
        rollup: {
          directReports: reportRows.length,
          openIssues: issueRows.length,
          todoIssues: issueRows.filter((issue) => issue.status === "todo" || issue.status === "backlog").length,
          inProgressIssues: issueRows.filter((issue) => issue.status === "in_progress").length,
          inReviewIssues: issueRows.filter((issue) => issue.status === "in_review").length,
          blockedIssues: issueRows.filter((issue) => issue.status === "blocked").length,
          executableIssues,
          coordinationIssues,
          managerHeldExecutableIssues,
          delegatedExecutableIssues,
          activeRuns: [...activeRunsByAgentId.values()].reduce((sum, count) => sum + count, 0),
          recentMeetings: meetingRows.length,
          stalePendingMeetings,
          blockerTextWithoutEdges,
        },
        reports,
      };
    },
  };
}
