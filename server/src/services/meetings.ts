import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  heartbeatRuns,
  meetingIssueLinks,
  meetingParticipants,
  meetings,
  issues,
} from "@paperclipai/db";
import type {
  AgentMeetingExpectedOutput,
  AgentMeetingResult,
  IssueThreadInteractionStatus,
  MeetingWorkflowRecommendation,
  WorkMeetingSummary,
} from "@paperclipai/shared";
import { agentMeetingResultSchema } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { logActivity } from "./activity-log.js";
import {
  countUnlinkedMeetingOutcomes,
  readIssueIdsFromMeetingResult,
  setMeetingOutcomeIssueId,
  type MeetingOutcomeLinkType,
  validateBusinessMeetingResult,
} from "./meeting-outcome-utils.js";

type MeetingActor = {
  agentId?: string | null;
  userId?: string | null;
};

export type MeetingWakeTarget = {
  id: string;
  issueId: string | null;
  participantAgentIds: string[];
  chairAgentId: string | null;
};

const PENDING_MEETING_REWAKE_MS = 15 * 60 * 1000;

function escapeLike(value: string) {
  return value.replace(/[%_\\]/g, (char) => `\\${char}`);
}

function toTimeMillis(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function rowStatus(status: string): IssueThreadInteractionStatus {
  return status as IssueThreadInteractionStatus;
}

export function meetingService(db: Db) {
  async function getMeetingById(meetingId: string) {
    return db.select().from(meetings).where(eq(meetings.id, meetingId)).then((rows) => rows[0] ?? null);
  }

  async function isParticipant(meetingId: string, agentId: string) {
    const row = await db
      .select({ id: meetingParticipants.id })
      .from(meetingParticipants)
      .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.agentId, agentId)))
      .then((rows) => rows[0] ?? null);
    return Boolean(row);
  }

  async function listRunnableParticipantIds(companyId: string, participantAgentIds: string[]) {
    const uniqueIds = [...new Set(participantAgentIds)];
    if (uniqueIds.length === 0) return [];
    const rows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(
        eq(agents.companyId, companyId),
        inArray(agents.id, uniqueIds),
        sql`${agents.status} <> 'terminated'`,
      ));
    const runnableIds = new Set(rows.map((row) => row.id));
    return uniqueIds.filter((agentId) => runnableIds.has(agentId));
  }

  async function validateCompanyIssueIds(txDb: Db, companyId: string, issueIds: string[]) {
    const uniqueIssueIds = [...new Set(issueIds.filter(Boolean))];
    if (uniqueIssueIds.length === 0) return [];
    const rows = await txDb
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), inArray(issues.id, uniqueIssueIds)));
    const validIssueIds = new Set(rows.map((row) => row.id));
    const invalidIssueIds = uniqueIssueIds.filter((issueId) => !validIssueIds.has(issueId));
    if (invalidIssueIds.length > 0) {
      throw unprocessable("Meeting result references issues outside this company or missing issues", {
        issueIds: invalidIssueIds,
      });
    }
    return uniqueIssueIds;
  }

  async function linkIssues(txDb: Db, input: {
    companyId: string;
    meetingId: string;
    issueIds: string[];
    linkKind: string;
  }) {
    const uniqueIssueIds = await validateCompanyIssueIds(txDb, input.companyId, input.issueIds);
    if (uniqueIssueIds.length === 0) return;
    await txDb
      .insert(meetingIssueLinks)
      .values(uniqueIssueIds.map((issueId) => ({
        companyId: input.companyId,
        meetingId: input.meetingId,
        issueId,
        linkKind: input.linkKind,
      })))
      .onConflictDoNothing();
  }

  async function createFromRecommendation(
    companyId: string,
    recommendation: MeetingWorkflowRecommendation,
    input: {
      title: string;
      agenda: string[];
      expectedOutputs: AgentMeetingExpectedOutput[];
      contextMarkdown: string;
    },
  ): Promise<MeetingWakeTarget | null> {
    if (recommendation.participantAgentIds.length === 0) return null;
    const existing = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(and(
        eq(meetings.companyId, companyId),
        eq(meetings.idempotencyKey, `meeting-workflow:${recommendation.id}`),
      ))
      .then((rows) => rows[0] ?? null);
    if (existing) return null;

    const now = new Date();
    const [created] = await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      const [meeting] = await txDb
        .insert(meetings)
        .values({
          companyId,
          sourceIssueId: recommendation.issueId ?? null,
          meetingType: recommendation.trigger === "no_recent_meetings" ? "standup" : "operating_review",
          title: input.title,
          purpose: recommendation.reason,
          status: "pending",
          chairAgentId: recommendation.suggestedHeadAgentId,
          idempotencyKey: `meeting-workflow:${recommendation.id}`,
          agenda: input.agenda,
          expectedOutputs: input.expectedOutputs,
          contextMarkdown: input.contextMarkdown,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await txDb.insert(meetingParticipants).values(recommendation.participantAgentIds.map((agentId) => ({
        companyId,
        meetingId: meeting.id,
        agentId,
        role: agentId === recommendation.suggestedHeadAgentId ? "chair" : "participant",
      }))).onConflictDoNothing();
      if (recommendation.issueId) {
        await txDb.insert(meetingIssueLinks).values({
          companyId,
          meetingId: meeting.id,
          issueId: recommendation.issueId,
          linkKind: "source",
        }).onConflictDoNothing();
      }
      return [meeting];
    });

    if (recommendation.issueId) {
      await db.update(issues).set({ updatedAt: now }).where(eq(issues.id, recommendation.issueId));
    }
    await logActivity(db, {
      companyId,
      actorType: "system",
      actorId: "meeting_workflow",
      action: "meeting.created",
      entityType: "meeting",
      entityId: created.id,
      details: {
        sourceIssueId: recommendation.issueId ?? null,
        trigger: recommendation.trigger,
        participantAgentIds: recommendation.participantAgentIds,
        chairAgentId: recommendation.suggestedHeadAgentId,
      },
    });
    return {
      id: created.id,
      issueId: recommendation.issueId ?? null,
      participantAgentIds: recommendation.participantAgentIds,
      chairAgentId: recommendation.suggestedHeadAgentId,
    };
  }

  async function listForCompany(companyId: string, options: {
    limit?: number;
    status?: string | null;
    agentId?: string | null;
    expectedOutput?: string | null;
    q?: string | null;
  } = {}): Promise<WorkMeetingSummary[]> {
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), 200);
    const filters = [eq(meetings.companyId, companyId)];
    if (options.status) filters.push(eq(meetings.status, options.status));
    if (options.expectedOutput) {
      filters.push(sql`${meetings.expectedOutputs} ? ${options.expectedOutput}`);
    }
    if (options.q) {
      const q = `%${escapeLike(options.q)}%`;
      filters.push(sql`(
        ${meetings.title} ilike ${q} escape '\\'
        or ${meetings.purpose} ilike ${q} escape '\\'
        or ${meetings.contextMarkdown} ilike ${q} escape '\\'
      )`);
    }
    if (options.agentId) {
      filters.push(sql`exists (
        select 1 from ${meetingParticipants} mp
        where mp.meeting_id = ${meetings.id} and mp.agent_id = ${options.agentId}
      )`);
    }

    const rows = await db
      .select()
      .from(meetings)
      .where(and(...filters))
      .orderBy(desc(meetings.createdAt), desc(meetings.id))
      .limit(limit);

    const meetingIds = rows.map((row) => row.id);
    const participantRows = meetingIds.length > 0
      ? await db
          .select({
            meetingId: meetingParticipants.meetingId,
            id: agents.id,
            name: agents.name,
            role: agents.role,
            title: agents.title,
            status: agents.status,
          })
          .from(meetingParticipants)
          .innerJoin(agents, eq(agents.id, meetingParticipants.agentId))
          .where(and(eq(meetingParticipants.companyId, companyId), inArray(meetingParticipants.meetingId, meetingIds)))
      : [];
    const participantsByMeetingId = new Map<string, WorkMeetingSummary["participants"]>();
    for (const row of participantRows) {
      const list = participantsByMeetingId.get(row.meetingId) ?? [];
      list.push({ id: row.id, name: row.name, role: row.role, title: row.title, status: row.status });
      participantsByMeetingId.set(row.meetingId, list);
    }

    const issueLinkRows = meetingIds.length > 0
      ? await db
          .select({
            meetingId: meetingIssueLinks.meetingId,
            linkKind: meetingIssueLinks.linkKind,
            issueId: issues.id,
            identifier: issues.identifier,
            title: issues.title,
            status: issues.status,
          })
          .from(meetingIssueLinks)
          .innerJoin(issues, eq(issues.id, meetingIssueLinks.issueId))
          .where(and(
            eq(meetingIssueLinks.companyId, companyId),
            eq(issues.companyId, companyId),
            inArray(meetingIssueLinks.meetingId, meetingIds),
          ))
          .orderBy(asc(meetingIssueLinks.createdAt), asc(meetingIssueLinks.id))
      : [];
    const linkedIssuesByMeetingId = new Map<string, NonNullable<WorkMeetingSummary["linkedIssues"]>>();
    for (const row of issueLinkRows) {
      const list = linkedIssuesByMeetingId.get(row.meetingId) ?? [];
      list.push({
        issueId: row.issueId,
        identifier: row.identifier,
        title: row.title,
        status: row.status as WorkMeetingSummary["issueStatus"] & string,
        linkKind: row.linkKind,
      });
      linkedIssuesByMeetingId.set(row.meetingId, list);
    }

    const now = Date.now();
    return rows.map((row) => {
      const result = row.result ? agentMeetingResultSchema.parse(row.result) : null;
      const unlinked = countUnlinkedMeetingOutcomes(result);
      const linkedIssues = linkedIssuesByMeetingId.get(row.id) ?? [];
      const primaryIssue =
        linkedIssues.find((issue) => issue.issueId === row.sourceIssueId) ??
        linkedIssues.find((issue) => issue.linkKind === "source") ??
        linkedIssues[0] ??
        null;
      return {
        id: row.id,
        companyId: row.companyId,
        threadKind: "meeting",
        issueId: primaryIssue?.issueId ?? row.sourceIssueId ?? null,
        issueIdentifier: primaryIssue?.identifier ?? null,
        issueTitle: primaryIssue?.title ?? null,
        issueStatus: primaryIssue?.status ?? null,
        linkedIssues,
        sourceIssueId: row.sourceIssueId,
        meetingType: row.meetingType,
        chairAgentId: row.chairAgentId,
        title: row.title,
        status: rowStatus(row.status),
        purpose: row.purpose,
        agenda: row.agenda ?? [],
        participantAgentIds: (participantsByMeetingId.get(row.id) ?? []).map((agent) => agent.id),
        participants: participantsByMeetingId.get(row.id) ?? [],
        expectedOutputs: row.expectedOutputs ?? [],
        result,
        resultSummaryMarkdown: result?.summaryMarkdown ?? null,
        pendingAgeHours: row.status === "pending"
          ? Math.max(0, (now - toTimeMillis(row.createdAt)) / (1000 * 60 * 60))
          : null,
        ...unlinked,
        createdAt: row.createdAt,
        resolvedAt: row.resolvedAt ?? null,
      };
    });
  }

  async function respond(meetingId: string, input: { meetingResult?: AgentMeetingResult }, actor: MeetingActor) {
    const meeting = await getMeetingById(meetingId);
    if (!meeting) throw notFound("Meeting not found");
    if (meeting.status !== "pending") throw conflict("Meeting has already been resolved");
    if (!input.meetingResult) throw unprocessable("meetingResult is required");
    const result = agentMeetingResultSchema.parse(input.meetingResult);
    const participantRows = await db
      .select({ agentId: meetingParticipants.agentId })
      .from(meetingParticipants)
      .where(and(eq(meetingParticipants.companyId, meeting.companyId), eq(meetingParticipants.meetingId, meetingId)));
    validateBusinessMeetingResult({
      result,
      expectedOutputs: meeting.expectedOutputs ?? [],
      participantAgentIds: participantRows.map((row) => row.agentId),
    });
    const now = new Date();
    const linkedOutcomeIssueIds = readIssueIdsFromMeetingResult(result);
    const updated = await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      await validateCompanyIssueIds(txDb, meeting.companyId, linkedOutcomeIssueIds);
      const [row] = await txDb
        .update(meetings)
        .set({
          status: "answered",
          result,
          resolvedByAgentId: actor.agentId ?? null,
          resolvedByUserId: actor.userId ?? null,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(and(eq(meetings.id, meetingId), eq(meetings.status, "pending")))
        .returning();
      if (!row) return null;
      await txDb
        .update(meetingParticipants)
        .set({ status: "answered", updatedAt: now })
        .where(eq(meetingParticipants.meetingId, meetingId));
      await linkIssues(txDb, {
        companyId: meeting.companyId,
        meetingId,
        issueIds: linkedOutcomeIssueIds,
        linkKind: "outcome",
      });
      return row;
    });
    if (!updated) throw conflict("Meeting has already been resolved");
    await logActivity(db, {
      companyId: meeting.companyId,
      actorType: actor.agentId ? "agent" : "user",
      actorId: actor.agentId ?? actor.userId ?? "system",
      agentId: actor.agentId ?? null,
      action: "meeting.answered",
      entityType: "meeting",
      entityId: meetingId,
      details: {
        sourceIssueId: meeting.sourceIssueId,
        linkedOutcomeIssueIds,
      },
    });
    return updated;
  }

  async function linkOutcomeIssue(
    meetingId: string,
    input: { outcomeType: MeetingOutcomeLinkType; index: number; issueId: string },
    actor: MeetingActor,
  ) {
    const meeting = await getMeetingById(meetingId);
    if (!meeting) throw notFound("Meeting not found");
    if (!meeting.result) throw unprocessable("Meeting has no result to operationalize");
    const result = agentMeetingResultSchema.parse(meeting.result);
    const nextResult = setMeetingOutcomeIssueId(result, input.outcomeType, input.index, input.issueId);
    const updated = await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      await validateCompanyIssueIds(txDb, meeting.companyId, [input.issueId]);
      const [row] = await txDb
        .update(meetings)
        .set({ result: nextResult, updatedAt: new Date() })
        .where(eq(meetings.id, meetingId))
        .returning();
      await linkIssues(txDb, {
        companyId: meeting.companyId,
        meetingId,
        issueIds: [input.issueId],
        linkKind: "outcome",
      });
      return row ?? null;
    });
    if (!updated) throw notFound("Meeting not found");
    await logActivity(db, {
      companyId: meeting.companyId,
      actorType: actor.agentId ? "agent" : "user",
      actorId: actor.agentId ?? actor.userId ?? "system",
      agentId: actor.agentId ?? null,
      action: "meeting.outcome_linked",
      entityType: "meeting",
      entityId: meetingId,
      details: {
        outcomeType: input.outcomeType,
        index: input.index,
        issueId: input.issueId,
      },
    });
    return updated;
  }

  async function resolveTerminalWorkflowMeetings(companyId: string) {
    const rows = await db
      .select({
        meeting: meetings,
        issueStatus: issues.status,
      })
      .from(meetings)
      .innerJoin(issues, eq(issues.id, meetings.sourceIssueId))
      .where(and(
        eq(meetings.companyId, companyId),
        eq(meetings.status, "pending"),
        sql`${meetings.idempotencyKey} like 'meeting-workflow:%'`,
        sql`${issues.status} in ('done', 'cancelled')`,
      ))
      .limit(200);

    let resolved = 0;
    for (const row of rows) {
      const now = new Date();
      const result = agentMeetingResultSchema.parse({
        version: 1,
        summaryMarkdown: `Source issue is already ${row.issueStatus}; Paperclip closed this stale pending meeting automatically because no live meeting remains.`,
        decisions: [`Source issue is already ${row.issueStatus}; no live meeting remains.`],
        actionItems: [],
        blockers: [],
        openQuestions: [],
      });
      const updated = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const [meeting] = await txDb
          .update(meetings)
          .set({
            status: "answered",
            result,
            resolvedAt: now,
            updatedAt: now,
          })
          .where(and(eq(meetings.id, row.meeting.id), eq(meetings.status, "pending")))
          .returning();
        if (!meeting) return null;
        await txDb
          .update(meetingParticipants)
          .set({ status: "answered", updatedAt: now })
          .where(eq(meetingParticipants.meetingId, row.meeting.id));
        return meeting;
      });
      if (!updated) continue;
      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "meeting_workflow",
        action: "meeting.auto_resolved",
        entityType: "meeting",
        entityId: row.meeting.id,
        details: {
          sourceIssueId: row.meeting.sourceIssueId,
          sourceIssueStatus: row.issueStatus,
          reason: "source_issue_terminal",
        },
      });
      resolved += 1;
    }
    return resolved;
  }

  async function reconcilePendingWorkflowWakeups(companyId: string) {
    const cutoff = new Date(Date.now() - PENDING_MEETING_REWAKE_MS);
    const rows = await db
      .select()
      .from(meetings)
      .where(and(
        eq(meetings.companyId, companyId),
        eq(meetings.status, "pending"),
        sql`${meetings.idempotencyKey} like 'meeting-workflow:%'`,
        lte(meetings.updatedAt, cutoff),
      ))
      .orderBy(asc(meetings.updatedAt))
      .limit(50);

    const meetingIds = rows.map((row) => row.id);
    const activeRunRows = meetingIds.length > 0
      ? await db
          .select({
            meetingId: sql<string>`${heartbeatRuns.contextSnapshot}->>'meetingId'`,
          })
          .from(heartbeatRuns)
          .where(and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ["queued", "running"]),
            inArray(sql<string>`${heartbeatRuns.contextSnapshot}->>'meetingId'`, meetingIds),
          ))
      : [];
    const meetingIdsWithActiveRuns = new Set(activeRunRows.map((row) => row.meetingId));

    const participantRows = meetingIds.length > 0
      ? await db
          .select({ meetingId: meetingParticipants.meetingId, agentId: meetingParticipants.agentId })
          .from(meetingParticipants)
          .where(and(eq(meetingParticipants.companyId, companyId), inArray(meetingParticipants.meetingId, meetingIds)))
      : [];
    const participantsByMeetingId = new Map<string, string[]>();
    for (const participant of participantRows) {
      const list = participantsByMeetingId.get(participant.meetingId) ?? [];
      list.push(participant.agentId);
      participantsByMeetingId.set(participant.meetingId, list);
    }

    const wakeTargets: MeetingWakeTarget[] = [];
    let cancelledUnrunnable = 0;
    for (const meeting of rows) {
      if (meetingIdsWithActiveRuns.has(meeting.id)) continue;
      const runnableIds = await listRunnableParticipantIds(
        companyId,
        participantsByMeetingId.get(meeting.id) ?? [],
      );
      if (runnableIds.length === 0) {
        const [updated] = await db
          .update(meetings)
          .set({ status: "cancelled", resolvedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(meetings.id, meeting.id), eq(meetings.status, "pending")))
          .returning();
        if (updated) cancelledUnrunnable += 1;
        continue;
      }
      const [updated] = await db
        .update(meetings)
        .set({ updatedAt: new Date() })
        .where(and(eq(meetings.id, meeting.id), eq(meetings.status, "pending")))
        .returning();
      if (!updated) continue;
      wakeTargets.push({
        id: meeting.id,
        issueId: meeting.sourceIssueId,
        participantAgentIds: runnableIds,
        chairAgentId: meeting.chairAgentId,
      });
    }
    return { meetings: wakeTargets, cancelledUnrunnable };
  }

  return {
    getById: getMeetingById,
    isParticipant,
    createFromRecommendation,
    listForCompany,
    respond,
    linkOutcomeIssue,
    resolveTerminalWorkflowMeetings,
    reconcilePendingWorkflowWakeups,
  };
}
