import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  approvals,
  heartbeatRuns,
  issueApprovals,
  issueThreadInteractions,
  meetingContributions,
  meetingIssueLinks,
  meetingParticipants,
  meetings,
  goals,
  issues,
} from "@paperclipai/db";
import type {
  AgentMeetingExpectedOutput,
  AgentMeetingResult,
  IssueThreadInteractionStatus,
  MeetingContributionPayload,
  MeetingContributionSummary,
  MeetingWorkflowRecommendation,
  WorkMeetingSummary,
} from "@paperclipai/shared";
import { agentMeetingResultSchema, meetingContributionPayloadSchema } from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { logActivity } from "./activity-log.js";
import {
  countUnlinkedMeetingOutcomes,
  parseStoredMeetingResult,
  readIssueIdsFromMeetingResult,
  setMeetingOutcomeIssueId,
  type MeetingOutcomeLinkType,
  validateBusinessMeetingResult,
} from "./meeting-outcome-utils.js";

type MeetingActor = {
  agentId?: string | null;
  userId?: string | null;
};

type MeetingRespondInput = {
  meetingResult?: AgentMeetingResult;
  overrideMissingContributions?: boolean;
  overrideReason?: string | null;
};

export type MeetingWakeTarget = {
  id: string;
  issueId: string | null;
  participantAgentIds: string[];
  chairAgentId: string | null;
};

type ActiveMeetingRun = {
  id: string;
  agentId: string;
  status: string;
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
        sql`${agents.status} not in ('paused', 'pending_approval', 'terminated')`,
      ));
    const runnableIds = new Set(rows.map((row) => row.id));
    return uniqueIds.filter((agentId) => runnableIds.has(agentId));
  }

  async function listIssueIdsWithPendingNextActionPath(companyId: string, issueIds: string[]) {
    const uniqueIssueIds = [...new Set(issueIds.filter(Boolean))];
    if (uniqueIssueIds.length === 0) return new Set<string>();

    const [pendingInteractionRows, pendingApprovalRows] = await Promise.all([
      db
        .select({ issueId: issueThreadInteractions.issueId })
        .from(issueThreadInteractions)
        .where(and(
          eq(issueThreadInteractions.companyId, companyId),
          inArray(issueThreadInteractions.issueId, uniqueIssueIds),
          eq(issueThreadInteractions.status, "pending"),
          sql`${issueThreadInteractions.kind} <> 'agent_meeting'`,
        )),
      db
        .select({ issueId: issueApprovals.issueId })
        .from(issueApprovals)
        .innerJoin(approvals, eq(issueApprovals.approvalId, approvals.id))
        .where(and(
          eq(issueApprovals.companyId, companyId),
          inArray(issueApprovals.issueId, uniqueIssueIds),
          inArray(approvals.status, ["pending", "revision_requested"]),
        )),
    ]);

    return new Set([
      ...pendingInteractionRows.map((row) => row.issueId),
      ...pendingApprovalRows.map((row) => row.issueId),
    ]);
  }

  async function repairSingleDepartmentWorkflowMeetingParticipants(
    companyId: string,
    meeting: typeof meetings.$inferSelect,
    participantAgentIds: string[],
    activeRuns: ActiveMeetingRun[] = [],
  ) {
    if (!meeting.idempotencyKey?.startsWith("meeting-workflow:")) {
      return { participantAgentIds, repaired: false, cancelledRunIds: [] as string[] };
    }
    if (meeting.idempotencyKey.startsWith("meeting-workflow:no_recent_meetings:")) {
      return { participantAgentIds, repaired: false, cancelledRunIds: [] as string[] };
    }
    if (!meeting.sourceIssueId) return { participantAgentIds, repaired: false, cancelledRunIds: [] as string[] };

    const agentRows = await db
      .select({ id: agents.id, role: agents.role, reportsTo: agents.reportsTo })
      .from(agents)
      .where(eq(agents.companyId, companyId));
    const agentById = new Map(agentRows.map((agent) => [agent.id, agent]));
    const topLevelHead =
      agentRows.find((agent) => agent.role === "ceo" && !agent.reportsTo) ??
      agentRows.find((agent) => !agent.reportsTo) ??
      null;
    if (!topLevelHead || !participantAgentIds.includes(topLevelHead.id)) {
      return { participantAgentIds, repaired: false, cancelledRunIds: [] as string[] };
    }
    const directHeadIds = new Set(
      agentRows
        .filter((agent) => agent.reportsTo === topLevelHead.id)
        .map((agent) => agent.id),
    );

    const relatedIssues = await db
      .select({ assigneeAgentId: issues.assigneeAgentId, priority: issues.priority })
      .from(issues)
      .where(and(
        eq(issues.companyId, companyId),
        sql`(${issues.id} = ${meeting.sourceIssueId} or ${issues.parentId} = ${meeting.sourceIssueId})`,
        sql`${issues.status} not in ('done', 'cancelled')`,
        sql`${issues.hiddenAt} is null`,
      ));
    if (relatedIssues.some((issue) => issue.priority === "critical")) {
      return { participantAgentIds, repaired: false, cancelledRunIds: [] as string[] };
    }

    const resolveHeadId = (agentId: string | null) => {
      const assignee = agentId ? agentById.get(agentId) ?? null : null;
      if (!assignee) return null;
      if (assignee.reportsTo === topLevelHead.id || directHeadIds.has(assignee.id)) return assignee.id;
      return assignee.reportsTo ?? assignee.id;
    };
    const relatedHeadIds = new Set<string>();
    for (const issue of relatedIssues) {
      const headId = resolveHeadId(issue.assigneeAgentId);
      if (headId) relatedHeadIds.add(headId);
    }

    const nonTopLevelHeadIds = [...relatedHeadIds].filter((headId) => headId !== topLevelHead.id);
    if (nonTopLevelHeadIds.length !== 1) {
      return { participantAgentIds, repaired: false, cancelledRunIds: [] as string[] };
    }
    const [departmentHeadId] = nonTopLevelHeadIds;
    const repairedParticipantIds = [
      ...new Set([
        departmentHeadId,
        ...participantAgentIds.filter((agentId) => agentId !== topLevelHead.id),
      ]),
    ];

    const insertedDepartmentHead = !participantAgentIds.includes(departmentHeadId);
    if (insertedDepartmentHead) {
      await db
        .insert(meetingParticipants)
        .values({
          companyId,
          meetingId: meeting.id,
          agentId: departmentHeadId,
          role: "participant",
          status: "pending",
        })
        .onConflictDoNothing();
    }
    await db
      .delete(meetingParticipants)
      .where(and(
        eq(meetingParticipants.meetingId, meeting.id),
        eq(meetingParticipants.agentId, topLevelHead.id),
      ));
    if (meeting.chairAgentId === topLevelHead.id || !meeting.chairAgentId) {
      await db
        .update(meetings)
        .set({ chairAgentId: departmentHeadId, updatedAt: new Date() })
        .where(eq(meetings.id, meeting.id));
    }
    const cancelledRunRows = activeRuns.filter(
      (run) => run.status === "queued" && !repairedParticipantIds.includes(run.agentId),
    );
    const cancelledRunIds = cancelledRunRows.map((run) => run.id);
    if (cancelledRunIds.length > 0) {
      await db
        .update(heartbeatRuns)
        .set({
          status: "cancelled",
          finishedAt: new Date(),
          updatedAt: new Date(),
          error: "Cancelled because meeting participants were repaired to the lowest responsible level",
          errorCode: "meeting_participant_repaired",
        })
        .where(inArray(heartbeatRuns.id, cancelledRunIds));
    }
    await logActivity(db, {
      companyId,
      actorType: "system",
      actorId: "meeting_workflow",
      action: "meeting.participants_repaired",
      entityType: "meeting",
      entityId: meeting.id,
      details: {
        reason: "lowest_responsible_level",
        removedTopLevelHeadAgentId: topLevelHead.id,
        insertedDepartmentHeadAgentId: insertedDepartmentHead ? departmentHeadId : null,
        cancelledRunIds,
        chairAgentId: meeting.chairAgentId === topLevelHead.id || !meeting.chairAgentId
          ? departmentHeadId
          : meeting.chairAgentId,
        sourceIssueId: meeting.sourceIssueId,
      },
    });
    return { participantAgentIds: repairedParticipantIds, repaired: true, cancelledRunIds };
  }

  async function pruneUnrunnablePendingWorkflowMeetingParticipants(input: {
    companyId: string;
    meeting: typeof meetings.$inferSelect;
    participantAgentIds: string[];
    runnableParticipantIds: string[];
    chairAgentId: string | null;
    activeRuns: ActiveMeetingRun[];
  }) {
    const runnableSet = new Set(input.runnableParticipantIds);
    const unrunnableParticipantIds = input.participantAgentIds.filter((agentId) => !runnableSet.has(agentId));
    const queuedRunIds = input.activeRuns
      .filter((run) => run.status === "queued" && unrunnableParticipantIds.includes(run.agentId))
      .map((run) => run.id);
    if (unrunnableParticipantIds.length === 0 && input.chairAgentId === input.meeting.chairAgentId) {
      return;
    }

    await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      if (unrunnableParticipantIds.length > 0) {
        await txDb
          .delete(meetingParticipants)
          .where(and(
            eq(meetingParticipants.meetingId, input.meeting.id),
            inArray(meetingParticipants.agentId, unrunnableParticipantIds),
          ));
      }
      if (queuedRunIds.length > 0) {
        await txDb
          .update(heartbeatRuns)
          .set({
            status: "cancelled",
            finishedAt: new Date(),
            updatedAt: new Date(),
            error: "Cancelled because meeting participant is no longer runnable",
            errorCode: "meeting_participant_unrunnable",
          })
          .where(inArray(heartbeatRuns.id, queuedRunIds));
      }
      if (input.chairAgentId !== input.meeting.chairAgentId) {
        await txDb
          .update(meetings)
          .set({ chairAgentId: input.chairAgentId, updatedAt: new Date() })
          .where(eq(meetings.id, input.meeting.id));
      }
    });

    await logActivity(db, {
      companyId: input.companyId,
      actorType: "system",
      actorId: "meeting_workflow",
      action: "meeting.participants_pruned",
      entityType: "meeting",
      entityId: input.meeting.id,
      details: {
        reason: "participant_not_runnable",
        removedAgentIds: unrunnableParticipantIds,
        cancelledRunIds: queuedRunIds,
        chairAgentId: input.chairAgentId,
      },
    });
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
    if (uniqueIssueIds.length === 0) return 0;
    const inserted = await txDb
      .insert(meetingIssueLinks)
      .values(uniqueIssueIds.map((issueId) => ({
        companyId: input.companyId,
        meetingId: input.meetingId,
        issueId,
        linkKind: input.linkKind,
      })))
      .onConflictDoNothing()
      .returning({ id: meetingIssueLinks.id });
    return inserted.length;
  }

  function contributionSummary(row: {
    id: string;
    meetingId: string;
    agentId: string;
    agentName: string | null;
    agentRole: string | null;
    summaryMarkdown: string;
    progress: string[] | null;
    blockers: string[] | null;
    risks: string[] | null;
    nextActions: string[] | null;
    proposedDecisions: string[] | null;
    betterAlternatives: string[] | null;
    createdAt: Date | string;
    updatedAt: Date | string;
  }): MeetingContributionSummary {
    return {
      id: row.id,
      meetingId: row.meetingId,
      agentId: row.agentId,
      agentName: row.agentName,
      agentRole: row.agentRole,
      summaryMarkdown: row.summaryMarkdown,
      progress: row.progress ?? [],
      blockers: row.blockers ?? [],
      risks: row.risks ?? [],
      nextActions: row.nextActions ?? [],
      proposedDecisions: row.proposedDecisions ?? [],
      betterAlternatives: row.betterAlternatives ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function pendingParticipantIdsForMeeting(input: {
    participantAgentIds: string[];
    chairAgentId: string | null;
    contributedAgentIds: string[];
    status: string;
  }) {
    if (input.status !== "pending") return [];
    const contributed = new Set(input.contributedAgentIds);
    const chairAgentId = input.chairAgentId;
    const missingNonChairIds = input.participantAgentIds.filter(
      (agentId) => agentId !== chairAgentId && !contributed.has(agentId),
    );
    if (missingNonChairIds.length > 0) return missingNonChairIds;
    if (chairAgentId && input.participantAgentIds.includes(chairAgentId) && !contributed.has(chairAgentId)) {
      return [chairAgentId];
    }
    return input.participantAgentIds.filter((agentId) => !contributed.has(agentId));
  }

  async function readDefaultCompanyGoalId(companyId: string) {
    return db
      .select({ id: goals.id })
      .from(goals)
      .where(and(
        eq(goals.companyId, companyId),
        eq(goals.level, "company"),
        eq(goals.status, "active"),
        sql`${goals.parentId} is null`,
      ))
      .orderBy(asc(goals.createdAt))
      .limit(1)
      .then((rows) => rows[0]?.id ?? null);
  }

  async function repairWorkflowMeetingLinks(companyId: string) {
    const rows = await db
      .select()
      .from(meetings)
      .where(eq(meetings.companyId, companyId))
      .orderBy(desc(meetings.updatedAt), desc(meetings.id))
      .limit(500);

    let sourceLinksInserted = 0;
    let outcomeLinksInserted = 0;
    let contextRowsUpdated = 0;
    let defaultCompanyGoalId: string | null | undefined;

    for (const meeting of rows) {
      const result = parseStoredMeetingResult(meeting.result);
      const outcomeIssueIds = readIssueIdsFromMeetingResult(result);
      const candidateIssueIds = [
        meeting.sourceIssueId,
        ...outcomeIssueIds,
      ].filter((value): value is string => Boolean(value));
      const issueRows = candidateIssueIds.length > 0
        ? await db
            .select({
              id: issues.id,
              projectId: issues.projectId,
              goalId: issues.goalId,
            })
            .from(issues)
            .where(and(eq(issues.companyId, companyId), inArray(issues.id, [...new Set(candidateIssueIds)])))
        : [];
      const issueById = new Map(issueRows.map((issue) => [issue.id, issue] as const));

      if (meeting.sourceIssueId && issueById.has(meeting.sourceIssueId)) {
        sourceLinksInserted += await linkIssues(db, {
          companyId,
          meetingId: meeting.id,
          issueIds: [meeting.sourceIssueId],
          linkKind: "source",
        });
      }
      const validOutcomeIssueIds = outcomeIssueIds.filter((issueId) => issueById.has(issueId));
      if (validOutcomeIssueIds.length > 0) {
        outcomeLinksInserted += await linkIssues(db, {
          companyId,
          meetingId: meeting.id,
          issueIds: validOutcomeIssueIds,
          linkKind: "outcome",
        });
      }

      if (!meeting.projectId || !meeting.goalId) {
        const sourceIssue = meeting.sourceIssueId ? issueById.get(meeting.sourceIssueId) ?? null : null;
        if (!sourceIssue && !meeting.goalId && defaultCompanyGoalId === undefined) {
          defaultCompanyGoalId = await readDefaultCompanyGoalId(companyId);
        }
        const nextProjectId = meeting.projectId ?? sourceIssue?.projectId ?? null;
        const nextGoalId = meeting.goalId ?? sourceIssue?.goalId ?? defaultCompanyGoalId ?? null;
        if (nextProjectId !== meeting.projectId || nextGoalId !== meeting.goalId) {
          await db
            .update(meetings)
            .set({
              projectId: nextProjectId,
              goalId: nextGoalId,
              updatedAt: new Date(),
            })
            .where(eq(meetings.id, meeting.id));
          contextRowsUpdated += 1;
        }
      }
    }

    const totalInsertedLinks = sourceLinksInserted + outcomeLinksInserted;
    if (totalInsertedLinks > 0 || contextRowsUpdated > 0) {
      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "meeting_workflow",
        action: "meeting.workflow_repaired",
        entityType: "company",
        entityId: companyId,
        details: {
          checked: rows.length,
          sourceLinksInserted,
          outcomeLinksInserted,
          contextRowsUpdated,
        },
      });
    }

    return {
      checked: rows.length,
      sourceLinksInserted,
      outcomeLinksInserted,
      contextRowsUpdated,
    };
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
    const participantAgentIds = await listRunnableParticipantIds(companyId, recommendation.participantAgentIds);
    if (participantAgentIds.length === 0) return null;
    const chairAgentId = participantAgentIds.includes(recommendation.suggestedHeadAgentId ?? "")
      ? recommendation.suggestedHeadAgentId
      : participantAgentIds[0] ?? null;
    const baseIdempotencyKey = `meeting-workflow:${recommendation.id}`;
    const existingMeetings = await db
      .select({ id: meetings.id, status: meetings.status, idempotencyKey: meetings.idempotencyKey })
      .from(meetings)
      .where(and(
        eq(meetings.companyId, companyId),
        sql`${meetings.idempotencyKey} like ${`${baseIdempotencyKey}%`}`,
      ))
      .orderBy(desc(meetings.createdAt));
    if (existingMeetings.some((meeting) => meeting.status === "pending")) return null;
    const idempotencyKey = existingMeetings.length === 0
      ? baseIdempotencyKey
      : `${baseIdempotencyKey}:repeat:${existingMeetings.length + 1}`;

    const sourceContext = recommendation.issueId
      ? await db
          .select({ projectId: issues.projectId, goalId: issues.goalId })
          .from(issues)
          .where(and(eq(issues.companyId, companyId), eq(issues.id, recommendation.issueId)))
          .then((rows) => rows[0] ?? null)
      : null;
    const companyGoalId = recommendation.issueId ? null : await readDefaultCompanyGoalId(companyId);

    const now = new Date();
    const [created] = await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      const [meeting] = await txDb
        .insert(meetings)
        .values({
          companyId,
          projectId: sourceContext?.projectId ?? null,
          goalId: sourceContext?.goalId ?? companyGoalId,
          sourceIssueId: recommendation.issueId ?? null,
          meetingType: recommendation.trigger === "no_recent_meetings" ? "standup" : "operating_review",
          title: input.title,
          purpose: recommendation.reason,
          status: "pending",
          chairAgentId,
          idempotencyKey,
          agenda: input.agenda,
          expectedOutputs: input.expectedOutputs,
          contextMarkdown: input.contextMarkdown,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await txDb.insert(meetingParticipants).values(participantAgentIds.map((agentId) => ({
        companyId,
        meetingId: meeting.id,
        agentId,
        role: agentId === chairAgentId ? "chair" : "participant",
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
        participantAgentIds,
        chairAgentId,
      },
    });
    return {
      id: created.id,
      issueId: recommendation.issueId ?? null,
      participantAgentIds: recommendation.issueId && participantAgentIds.filter((agentId) => agentId !== chairAgentId).length > 0
        ? participantAgentIds.filter((agentId) => agentId !== chairAgentId)
        : participantAgentIds,
      chairAgentId,
    };
  }

  async function contribute(
    meetingId: string,
    input: MeetingContributionPayload,
    actor: MeetingActor,
  ): Promise<MeetingContributionSummary> {
    if (!actor.agentId) throw forbidden("Only meeting participants can contribute to this meeting");
    const meeting = await getMeetingById(meetingId);
    if (!meeting) throw notFound("Meeting not found");
    if (meeting.status !== "pending") throw conflict("Meeting has already been resolved");
    if (!(await isParticipant(meetingId, actor.agentId))) {
      throw forbidden("Only meeting participants can contribute to this meeting");
    }
    const payload = meetingContributionPayloadSchema.parse(input);
    const now = new Date();
    const row = await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      const [contribution] = await txDb
        .insert(meetingContributions)
        .values({
          companyId: meeting.companyId,
          meetingId,
          agentId: actor.agentId!,
          summaryMarkdown: payload.summaryMarkdown,
          progress: payload.progress,
          blockers: payload.blockers,
          risks: payload.risks,
          nextActions: payload.nextActions,
          proposedDecisions: payload.proposedDecisions,
          betterAlternatives: payload.betterAlternatives,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [meetingContributions.meetingId, meetingContributions.agentId],
          set: {
            summaryMarkdown: payload.summaryMarkdown,
            progress: payload.progress,
            blockers: payload.blockers,
            risks: payload.risks,
            nextActions: payload.nextActions,
            proposedDecisions: payload.proposedDecisions,
            betterAlternatives: payload.betterAlternatives,
            updatedAt: now,
          },
        })
        .returning();
      await txDb
        .update(meetingParticipants)
        .set({ status: "contributed", updatedAt: now })
        .where(and(
          eq(meetingParticipants.meetingId, meetingId),
          eq(meetingParticipants.agentId, actor.agentId!),
        ));
      return contribution;
    });
    if (!row) throw unprocessable("Meeting contribution could not be recorded");
    await logActivity(db, {
      companyId: meeting.companyId,
      actorType: "agent",
      actorId: actor.agentId,
      agentId: actor.agentId,
      action: "meeting.contributed",
      entityType: "meeting",
      entityId: meetingId,
      details: {
        progressCount: payload.progress.length,
        blockerCount: payload.blockers.length,
        riskCount: payload.risks.length,
        nextActionCount: payload.nextActions.length,
      },
    });
    const [agent] = await db
      .select({ name: agents.name, role: agents.role })
      .from(agents)
      .where(and(eq(agents.companyId, meeting.companyId), eq(agents.id, actor.agentId)))
      .limit(1);
    return contributionSummary({
      ...row,
      agentName: agent?.name ?? null,
      agentRole: agent?.role ?? null,
    });
  }

  async function listForCompany(companyId: string, options: {
    limit?: number;
    offset?: number;
    status?: string | null;
    agentId?: string | null;
    expectedOutput?: string | null;
    q?: string | null;
  } = {}): Promise<WorkMeetingSummary[]> {
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), 200);
    const offset = Math.max(Math.floor(options.offset ?? 0), 0);
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
      .limit(limit)
      .offset(offset);

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

    const contributionRows = meetingIds.length > 0
      ? await db
          .select({
            id: meetingContributions.id,
            meetingId: meetingContributions.meetingId,
            agentId: meetingContributions.agentId,
            agentName: agents.name,
            agentRole: agents.role,
            summaryMarkdown: meetingContributions.summaryMarkdown,
            progress: meetingContributions.progress,
            blockers: meetingContributions.blockers,
            risks: meetingContributions.risks,
            nextActions: meetingContributions.nextActions,
            proposedDecisions: meetingContributions.proposedDecisions,
            betterAlternatives: meetingContributions.betterAlternatives,
            createdAt: meetingContributions.createdAt,
            updatedAt: meetingContributions.updatedAt,
          })
          .from(meetingContributions)
          .innerJoin(agents, eq(agents.id, meetingContributions.agentId))
          .where(and(
            eq(meetingContributions.companyId, companyId),
            inArray(meetingContributions.meetingId, meetingIds),
          ))
          .orderBy(asc(meetingContributions.createdAt), asc(meetingContributions.id))
      : [];
    const contributionsByMeetingId = new Map<string, MeetingContributionSummary[]>();
    for (const row of contributionRows) {
      const list = contributionsByMeetingId.get(row.meetingId) ?? [];
      list.push(contributionSummary(row));
      contributionsByMeetingId.set(row.meetingId, list);
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
      const result = parseStoredMeetingResult(row.result);
      const unlinked = countUnlinkedMeetingOutcomes(result);
      const linkedIssues = linkedIssuesByMeetingId.get(row.id) ?? [];
      const participants = participantsByMeetingId.get(row.id) ?? [];
      const contributions = contributionsByMeetingId.get(row.id) ?? [];
      const contributedAgentIds = contributions.map((contribution) => contribution.agentId);
      const primaryIssue =
        linkedIssues.find((issue) => issue.issueId === row.sourceIssueId) ??
        linkedIssues.find((issue) => issue.linkKind === "source") ??
        linkedIssues[0] ??
        null;
      return {
        id: row.id,
        companyId: row.companyId,
        threadKind: "meeting",
        projectId: row.projectId ?? null,
        goalId: row.goalId ?? null,
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
        participantAgentIds: participants.map((agent) => agent.id),
        participants,
        contributions,
        contributedAgentIds,
        pendingParticipantAgentIds: pendingParticipantIdsForMeeting({
          participantAgentIds: participants.map((agent) => agent.id),
          chairAgentId: row.chairAgentId,
          contributedAgentIds,
          status: row.status,
        }),
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

  async function getSummaryById(companyId: string, meetingId: string) {
    const rows = await listForCompany(companyId, { limit: 200 });
    return rows.find((row) => row.id === meetingId) ?? null;
  }

  async function respond(meetingId: string, input: MeetingRespondInput, actor: MeetingActor) {
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
    const linkedOutcomeIssueIds = readIssueIdsFromMeetingResult(result);
    await validateCompanyIssueIds(db, meeting.companyId, linkedOutcomeIssueIds);
    const nonChairParticipantIds = participantRows
      .map((row) => row.agentId)
      .filter((agentId) => agentId !== meeting.chairAgentId);
    let missingContributorIds: string[] = [];
    let contributionOverride: { boardUserId: string; reason: string } | null = null;
    if (nonChairParticipantIds.length > 0) {
      const contributionRows = await db
        .select({ agentId: meetingContributions.agentId })
        .from(meetingContributions)
        .where(and(
          eq(meetingContributions.companyId, meeting.companyId),
          eq(meetingContributions.meetingId, meetingId),
          inArray(meetingContributions.agentId, nonChairParticipantIds),
        ));
      const contributedIds = new Set(contributionRows.map((row) => row.agentId));
      missingContributorIds = nonChairParticipantIds.filter((agentId) => !contributedIds.has(agentId));
      if (missingContributorIds.length > 0) {
        if (!input.overrideMissingContributions) {
          throw conflict("Meeting is waiting on participant contributions", { missingContributorIds });
        }
        const boardUserId = actor.userId;
        if (!boardUserId) {
          throw forbidden("Only board users can override missing meeting contributions");
        }
        const overrideReason = input.overrideReason?.trim() ?? "";
        if (!overrideReason) {
          throw unprocessable("overrideReason is required when overriding missing meeting contributions");
        }
        contributionOverride = { boardUserId, reason: overrideReason };
      }
    }
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
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
    if (contributionOverride) {
      await logActivity(db, {
        companyId: meeting.companyId,
        actorType: "user",
        actorId: contributionOverride.boardUserId,
        action: "meeting.contribution_override",
        entityType: "meeting",
        entityId: meetingId,
        details: {
          sourceIssueId: meeting.sourceIssueId,
          missingContributorIds,
          overrideReason: contributionOverride.reason,
        },
      });
    }
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

  async function resolveSupersededWorkflowMeetings(companyId: string) {
    const rows = await db
      .select()
      .from(meetings)
      .where(and(
        eq(meetings.companyId, companyId),
        eq(meetings.status, "pending"),
        sql`${meetings.idempotencyKey} like 'meeting-workflow:%'`,
        sql`${meetings.sourceIssueId} is not null`,
      ))
      .limit(200);

    const supersededIssueIds = await listIssueIdsWithPendingNextActionPath(
      companyId,
      rows.map((row) => row.sourceIssueId).filter((issueId): issueId is string => Boolean(issueId)),
    );

    let resolved = 0;
    for (const row of rows) {
      if (!row.sourceIssueId || !supersededIssueIds.has(row.sourceIssueId)) continue;

      const now = new Date();
      const result = agentMeetingResultSchema.parse({
        version: 1,
        summaryMarkdown:
          "Source issue already has a pending non-meeting interaction or approval that owns the next action; Paperclip closed this stale workflow meeting automatically.",
        decisions: [
          "Pending non-meeting interaction or approval already owns the next action for the source issue.",
        ],
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
          .where(and(eq(meetings.id, row.id), eq(meetings.status, "pending")))
          .returning();
        if (!meeting) return null;
        await txDb
          .update(meetingParticipants)
          .set({ status: "answered", updatedAt: now })
          .where(eq(meetingParticipants.meetingId, row.id));
        return meeting;
      });
      if (!updated) continue;

      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "meeting_workflow",
        action: "meeting.auto_resolved",
        entityType: "meeting",
        entityId: row.id,
        details: {
          sourceIssueId: row.sourceIssueId,
          reason: "pending_next_action_path",
        },
      });
      resolved += 1;
    }

    return resolved;
  }

  async function reconcilePendingWorkflowWakeups(companyId: string) {
    await resolveSupersededWorkflowMeetings(companyId);

    const cutoff = new Date(Date.now() - PENDING_MEETING_REWAKE_MS);
    const rows = await db
      .select()
      .from(meetings)
      .where(and(
        eq(meetings.companyId, companyId),
        eq(meetings.status, "pending"),
        sql`${meetings.idempotencyKey} like 'meeting-workflow:%'`,
      ))
      .orderBy(asc(meetings.updatedAt))
      .limit(200);

    const meetingIds = rows.map((row) => row.id);
    const activeRunRows = meetingIds.length > 0
        ? await db
          .select({
            meetingId: sql<string>`${heartbeatRuns.contextSnapshot}->>'meetingId'`,
            id: heartbeatRuns.id,
            agentId: heartbeatRuns.agentId,
            status: heartbeatRuns.status,
          })
          .from(heartbeatRuns)
          .where(and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ["queued", "running"]),
            inArray(sql<string>`${heartbeatRuns.contextSnapshot}->>'meetingId'`, meetingIds),
          ))
      : [];
    const activeRunsByMeetingId = new Map<string, ActiveMeetingRun[]>();
    for (const run of activeRunRows) {
      const meetingId = run.meetingId;
      if (!meetingId) continue;
      const current = activeRunsByMeetingId.get(meetingId) ?? [];
      current.push({ id: run.id, agentId: run.agentId, status: run.status });
      activeRunsByMeetingId.set(meetingId, current);
    }

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

    const contributionRows = meetingIds.length > 0
      ? await db
          .select({
            meetingId: meetingContributions.meetingId,
            agentId: meetingContributions.agentId,
            updatedAt: meetingContributions.updatedAt,
          })
          .from(meetingContributions)
          .where(and(
            eq(meetingContributions.companyId, companyId),
            inArray(meetingContributions.meetingId, meetingIds),
          ))
      : [];
    const contributionsByMeetingId = new Map<string, Array<{ agentId: string; updatedAt: Date }>>();
    for (const contribution of contributionRows) {
      const list = contributionsByMeetingId.get(contribution.meetingId) ?? [];
      list.push({ agentId: contribution.agentId, updatedAt: contribution.updatedAt });
      contributionsByMeetingId.set(contribution.meetingId, list);
    }

    const wakeTargets: MeetingWakeTarget[] = [];
    let cancelledUnrunnable = 0;
    for (const meeting of rows) {
      const activeRuns = activeRunsByMeetingId.get(meeting.id) ?? [];
      if (activeRuns.some((run) => run.status === "running")) continue;
      const repairResult = await repairSingleDepartmentWorkflowMeetingParticipants(
        companyId,
        meeting,
        participantsByMeetingId.get(meeting.id) ?? [],
        activeRuns,
      );
      const runnableIds = await listRunnableParticipantIds(
        companyId,
        repairResult.participantAgentIds,
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
      const chairAgentId = runnableIds.includes(meeting.chairAgentId ?? "")
        ? meeting.chairAgentId
        : runnableIds[0] ?? null;
      await pruneUnrunnablePendingWorkflowMeetingParticipants({
        companyId,
        meeting,
        participantAgentIds: repairResult.participantAgentIds,
        runnableParticipantIds: runnableIds,
        chairAgentId,
        activeRuns,
      });
      const contributionRowsForMeeting = contributionsByMeetingId.get(meeting.id) ?? [];
      const contributedIds = new Set(contributionRowsForMeeting.map((contribution) => contribution.agentId));
      const missingContributorIds = runnableIds.filter(
        (agentId) => agentId !== chairAgentId && !contributedIds.has(agentId),
      );
      const hasFreshContribution = contributionRowsForMeeting.some(
        (contribution) => toTimeMillis(contribution.updatedAt) >= toTimeMillis(meeting.updatedAt),
      );
      if (!repairResult.repaired && meeting.updatedAt > cutoff && !(missingContributorIds.length === 0 && hasFreshContribution)) {
        continue;
      }
      const [updated] = await db
        .update(meetings)
        .set({ updatedAt: new Date() })
        .where(and(eq(meetings.id, meeting.id), eq(meetings.status, "pending")))
        .returning();
      if (!updated) continue;
      const wakeParticipantIds = missingContributorIds.length > 0
        ? missingContributorIds
        : chairAgentId
          ? [chairAgentId]
          : runnableIds.slice(0, 1);
      wakeTargets.push({
        id: meeting.id,
        issueId: meeting.sourceIssueId,
        participantAgentIds: wakeParticipantIds,
        chairAgentId,
      });
    }
    return { meetings: wakeTargets, cancelledUnrunnable };
  }

  return {
    getById: getMeetingById,
    getSummaryById,
    isParticipant,
    createFromRecommendation,
    contribute,
    listForCompany,
    respond,
    linkOutcomeIssue,
    repairWorkflowMeetingLinks,
    resolveTerminalWorkflowMeetings,
    resolveSupersededWorkflowMeetings,
    reconcilePendingWorkflowWakeups,
  };
}
