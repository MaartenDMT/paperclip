import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  documents,
  heartbeatRuns,
  issueComments,
  issueDocuments,
  issueRelations,
  issueThreadInteractions,
  issues,
  meetingIssueLinks,
  meetings,
} from "@paperclipai/db";
import type {
  AcceptIssueThreadInteraction,
  AskUserQuestionsAnswer,
  AskUserQuestionsInteraction,
  CancelIssueThreadInteraction,
  CreateIssueThreadInteraction,
  IssueThreadInteraction,
  RequestConfirmationInteraction,
  RequestConfirmationTarget,
  RejectIssueThreadInteraction,
  RespondIssueThreadInteraction,
  AgentMeetingInteraction,
  AgentMeetingExpectedOutput,
  AgentMeetingResult,
  MeetingWorkflowHealth,
  MeetingWorkflowRecommendation,
  MeetingWorkflowTrigger,
  SuggestTasksInteraction,
  SuggestTasksResultCreatedTask,
  WorkMeetingSummary,
} from "@paperclipai/shared";
import {
  acceptIssueThreadInteractionSchema,
  askUserQuestionsPayloadSchema,
  askUserQuestionsResultSchema,
  cancelIssueThreadInteractionSchema,
  createIssueThreadInteractionSchema,
  rejectIssueThreadInteractionSchema,
  requestConfirmationPayloadSchema,
  requestConfirmationResultSchema,
  agentMeetingPayloadSchema,
  agentMeetingResultSchema,
  suggestTasksPayloadSchema,
  suggestTasksResultSchema,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { logActivity } from "./activity-log.js";
import { issueService } from "./issues.js";
import {
  countUnlinkedMeetingOutcomes,
  readIssueIdsFromMeetingResult,
  setMeetingOutcomeIssueId,
  type MeetingOutcomeLinkType,
  validateBusinessMeetingResult,
} from "./meeting-outcome-utils.js";
import { meetingService } from "./meetings.js";

type InteractionActor = {
  agentId?: string | null;
  userId?: string | null;
};

const ISSUE_THREAD_INTERACTION_IDEMPOTENCY_CONSTRAINT =
  "issue_thread_interactions_company_issue_idempotency_uq";

type IssueWakeTarget = {
  id: string;
  assigneeAgentId: string | null;
  assigneeUserId?: string | null;
  status: string;
};

type ResolvedInteractionResult = {
  interaction: IssueThreadInteraction;
  createdIssues: IssueWakeTarget[];
  continuationIssue?: IssueWakeTarget | null;
};

type IssueThreadInteractionRow = typeof issueThreadInteractions.$inferSelect;
type IssueTouchDb = Pick<Db, "update">;

type ListWorkMeetingsOptions = {
  limit?: number;
  status?: string | null;
  agentId?: string | null;
  expectedOutput?: string | null;
  q?: string | null;
};

type ReconcileMeetingWorkflowResult = {
  checked: number;
  created: number;
  requeuedPending: number;
  cancelledUnrunnable: number;
  resolvedTerminal: number;
  skipped: number;
  meetings: Array<{
    id: string;
    issueId: string | null;
    participantAgentIds: string[];
    chairAgentId: string | null;
  }>;
};

const MEETING_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_REVIEW_MS = 24 * 60 * 60 * 1000;
const STALE_IN_PROGRESS_MS = 72 * 60 * 60 * 1000;
const STALE_PENDING_MEETING_MS = 24 * 60 * 60 * 1000;
const PENDING_MEETING_REWAKE_MS = 15 * 60 * 1000;

const BUSINESS_OPERATING_MEETING_OUTPUTS: AgentMeetingExpectedOutput[] = [
  "goals",
  "targets",
  "kpis",
  "finance",
  "business_requirements",
  "agent_performance",
  "problems",
  "blockers",
  "tasks",
  "right_track",
  "optimization",
  "workflow_corrections",
  "memory_corrections",
  "idea_sharing",
  "workflows",
  "process",
  "plan_update",
  "questions",
  "decisions",
];

const MEETING_TRIGGER_OUTPUTS: Record<MeetingWorkflowTrigger, AgentMeetingExpectedOutput[]> = {
  blocked_without_edge: BUSINESS_OPERATING_MEETING_OUTPUTS,
  stale_review: BUSINESS_OPERATING_MEETING_OUTPUTS,
  stale_in_progress: BUSINESS_OPERATING_MEETING_OUTPUTS,
  no_recent_meetings: BUSINESS_OPERATING_MEETING_OUTPUTS,
};

const MEETING_TRIGGER_AGENDAS: Record<MeetingWorkflowTrigger, string[]> = {
  blocked_without_edge: [
    "Define the blocked business outcome, impacted goal and target, and current cost of delay.",
    "Confirm the business requirement, KPI, customer value, and budget impact attached to the blocked work.",
    "Review participating agents as employees: ownership, throughput, quality, handoff clarity, and blocker handling.",
    "Identify the concrete problem, owner, dependency, and missing first-class blocker edge.",
    "Agree on the process change or escalation path that prevents this blocker from recurring.",
  ],
  stale_review: [
    "Review the goal and target this work is meant to advance.",
    "Check KPI impact, quality bar, decision owner, and financial or budget implications.",
    "Assess the review participants as employees: response latency, decision quality, handoff quality, and whether ownership is clear.",
    "Decide the review outcome, remaining questions, and workflow or process change needed to close faster next time.",
  ],
  stale_in_progress: [
    "Compare current progress against the goal, target, KPI, and expected completion path.",
    "Confirm whether the active work still satisfies the business requirement and remains the highest-leverage task.",
    "Assess the assignee and collaborators as employees: execution velocity, quality, communication, and blocker handling.",
    "Surface problems, spend or budget risk, workflow friction, memory errors, and missing inputs.",
    "Choose the optimization, plan update, workflow correction, memory correction, owner, and next measurable checkpoint.",
  ],
  no_recent_meetings: [
    "Review company goals, near-term targets, KPIs, and open work health.",
    "Inspect finance signals: budget, spend trend, cost of delay, and expected return on the active work.",
    "Review agent performance as a management team: ownership, throughput, quality, coordination, and whether work is assigned to the right employees.",
    "Check that current work still maps to explicit business requirements and company priorities.",
    "Identify process and workflow optimizations, ideas to share, memory corrections, problems to escalate, and owners for the next operating cycle.",
  ],
};

const MEETING_TRIGGER_FOCUS: Record<MeetingWorkflowTrigger, string> = {
  blocked_without_edge: "Business review focus: goal alignment, business requirement, KPI and finance impact, employee ownership, blocker ownership, cost of delay, escalation path, and process prevention.",
  stale_review: "Business review focus: goal and target fit, KPI movement, financial or budget impact, customer value, employee decision quality, review workflow, and process latency.",
  stale_in_progress: "Business review focus: progress against target, KPI risk, budget burn, business requirement fit, employee performance, execution problems, workflow optimization, memory correctness, and plan correction.",
  no_recent_meetings: "Business review focus: company goals, targets, KPI trend, finance, business requirements, employee performance, cross-team problems, idea sharing, workflow health, memory correctness, and operating process improvements.",
};

function meetingWorkflowPolicy(): MeetingWorkflowHealth["policy"] {
  return {
    purpose: "Meetings are structured operating reviews used when company work needs recorded goals, targets, KPIs, finance context, business requirements, agent employee performance review, problems, optimizations, workflow/process changes, memory corrections, idea sharing, right-track checks, decisions, tasks, blockers, questions, or plan updates.",
    chairRule: "The chair is the nearest department head for the affected assignee. If no manager exists, the assignee chairs; cross-department work is chaired by the closest common head or the board.",
    triggerRules: [
      {
        id: "blocked_without_edge",
        label: "Blocker hygiene",
        when: "An issue says blocked/stuck/waiting but no first-class blocker edge exists.",
        chair: "Assignee's department head.",
        expectedOutputs: MEETING_TRIGGER_OUTPUTS.blocked_without_edge,
      },
      {
        id: "stale_review",
        label: "Review waiting",
        when: "An issue sits in review for more than 24 hours.",
        chair: "Review owner or assignee's department head.",
        expectedOutputs: MEETING_TRIGGER_OUTPUTS.stale_review,
      },
      {
        id: "stale_in_progress",
        label: "Execution ambiguity",
        when: "An in-progress issue has not moved for more than 72 hours.",
        chair: "Assignee's department head.",
        expectedOutputs: MEETING_TRIGGER_OUTPUTS.stale_in_progress,
      },
      {
        id: "no_recent_meetings",
        label: "No meeting activity",
        when: "Open work exists but no structured meeting was recorded in the last 7 days.",
        chair: "Company lead or board.",
        expectedOutputs: MEETING_TRIGGER_OUTPUTS.no_recent_meetings,
      },
    ],
    lifecycle: [
      {
        status: "triggered",
        label: "Triggered",
        description: "A blocker, stale review, stale execution, or operating gap requires a business meeting.",
      },
      {
        status: "pending",
        label: "Pending",
        description: "An agent creates an agent_meeting interaction with purpose, participants, business agenda, and expected outputs.",
      },
      {
        status: "answered",
        label: "Answered",
        description: "The meeting is resolved with a summary, business review, participating agent performance reviews, decisions, action items, blockers, open questions, right-track checks, ideas, workflow corrections, memory corrections, and relevant goal/KPI/finance/process notes.",
      },
      {
        status: "operationalized",
        label: "Operationalized",
        description: "Action items, blockers, workflow corrections, memory corrections, useful ideas, and performance follow-ups are linked to first-class issues so the meeting changes the work graph.",
      },
    ],
    doneDefinition: "A meeting is done when it has a business review, agent performance review where relevant, and every action item, blocker, workflow correction, memory correction, or useful idea is linked to an issue or explicitly closed as a decision/question.",
  };
}

function severityForMeetingTrigger(trigger: MeetingWorkflowTrigger): MeetingWorkflowRecommendation["severity"] {
  if (trigger === "blocked_without_edge") return "urgent";
  if (trigger === "stale_review" || trigger === "stale_in_progress") return "warning";
  return "info";
}

type IssueResolutionContext = {
  id: string;
  companyId: string;
  status: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
};

function isIssueThreadInteractionIdempotencyConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const err = error as { code?: string; constraint?: string; constraint_name?: string };
  const constraint = err.constraint ?? err.constraint_name;
  return err.code === "23505" && constraint === ISSUE_THREAD_INTERACTION_IDEMPOTENCY_CONSTRAINT;
}

function isEquivalentCreateRequest(
  row: IssueThreadInteractionRow,
  input: CreateIssueThreadInteraction,
  actor: InteractionActor,
) {
  return (
    row.kind === input.kind
    && row.continuationPolicy === input.continuationPolicy
    && (row.idempotencyKey ?? null) === (input.idempotencyKey ?? null)
    && (row.sourceCommentId ?? null) === (input.sourceCommentId ?? null)
    && (row.sourceRunId ?? null) === (input.sourceRunId ?? null)
    && (row.title ?? null) === (input.title ?? null)
    && (row.summary ?? null) === (input.summary ?? null)
    && (row.createdByAgentId ?? null) === (actor.agentId ?? null)
    && (row.createdByUserId ?? null) === (actor.userId ?? null)
    && isDeepStrictEqual(row.payload, input.payload)
  );
}

function hydrateInteraction(
  row: IssueThreadInteractionRow,
): IssueThreadInteraction {
  const base = {
    ...row,
    idempotencyKey: row.idempotencyKey ?? null,
    status: row.status as IssueThreadInteraction["status"],
    continuationPolicy: row.continuationPolicy as IssueThreadInteraction["continuationPolicy"],
  };

  switch (row.kind) {
    case "suggest_tasks":
      return {
        ...base,
        kind: "suggest_tasks",
        payload: suggestTasksPayloadSchema.parse(row.payload),
        result: row.result ? suggestTasksResultSchema.parse(row.result) : null,
      } satisfies SuggestTasksInteraction;
    case "ask_user_questions":
      return {
        ...base,
        kind: "ask_user_questions",
        payload: askUserQuestionsPayloadSchema.parse(row.payload),
        result: row.result ? askUserQuestionsResultSchema.parse(row.result) : null,
      } satisfies AskUserQuestionsInteraction;
    case "request_confirmation":
      return {
        ...base,
        kind: "request_confirmation",
        payload: requestConfirmationPayloadSchema.parse(row.payload),
        result: row.result ? requestConfirmationResultSchema.parse(row.result) : null,
      } satisfies RequestConfirmationInteraction;
    case "agent_meeting":
      return {
        ...base,
        kind: "agent_meeting",
        payload: agentMeetingPayloadSchema.parse(row.payload),
        result: row.result ? agentMeetingResultSchema.parse(row.result) : null,
      } satisfies AgentMeetingInteraction;
    default:
      throw unprocessable(`Unknown interaction kind: ${row.kind}`);
  }
}

async function touchIssue(db: IssueTouchDb, issueId: string) {
  await db
    .update(issues)
    .set({ updatedAt: new Date() })
    .where(eq(issues.id, issueId));
}

function isTerminalIssueStatus(status: string) {
  return status === "done" || status === "cancelled";
}

function toTimeMillis(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

async function validateMeetingResultIssueIdsForCompany(db: Db, companyId: string, result: AgentMeetingResult) {
  const issueIds = readIssueIdsFromMeetingResult(result);
  if (issueIds.length === 0) return;
  const rows = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.companyId, companyId), inArray(issues.id, issueIds)));
  const existingIssueIds = new Set(rows.map((row) => row.id));
  const invalidIssueIds = issueIds.filter((issueId) => !existingIssueIds.has(issueId));
  if (invalidIssueIds.length > 0) {
    throw unprocessable("Meeting result references issues outside this company or issues that do not exist", {
      invalidIssueIds,
    });
  }
}

function shouldReturnAcceptedConfirmationToCreatorAgent(args: {
  issue: IssueResolutionContext;
  current: IssueThreadInteractionRow;
  actor: InteractionActor;
}) {
  if (args.current.kind !== "request_confirmation") return false;
  if (!args.current.createdByAgentId) return false;
  if (!args.actor.userId) return false;
  if (!args.issue.assigneeUserId) return false;
  if (args.issue.assigneeAgentId) return false;
  if (isTerminalIssueStatus(args.issue.status)) return false;
  return true;
}

function buildTaskCreationOrder(tasks: ReadonlyArray<SuggestTasksInteraction["payload"]["tasks"][number]>) {
  const taskByClientKey = new Map(tasks.map((task) => [task.clientKey, task] as const));
  const ordered: Array<SuggestTasksInteraction["payload"]["tasks"][number]> = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (clientKey: string) => {
    const currentState = state.get(clientKey);
    if (currentState === "done") return;
    if (currentState === "visiting") {
      throw unprocessable("Suggested tasks contain a parentClientKey cycle");
    }

    const task = taskByClientKey.get(clientKey);
    if (!task) {
      throw unprocessable(`Unknown parentClientKey: ${clientKey}`);
    }

    state.set(clientKey, "visiting");
    if (task.parentClientKey) {
      visit(task.parentClientKey);
    }
    state.set(clientKey, "done");
    ordered.push(task);
  };

  for (const task of tasks) {
    visit(task.clientKey);
  }

  return ordered;
}

function resolveSelectedSuggestedTasks(args: {
  interaction: SuggestTasksInteraction;
  selectedClientKeys?: AcceptIssueThreadInteraction["selectedClientKeys"];
}) {
  const taskByClientKey = new Map(
    args.interaction.payload.tasks.map((task) => [task.clientKey, task] as const),
  );
  const selectedClientKeys = args.selectedClientKeys ?? args.interaction.payload.tasks.map((task) => task.clientKey);
  const selectedClientKeySet = new Set<string>();

  for (const clientKey of selectedClientKeys) {
    const task = taskByClientKey.get(clientKey);
    if (!task) {
      throw unprocessable(`Unknown suggested task clientKey: ${clientKey}`);
    }
    selectedClientKeySet.add(clientKey);
  }

  if (selectedClientKeySet.size === 0) {
    throw unprocessable("Select at least one suggested task to accept");
  }

  for (const clientKey of selectedClientKeySet) {
    let parentClientKey = taskByClientKey.get(clientKey)?.parentClientKey ?? null;
    while (parentClientKey) {
      if (!selectedClientKeySet.has(parentClientKey)) {
        throw unprocessable(`Suggested task ${clientKey} requires its parent ${parentClientKey} to also be selected`);
      }
      parentClientKey = taskByClientKey.get(parentClientKey)?.parentClientKey ?? null;
    }
  }

  return {
    selectedTasks: args.interaction.payload.tasks.filter((task) => selectedClientKeySet.has(task.clientKey)),
    skippedClientKeys: args.interaction.payload.tasks
      .filter((task) => !selectedClientKeySet.has(task.clientKey))
      .map((task) => task.clientKey),
  };
}

function normalizeQuestionAnswers(args: {
  questions: AskUserQuestionsInteraction["payload"]["questions"];
  answers: RespondIssueThreadInteraction["answers"];
}) {
  const questionById = new Map(args.questions.map((question) => [question.id, question] as const));
  const answerByQuestionId = new Map<string, AskUserQuestionsAnswer>();

  for (const answer of args.answers) {
    const question = questionById.get(answer.questionId);
    if (!question) {
      throw unprocessable(`Unknown questionId: ${answer.questionId}`);
    }
    if (answerByQuestionId.has(answer.questionId)) {
      throw unprocessable(`Duplicate answer for questionId: ${answer.questionId}`);
    }

    const uniqueOptionIds = [...new Set(answer.optionIds)];
    const validOptionIds = new Set(question.options.map((option) => option.id));
    for (const optionId of uniqueOptionIds) {
      if (!validOptionIds.has(optionId)) {
        throw unprocessable(`Unknown optionId for question ${answer.questionId}: ${optionId}`);
      }
    }

    if (question.selectionMode === "single" && uniqueOptionIds.length > 1) {
      throw unprocessable(`Question ${answer.questionId} only allows one answer`);
    }

    answerByQuestionId.set(answer.questionId, {
      questionId: answer.questionId,
      optionIds: uniqueOptionIds,
    });
  }

  for (const question of args.questions) {
    const answer = answerByQuestionId.get(question.id);
    if (question.required && (!answer || answer.optionIds.length === 0)) {
      throw unprocessable(`Question ${question.id} requires an answer`);
    }
  }

  return args.questions
    .map((question) => answerByQuestionId.get(question.id))
    .filter((answer): answer is AskUserQuestionsAnswer => Boolean(answer));
}

async function getIssueDocumentTargetSnapshot(db: Db | any, args: {
  companyId: string;
  issueId: string;
  target: RequestConfirmationTarget;
}) {
  if (args.target.type !== "issue_document") return null;
  const targetIssueId = args.target.issueId ?? args.issueId;
  const row = await db
    .select({
      issueId: issueDocuments.issueId,
      documentId: issueDocuments.documentId,
      key: issueDocuments.key,
      latestRevisionId: documents.latestRevisionId,
      latestRevisionNumber: documents.latestRevisionNumber,
    })
    .from(issueDocuments)
    .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
    .where(and(
      eq(issueDocuments.companyId, args.companyId),
      eq(issueDocuments.issueId, targetIssueId),
      eq(issueDocuments.key, args.target.key),
    ))
    .then((rows: Array<{
      issueId: string;
      documentId: string;
      key: string;
      latestRevisionId: string | null;
      latestRevisionNumber: number;
    }>) => rows[0] ?? null);

  if (!row) return null;
  if (args.target.documentId && args.target.documentId !== row.documentId) return null;
  return row;
}

function buildIssueDocumentTargetFromSnapshot(args: {
  issueId: string;
  snapshot: {
    issueId: string;
    documentId: string;
    key: string;
    latestRevisionId: string | null;
    latestRevisionNumber: number;
  } | null;
}): RequestConfirmationTarget | null {
  if (!args.snapshot?.latestRevisionId) return null;
  return {
    type: "issue_document",
    issueId: args.snapshot.issueId ?? args.issueId,
    documentId: args.snapshot.documentId,
    key: args.snapshot.key,
    revisionId: args.snapshot.latestRevisionId,
    revisionNumber: args.snapshot.latestRevisionNumber,
  };
}

function buildIssueDocumentTargetFromDocument(args: {
  issueId: string;
  document: { id: string; key: string; latestRevisionId?: string | null; latestRevisionNumber?: number | null } | null;
}): RequestConfirmationTarget | null {
  if (!args.document?.latestRevisionId) return null;
  return {
    type: "issue_document",
    issueId: args.issueId,
    documentId: args.document.id,
    key: args.document.key,
    revisionId: args.document.latestRevisionId,
    revisionNumber: args.document.latestRevisionNumber ?? null,
  };
}

async function assertRequestConfirmationTargetIsCurrent(db: Db | any, args: {
  companyId: string;
  issueId: string;
  target?: RequestConfirmationTarget | null;
}) {
  if (!args.target) return;
  if (args.target.type !== "issue_document") return;
  const snapshot = await getIssueDocumentTargetSnapshot(db, {
    companyId: args.companyId,
    issueId: args.issueId,
    target: args.target,
  });
  if (!snapshot || snapshot.latestRevisionId !== args.target.revisionId) {
    throw unprocessable("request_confirmation target must reference the current issue document revision");
  }
  if (args.target.revisionNumber && snapshot.latestRevisionNumber !== args.target.revisionNumber) {
    throw unprocessable("request_confirmation target revisionNumber must match the current issue document revision");
  }
}

async function expireStaleRequestConfirmationTarget(db: Db | any, args: {
  row: IssueThreadInteractionRow;
  actor: InteractionActor;
}): Promise<IssueThreadInteraction | null> {
  if (args.row.kind !== "request_confirmation" || args.row.status !== "pending") return null;
  const interaction = hydrateInteraction(args.row) as RequestConfirmationInteraction;
  const target = interaction.payload.target ?? null;
  if (!target) return null;
  if (target.type !== "issue_document") return null;

  const snapshot = await getIssueDocumentTargetSnapshot(db, {
    companyId: args.row.companyId,
    issueId: args.row.issueId,
    target,
  });
  const isCurrent =
    snapshot
    && snapshot.latestRevisionId === target.revisionId
    && (!target.revisionNumber || snapshot.latestRevisionNumber === target.revisionNumber);
  if (isCurrent) return null;

  const now = new Date();
  const currentTarget = buildIssueDocumentTargetFromSnapshot({
    issueId: args.row.issueId,
    snapshot,
  });
  const [updated] = await db
    .update(issueThreadInteractions)
    .set({
      status: "expired",
      payload: currentTarget
        ? {
            ...interaction.payload,
            target: currentTarget,
          }
        : interaction.payload,
      result: {
        version: 1,
        outcome: "stale_target",
        staleTarget: target,
      },
      resolvedByAgentId: args.actor.agentId ?? null,
      resolvedByUserId: args.actor.userId ?? null,
      resolvedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(issueThreadInteractions.id, args.row.id),
      eq(issueThreadInteractions.status, "pending"),
    ))
    .returning();

  if (!updated) {
    throw conflict("Interaction has already been resolved");
  }
  await touchIssue(db, args.row.issueId);
  return hydrateInteraction(updated);
}

export function issueThreadInteractionService(db: Db) {
  async function getIdempotentInteraction(args: {
    issueId: string;
    companyId: string;
    idempotencyKey: string;
  }) {
    return db
      .select()
      .from(issueThreadInteractions)
      .where(and(
        eq(issueThreadInteractions.companyId, args.companyId),
        eq(issueThreadInteractions.issueId, args.issueId),
        eq(issueThreadInteractions.idempotencyKey, args.idempotencyKey),
      ))
      .then((rows) => rows[0] ?? null);
  }

  async function getPendingInteractionForResolution(args: {
    issue: { id: string; companyId: string };
    interactionId: string;
  }) {
    const current = await db
      .select()
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.id, args.interactionId))
      .then((rows) => rows[0] ?? null);

    if (!current) throw notFound("Interaction not found");
    if (current.companyId !== args.issue.companyId || current.issueId !== args.issue.id) {
      throw notFound("Interaction not found");
    }
    if (current.status !== "pending") {
      throw conflict("Interaction has already been resolved");
    }
    return current;
  }

  async function acceptRequestConfirmation(args: {
    issue: { id: string; companyId: string };
    current: IssueThreadInteractionRow;
    actor: InteractionActor;
  }): Promise<{
    interaction: IssueThreadInteraction;
    continuationIssue: IssueWakeTarget | null;
  }> {
    const expired = await expireStaleRequestConfirmationTarget(db, {
      row: args.current,
      actor: args.actor,
    });
    if (expired) {
      return { interaction: expired, continuationIssue: null };
    }

    const now = new Date();
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(issueThreadInteractions)
        .set({
          status: "accepted",
          result: {
            version: 1,
            outcome: "accepted",
          },
          resolvedByAgentId: args.actor.agentId ?? null,
          resolvedByUserId: args.actor.userId ?? null,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(issueThreadInteractions.id, args.current.id),
          eq(issueThreadInteractions.status, "pending"),
        ))
        .returning();

      if (!updated) {
        throw conflict("Interaction has already been resolved");
      }

      const issueContext = await tx
        .select({
          id: issues.id,
          companyId: issues.companyId,
          status: issues.status,
          assigneeAgentId: issues.assigneeAgentId,
          assigneeUserId: issues.assigneeUserId,
        })
        .from(issues)
        .where(eq(issues.id, args.issue.id))
        .then((rows: IssueResolutionContext[]) => rows[0] ?? null);

      if (!issueContext || issueContext.companyId !== args.issue.companyId) {
        throw notFound("Issue not found");
      }

      let continuationIssue: IssueWakeTarget | null = null;
      if (shouldReturnAcceptedConfirmationToCreatorAgent({
        issue: issueContext,
        current: args.current,
        actor: args.actor,
      })) {
        const returnStatus = issueContext.status === "blocked" ? "blocked" : "todo";
        const returnedIssue = await issueService(db).update(args.issue.id, {
          status: returnStatus,
          assigneeAgentId: args.current.createdByAgentId,
          assigneeUserId: null,
          actorAgentId: args.actor.agentId ?? null,
          actorUserId: args.actor.userId ?? null,
        }, tx);

        if (returnedIssue) {
          continuationIssue = {
            id: returnedIssue.id,
            assigneeAgentId: returnedIssue.assigneeAgentId ?? null,
            assigneeUserId: returnedIssue.assigneeUserId ?? null,
            status: returnedIssue.status,
          };
        }
      } else {
        await touchIssue(tx, args.issue.id);
      }

      return {
        interaction: hydrateInteraction(updated),
        continuationIssue,
      };
    });
  }

  async function rejectRequestConfirmation(args: {
    issue: { id: string; companyId: string };
    current: IssueThreadInteractionRow;
    input: RejectIssueThreadInteraction;
    actor: InteractionActor;
  }): Promise<IssueThreadInteraction> {
    const expired = await expireStaleRequestConfirmationTarget(db, {
      row: args.current,
      actor: args.actor,
    });
    if (expired) {
      return expired;
    }

    const interaction = hydrateInteraction(args.current) as RequestConfirmationInteraction;
    const reason = args.input.reason?.trim() ?? "";
    if (interaction.payload.rejectRequiresReason === true && reason.length === 0) {
      throw unprocessable("A decline reason is required for this confirmation");
    }

    const now = new Date();
    const [updated] = await db
      .update(issueThreadInteractions)
      .set({
        status: "rejected",
        result: {
          version: 1,
          outcome: "rejected",
          reason: reason || null,
        },
        resolvedByAgentId: args.actor.agentId ?? null,
        resolvedByUserId: args.actor.userId ?? null,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(issueThreadInteractions.id, args.current.id),
        eq(issueThreadInteractions.status, "pending"),
      ))
      .returning();

    if (!updated) {
      throw conflict("Interaction has already been resolved");
    }
    await touchIssue(db, args.issue.id);
    return hydrateInteraction(updated);
  }

  async function createMeetingFromRecommendation(
    companyId: string,
    recommendation: MeetingWorkflowRecommendation,
  ) {
    if (recommendation.participantAgentIds.length === 0) {
      return null;
    }

    const issueLabel = recommendation.issueIdentifier ?? recommendation.issueId;
    return meetingService(db).createFromRecommendation(companyId, recommendation, {
      title: `Work meeting: ${issueLabel ?? "company"}`,
      agenda: MEETING_TRIGGER_AGENDAS[recommendation.trigger],
      expectedOutputs: recommendation.expectedOutputs,
      contextMarkdown: [
        recommendation.issueId ? `Issue: ${recommendation.issueIdentifier ?? recommendation.issueId}` : "Scope: company",
        recommendation.issueTitle ? `Title: ${recommendation.issueTitle}` : null,
        recommendation.issueStatus ? `Status: ${recommendation.issueStatus}` : null,
        recommendation.suggestedHeadName ? `Suggested chair: ${recommendation.suggestedHeadName}` : null,
        MEETING_TRIGGER_FOCUS[recommendation.trigger],
        "Record the outcome as a meeting result, including businessReview, agentPerformanceReviews, right-track checks, ideas, workflow corrections, and memory corrections when relevant.",
        "Convert action items/blockers into linked issues; agentPerformanceReviews can link follow-up issues for coaching or reassignment; memoryCorrections should name karpathy-memory, para-memory, or other and identify the file/path when known.",
      ].filter(Boolean).join("\n"),
    });
  }

  async function resolveTerminalMeetingWorkflowInteractions(companyId: string) {
    const rows = await db
      .select({
        interaction: issueThreadInteractions,
        issueStatus: issues.status,
      })
      .from(issueThreadInteractions)
      .innerJoin(issues, eq(issues.id, issueThreadInteractions.issueId))
      .where(and(
        eq(issueThreadInteractions.companyId, companyId),
        eq(issueThreadInteractions.kind, "agent_meeting"),
        eq(issueThreadInteractions.status, "pending"),
        sql`${issueThreadInteractions.idempotencyKey} like 'meeting-workflow:%'`,
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
      const [updated] = await db
        .update(issueThreadInteractions)
        .set({
          status: "answered",
          result,
          resolvedByAgentId: null,
          resolvedByUserId: null,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(issueThreadInteractions.id, row.interaction.id),
          eq(issueThreadInteractions.status, "pending"),
        ))
        .returning();
      if (!updated) continue;
      resolved += 1;
      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "meeting_workflow",
        action: "issue.thread_interaction_answered",
        entityType: "issue",
        entityId: row.interaction.issueId,
        details: {
          interactionId: row.interaction.id,
          interactionKind: "agent_meeting",
          interactionStatus: "answered",
          source: "meeting_workflow",
          reason: "terminal_source_issue",
          issueStatus: row.issueStatus,
        },
      });
    }

    return resolved;
  }

  async function listRunnableMeetingParticipantIds(companyId: string, participantAgentIds: string[]) {
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

  async function reconcilePendingMeetingWorkflowWakeups(companyId: string) {
    const cutoff = new Date(Date.now() - PENDING_MEETING_REWAKE_MS);
    const rows = await db
      .select({
        interaction: issueThreadInteractions,
        issueStatus: issues.status,
      })
      .from(issueThreadInteractions)
      .innerJoin(issues, eq(issues.id, issueThreadInteractions.issueId))
      .where(and(
        eq(issueThreadInteractions.companyId, companyId),
        eq(issueThreadInteractions.kind, "agent_meeting"),
        eq(issueThreadInteractions.status, "pending"),
        sql`${issueThreadInteractions.idempotencyKey} like 'meeting-workflow:%'`,
        sql`${issues.status} not in ('done', 'cancelled')`,
        lte(issueThreadInteractions.updatedAt, cutoff),
      ))
      .orderBy(asc(issueThreadInteractions.updatedAt))
      .limit(50);

    const interactionIds = rows.map((row) => row.interaction.id);
    const activeRunRows = interactionIds.length > 0
      ? await db
          .select({
            interactionId: sql<string>`${heartbeatRuns.contextSnapshot}->>'interactionId'`,
          })
          .from(heartbeatRuns)
          .where(and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ["queued", "running"]),
            inArray(sql<string>`${heartbeatRuns.contextSnapshot}->>'interactionId'`, interactionIds),
          ))
      : [];
    const interactionIdsWithActiveRuns = new Set(activeRunRows.map((row) => row.interactionId));

    const meetings: ReconcileMeetingWorkflowResult["meetings"] = [];
    let cancelledUnrunnable = 0;
    for (const row of rows) {
      if (interactionIdsWithActiveRuns.has(row.interaction.id)) continue;

      const interaction = hydrateInteraction(row.interaction);
      if (interaction.kind !== "agent_meeting") continue;

      const runnableParticipantIds = await listRunnableMeetingParticipantIds(
        companyId,
        interaction.payload.participantAgentIds,
      );
      if (runnableParticipantIds.length === 0) {
        const now = new Date();
        const [updated] = await db
          .update(issueThreadInteractions)
          .set({
            status: "cancelled",
            resolvedByAgentId: null,
            resolvedByUserId: null,
            resolvedAt: now,
            updatedAt: now,
          })
          .where(and(
            eq(issueThreadInteractions.id, row.interaction.id),
            eq(issueThreadInteractions.status, "pending"),
          ))
          .returning();
        if (!updated) continue;
        cancelledUnrunnable += 1;
        await logActivity(db, {
          companyId,
          actorType: "system",
          actorId: "meeting_workflow",
          action: "issue.thread_interaction_cancelled",
          entityType: "issue",
          entityId: row.interaction.issueId,
          details: {
            interactionId: row.interaction.id,
            interactionKind: "agent_meeting",
            interactionStatus: "cancelled",
            source: "meeting_workflow",
            reason: "no_runnable_participants",
            issueStatus: row.issueStatus,
          },
        });
        continue;
      }

      const [updated] = await db
        .update(issueThreadInteractions)
        .set({ updatedAt: new Date() })
        .where(and(
          eq(issueThreadInteractions.id, row.interaction.id),
          eq(issueThreadInteractions.status, "pending"),
        ))
        .returning();
      if (!updated) continue;
      meetings.push({
        id: interaction.id,
        issueId: interaction.issueId,
        participantAgentIds: runnableParticipantIds,
        chairAgentId: runnableParticipantIds[0] ?? null,
      });
    }

    return {
      meetings,
      cancelledUnrunnable,
    };
  }

  return {
    listMeetingsForCompany: async (
      companyId: string,
      options: ListWorkMeetingsOptions = {},
    ): Promise<WorkMeetingSummary[]> => {
      const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), 200);
      const firstClassMeetings = await meetingService(db).listForCompany(companyId, options);
      const filters = [
        eq(issueThreadInteractions.companyId, companyId),
        eq(issueThreadInteractions.kind, "agent_meeting"),
      ];
      if (options.status) filters.push(eq(issueThreadInteractions.status, options.status));
      if (options.agentId) {
        filters.push(sql`${issueThreadInteractions.payload}->'participantAgentIds' ? ${options.agentId}`);
      }
      if (options.expectedOutput) {
        filters.push(sql`${issueThreadInteractions.payload}->'expectedOutputs' ? ${options.expectedOutput}`);
      }
      if (options.q) {
        const q = `%${options.q.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
        filters.push(sql`(
          ${issueThreadInteractions.title} ilike ${q} escape '\\'
          or ${issueThreadInteractions.summary} ilike ${q} escape '\\'
          or ${issues.title} ilike ${q} escape '\\'
          or ${issues.identifier} ilike ${q} escape '\\'
          or (${issueThreadInteractions.payload}->>'purpose') ilike ${q} escape '\\'
        )`);
      }

      const rows = await db
        .select({
          interaction: issueThreadInteractions,
          issueIdentifier: issues.identifier,
          issueTitle: issues.title,
          issueStatus: issues.status,
        })
        .from(issueThreadInteractions)
        .innerJoin(issues, eq(issues.id, issueThreadInteractions.issueId))
        .where(and(...filters))
        .orderBy(desc(issueThreadInteractions.createdAt))
        .limit(limit);

      const participantIds = [...new Set(rows.flatMap((row) => {
        const interaction = hydrateInteraction(row.interaction);
        return interaction.kind === "agent_meeting" ? interaction.payload.participantAgentIds : [];
      }))];
      const participantRows = participantIds.length > 0
        ? await db
            .select({
              id: agents.id,
              name: agents.name,
              role: agents.role,
              title: agents.title,
              status: agents.status,
            })
            .from(agents)
            .where(and(eq(agents.companyId, companyId), inArray(agents.id, participantIds)))
        : [];
      const participantById = new Map(participantRows.map((agent) => [agent.id, agent]));

      const now = Date.now();
      const legacyMeetings: WorkMeetingSummary[] = rows.map((row) => {
        const interaction = hydrateInteraction(row.interaction);
        if (interaction.kind !== "agent_meeting") {
          throw unprocessable("Unexpected non-meeting interaction in work meeting query");
        }
        const result = interaction.result ?? null;
        const unlinked = countUnlinkedMeetingOutcomes(result);
        return {
          id: interaction.id,
          companyId: interaction.companyId,
          threadKind: "issue_interaction",
          issueId: interaction.issueId,
          issueIdentifier: row.issueIdentifier,
          issueTitle: row.issueTitle,
          issueStatus: row.issueStatus as WorkMeetingSummary["issueStatus"],
          linkedIssues: [{
            issueId: interaction.issueId,
            identifier: row.issueIdentifier,
            title: row.issueTitle,
            status: row.issueStatus as WorkMeetingSummary["issueStatus"] & string,
            linkKind: "source",
          }],
          sourceIssueId: interaction.issueId,
          meetingType: "legacy_issue_interaction",
          chairAgentId: null,
          title: interaction.title ?? null,
          status: interaction.status,
          purpose: interaction.payload.purpose,
          agenda: interaction.payload.agenda,
          participantAgentIds: interaction.payload.participantAgentIds,
          participants: interaction.payload.participantAgentIds
            .map((agentId) => participantById.get(agentId))
            .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent)),
          expectedOutputs: interaction.payload.expectedOutputs,
          result,
          resultSummaryMarkdown: result?.summaryMarkdown ?? null,
          pendingAgeHours: interaction.status === "pending"
            ? Math.max(0, (now - toTimeMillis(interaction.createdAt)) / (1000 * 60 * 60))
            : null,
          ...unlinked,
          createdAt: interaction.createdAt,
          resolvedAt: interaction.resolvedAt ?? null,
        };
      });
      return [...firstClassMeetings, ...legacyMeetings]
        .sort((left, right) => toTimeMillis(right.createdAt) - toTimeMillis(left.createdAt))
        .slice(0, limit);
    },

    linkMeetingOutcomeIssue: async (
      companyId: string,
      meetingId: string,
      input: { outcomeType: MeetingOutcomeLinkType; index: number; issueId: string },
      actor: InteractionActor,
    ) => {
      const [firstClassMeeting] = await db
        .select({ id: meetings.id })
        .from(meetings)
        .where(and(eq(meetings.companyId, companyId), eq(meetings.id, meetingId)))
        .limit(1);
      if (firstClassMeeting) {
        await meetingService(db).linkOutcomeIssue(meetingId, input, actor);
        return { threadKind: "meeting" as const, meetingId, issueId: input.issueId };
      }

      const current = await db
        .select()
        .from(issueThreadInteractions)
        .where(and(
          eq(issueThreadInteractions.companyId, companyId),
          eq(issueThreadInteractions.id, meetingId),
          eq(issueThreadInteractions.kind, "agent_meeting"),
        ))
        .then((rows) => rows[0] ?? null);
      if (!current) throw notFound("Meeting not found");
      if (!current.result) throw unprocessable("Meeting has no result to operationalize");

      const result = agentMeetingResultSchema.parse(current.result);
      const nextResult = setMeetingOutcomeIssueId(result, input.outcomeType, input.index, input.issueId);
      await validateMeetingResultIssueIdsForCompany(db, companyId, nextResult);
      const [updated] = await db
        .update(issueThreadInteractions)
        .set({ result: nextResult, updatedAt: new Date() })
        .where(eq(issueThreadInteractions.id, meetingId))
        .returning();
      if (!updated) throw notFound("Meeting not found");
      await logActivity(db, {
        companyId,
        actorType: actor.agentId ? "agent" : "user",
        actorId: actor.agentId ?? actor.userId ?? "system",
        agentId: actor.agentId ?? null,
        action: "issue.thread_interaction_meeting_outcome_linked",
        entityType: "issue_thread_interaction",
        entityId: meetingId,
        details: {
          outcomeType: input.outcomeType,
          index: input.index,
          issueId: input.issueId,
        },
      });
      await touchIssue(db, current.issueId);
      return { threadKind: "issue_interaction" as const, meetingId, issueId: input.issueId };
    },

    getMeetingWorkflowHealth: async (companyId: string): Promise<MeetingWorkflowHealth> => {
      const now = Date.now();
      const meetingRows = await db
        .select()
        .from(issueThreadInteractions)
        .where(and(
          eq(issueThreadInteractions.companyId, companyId),
          eq(issueThreadInteractions.kind, "agent_meeting"),
        ))
        .orderBy(desc(issueThreadInteractions.createdAt))
        .limit(500);
      const firstClassMeetingRows = await db
        .select()
        .from(meetings)
        .where(eq(meetings.companyId, companyId))
        .orderBy(desc(meetings.createdAt))
        .limit(500);
      const firstClassMeetingIds = firstClassMeetingRows.map((meeting) => meeting.id);

      const openIssueRows = await db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
          assigneeAgentId: issues.assigneeAgentId,
          updatedAt: issues.updatedAt,
        })
        .from(issues)
        .where(and(
          eq(issues.companyId, companyId),
          sql`${issues.status} not in ('done', 'cancelled')`,
          sql`${issues.hiddenAt} is null`,
        ))
        .orderBy(desc(issues.updatedAt))
        .limit(500);

      const openIssueIds = openIssueRows.map((issue) => issue.id);
      const firstClassMeetingLinkRows = firstClassMeetingIds.length > 0 && openIssueIds.length > 0
        ? await db
            .select({
              meetingId: meetingIssueLinks.meetingId,
              issueId: meetingIssueLinks.issueId,
            })
            .from(meetingIssueLinks)
            .where(and(
              eq(meetingIssueLinks.companyId, companyId),
              inArray(meetingIssueLinks.meetingId, firstClassMeetingIds),
              inArray(meetingIssueLinks.issueId, openIssueIds),
            ))
        : [];
      const companyAgentRows = await db
        .select({
          id: agents.id,
          name: agents.name,
          role: agents.role,
          title: agents.title,
          reportsTo: agents.reportsTo,
          status: agents.status,
        })
        .from(agents)
        .where(and(eq(agents.companyId, companyId), sql`${agents.status} <> 'terminated'`));
      const agentById = new Map(companyAgentRows.map((agent) => [agent.id, agent] as const));
      const topLevelHead = companyAgentRows.find((agent) => agent.reportsTo === null) ?? null;

      const blockerEdgeRows = openIssueIds.length > 0
        ? await db
            .select({ issueId: issueRelations.issueId })
            .from(issueRelations)
            .where(and(
              eq(issueRelations.companyId, companyId),
              inArray(issueRelations.issueId, openIssueIds),
              eq(issueRelations.type, "blocks"),
            ))
        : [];
      const blockerEdgeIssueIds = new Set(blockerEdgeRows.map((row) => row.issueId));

      const childIssueRows = openIssueIds.length > 0
        ? await db
            .select({
              id: issues.id,
              parentId: issues.parentId,
              assigneeAgentId: issues.assigneeAgentId,
            })
            .from(issues)
            .where(and(
              eq(issues.companyId, companyId),
              inArray(issues.parentId, openIssueIds),
              sql`${issues.status} not in ('done', 'cancelled')`,
              sql`${issues.hiddenAt} is null`,
            ))
        : [];
      const childAssigneesByParentId = new Map<string, string[]>();
      for (const child of childIssueRows) {
        if (!child.parentId || !child.assigneeAgentId) continue;
        const current = childAssigneesByParentId.get(child.parentId) ?? [];
        current.push(child.assigneeAgentId);
        childAssigneesByParentId.set(child.parentId, current);
      }

      const meetingsByIssueId = new Map<string, IssueThreadInteractionRow[]>();
      for (const meeting of meetingRows) {
        const group = meetingsByIssueId.get(meeting.issueId) ?? [];
        group.push(meeting);
        meetingsByIssueId.set(meeting.issueId, group);
      }
      const firstClassMeetingsByIssueId = new Map<string, typeof firstClassMeetingRows>();
      for (const link of firstClassMeetingLinkRows) {
        const meeting = firstClassMeetingRows.find((candidate) => candidate.id === link.meetingId);
        if (!meeting) continue;
        const group = firstClassMeetingsByIssueId.get(link.issueId) ?? [];
        group.push(meeting);
        firstClassMeetingsByIssueId.set(link.issueId, group);
      }
      const hasMeetingCoverage = (issueId: string) => {
        const rows = meetingsByIssueId.get(issueId) ?? [];
        const legacyCovered = rows.some((meeting) => {
          if (meeting.status === "pending") return true;
          return now - meeting.createdAt.getTime() <= MEETING_RECENT_WINDOW_MS;
        });
        if (legacyCovered) return true;
        const firstClassRows = firstClassMeetingsByIssueId.get(issueId) ?? [];
        return firstClassRows.some((meeting) => {
          if (meeting.status === "pending") return true;
          return now - meeting.createdAt.getTime() <= MEETING_RECENT_WINDOW_MS;
        });
      };
      const resolveHead = (assigneeAgentId: string | null) => {
        const assignee = assigneeAgentId ? agentById.get(assigneeAgentId) ?? null : null;
        if (assignee?.reportsTo) return agentById.get(assignee.reportsTo) ?? assignee;
        return assignee ?? topLevelHead;
      };
      const resolveDepartmentHeadId = (agentId: string | null) => resolveHead(agentId)?.id ?? null;
      const buildRecommendation = (
        trigger: MeetingWorkflowTrigger,
        issue: typeof openIssueRows[number] | null,
        reason: string,
      ): MeetingWorkflowRecommendation => {
        const head = resolveHead(issue?.assigneeAgentId ?? null);
        const relatedAssigneeIds = [
          ...(issue?.assigneeAgentId ? [issue.assigneeAgentId] : []),
          ...(issue?.id ? childAssigneesByParentId.get(issue.id) ?? [] : []),
        ];
        const relatedHeadIds = relatedAssigneeIds
          .map((agentId) => resolveDepartmentHeadId(agentId))
          .filter((agentId): agentId is string => Boolean(agentId));
        const crossesDepartments = new Set(relatedHeadIds).size > 1;
        const includeTopLevelHead =
          trigger === "no_recent_meetings" ||
          crossesDepartments ||
          !head;
        const participantIds = [...new Set([
          ...(head ? [head.id] : []),
          ...relatedHeadIds,
          ...relatedAssigneeIds,
          ...(includeTopLevelHead && topLevelHead
            ? [topLevelHead.id]
            : []),
        ])].slice(0, 20);
        return {
          id: `${trigger}:${issue?.id ?? "company"}`,
          trigger,
          severity: severityForMeetingTrigger(trigger),
          reason,
          issueId: issue?.id ?? null,
          issueIdentifier: issue?.identifier ?? null,
          issueTitle: issue?.title ?? null,
          issueStatus: issue?.status as MeetingWorkflowRecommendation["issueStatus"] ?? null,
          suggestedHeadAgentId: head?.id ?? null,
          suggestedHeadName: head?.name ?? null,
          participantAgentIds: participantIds,
          participantNames: participantIds
            .map((agentId) => agentById.get(agentId)?.name ?? null)
            .filter((name): name is string => Boolean(name)),
          expectedOutputs: MEETING_TRIGGER_OUTPUTS[trigger],
        };
      };

      const recommendations: MeetingWorkflowRecommendation[] = [];
      for (const issue of openIssueRows) {
        if (hasMeetingCoverage(issue.id)) continue;
        const ageMs = now - issue.updatedAt.getTime();
        if (issue.status === "blocked" && !blockerEdgeIssueIds.has(issue.id)) {
          recommendations.push(buildRecommendation(
            "blocked_without_edge",
            issue,
            "Issue is blocked, but no first-class blocker edge exists.",
          ));
          continue;
        }
        if (issue.status === "in_review" && ageMs >= STALE_REVIEW_MS) {
          recommendations.push(buildRecommendation(
            "stale_review",
            issue,
            "Issue has been waiting in review for more than 24 hours without a recent meeting.",
          ));
          continue;
        }
        if (issue.status === "in_progress" && ageMs >= STALE_IN_PROGRESS_MS) {
          recommendations.push(buildRecommendation(
            "stale_in_progress",
            issue,
            "Issue has not moved for more than 72 hours while in progress.",
          ));
        }
      }

      const legacyMeetingsLast7Days = meetingRows.filter(
        (meeting) => now - meeting.createdAt.getTime() <= MEETING_RECENT_WINDOW_MS,
      ).length;
      const firstClassMeetingsLast7Days = firstClassMeetingRows.filter(
        (meeting) => now - meeting.createdAt.getTime() <= MEETING_RECENT_WINDOW_MS,
      ).length;
      const meetingsLast7Days = legacyMeetingsLast7Days + firstClassMeetingsLast7Days;
      if (openIssueRows.length > 0 && meetingsLast7Days === 0 && recommendations.length === 0) {
        recommendations.push(buildRecommendation(
          "no_recent_meetings",
          null,
          "Open work exists, but no structured agent meeting was recorded in the last 7 days.",
        ));
      }

      const pendingMeetings = meetingRows.filter((meeting) => meeting.status === "pending");
      const firstClassPendingMeetings = firstClassMeetingRows.filter((meeting) => meeting.status === "pending");
      const allMeetingCreatedAts = [...meetingRows, ...firstClassMeetingRows]
        .map((meeting) => meeting.createdAt)
        .sort((left, right) => right.getTime() - left.getTime());
      return {
        companyId,
        metrics: {
          totalMeetings: meetingRows.length + firstClassMeetingRows.length,
          pendingMeetings: pendingMeetings.length + firstClassPendingMeetings.length,
          resolvedMeetings:
            meetingRows.filter((meeting) => meeting.status !== "pending").length +
            firstClassMeetingRows.filter((meeting) => meeting.status !== "pending").length,
          stalePendingMeetings: [
            ...pendingMeetings.map((meeting) => meeting.createdAt),
            ...firstClassPendingMeetings.map((meeting) => meeting.createdAt),
          ].filter(
            (createdAt) => now - createdAt.getTime() >= STALE_PENDING_MEETING_MS,
          ).length,
          meetingsLast7Days,
          openMeetingGaps: recommendations.length,
          lastMeetingAt: allMeetingCreatedAts[0] ?? null,
        },
        policy: meetingWorkflowPolicy(),
        recommendations: recommendations.slice(0, 12),
      };
    },

    reconcileMeetingWorkflow: async (companyId: string): Promise<ReconcileMeetingWorkflowResult> => {
      const meetingsSvc = meetingService(db);
      const resolvedTerminal =
        await resolveTerminalMeetingWorkflowInteractions(companyId) +
        await meetingsSvc.resolveTerminalWorkflowMeetings(companyId);
      const legacyPendingWakeups = await reconcilePendingMeetingWorkflowWakeups(companyId);
      const firstClassPendingWakeups = await meetingsSvc.reconcilePendingWorkflowWakeups(companyId);
      const health = await issueThreadInteractionService(db).getMeetingWorkflowHealth(companyId);
      const meetings: ReconcileMeetingWorkflowResult["meetings"] = [
        ...legacyPendingWakeups.meetings,
        ...firstClassPendingWakeups.meetings,
      ];
      const coveredRecommendationKeys = new Set<string>();
      let skipped = 0;

      for (const recommendation of health.recommendations) {
        const recommendationKey = recommendation.issueId ?? recommendation.id;
        if (coveredRecommendationKeys.has(recommendationKey)) {
          skipped += 1;
          continue;
        }
        coveredRecommendationKeys.add(recommendationKey);

        const meeting = await createMeetingFromRecommendation(companyId, recommendation);
        if (!meeting) {
          skipped += 1;
          continue;
        }
        meetings.push({
          id: meeting.id,
          issueId: meeting.issueId,
          participantAgentIds: meeting.participantAgentIds,
          chairAgentId: recommendation.suggestedHeadAgentId,
        });
      }

      return {
        checked: health.recommendations.length,
        created: meetings.length - legacyPendingWakeups.meetings.length - firstClassPendingWakeups.meetings.length,
        requeuedPending: legacyPendingWakeups.meetings.length + firstClassPendingWakeups.meetings.length,
        cancelledUnrunnable: legacyPendingWakeups.cancelledUnrunnable + firstClassPendingWakeups.cancelledUnrunnable,
        resolvedTerminal,
        skipped,
        meetings,
      };
    },

    listForIssue: async (issueId: string) => {
      const rows = await db
        .select()
        .from(issueThreadInteractions)
        .where(eq(issueThreadInteractions.issueId, issueId))
        .orderBy(asc(issueThreadInteractions.createdAt), asc(issueThreadInteractions.id));

      return rows.map((row) => hydrateInteraction(row));
    },

    getById: async (interactionId: string) => {
      const row = await db
        .select()
        .from(issueThreadInteractions)
        .where(eq(issueThreadInteractions.id, interactionId))
        .then((rows) => rows[0] ?? null);

      return row ? hydrateInteraction(row) : null;
    },

    create: async (
      issue: { id: string; companyId: string },
      input: CreateIssueThreadInteraction,
      actor: InteractionActor,
    ) => {
      const data = createIssueThreadInteractionSchema.parse(input);

      if (data.idempotencyKey) {
        const existing = await getIdempotentInteraction({
          issueId: issue.id,
          companyId: issue.companyId,
          idempotencyKey: data.idempotencyKey,
        });
        if (existing) {
          if (!isEquivalentCreateRequest(existing, data, actor)) {
            throw conflict("Interaction idempotency key already exists for a different request", {
              idempotencyKey: data.idempotencyKey,
            });
          }
          return hydrateInteraction(existing);
        }
      }

      if (data.sourceCommentId) {
        const sourceComment = await db
          .select({
            companyId: issueComments.companyId,
            issueId: issueComments.issueId,
          })
          .from(issueComments)
          .where(eq(issueComments.id, data.sourceCommentId))
          .then((rows) => rows[0] ?? null);
        if (!sourceComment || sourceComment.companyId !== issue.companyId || sourceComment.issueId !== issue.id) {
          throw unprocessable("sourceCommentId must belong to the same issue and company");
        }
      }

      if (data.sourceRunId) {
        const sourceRun = await db
          .select({
            companyId: heartbeatRuns.companyId,
          })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, data.sourceRunId))
          .then((rows) => rows[0] ?? null);
        if (!sourceRun || sourceRun.companyId !== issue.companyId) {
          throw unprocessable("sourceRunId must belong to the same company");
        }
      }

      if (data.kind === "request_confirmation") {
        await assertRequestConfirmationTargetIsCurrent(db, {
          companyId: issue.companyId,
          issueId: issue.id,
          target: data.payload.target ?? null,
        });
      }

      let created: IssueThreadInteractionRow;
      try {
        [created] = await db
          .insert(issueThreadInteractions)
          .values({
            companyId: issue.companyId,
            issueId: issue.id,
            kind: data.kind,
            status: "pending",
            continuationPolicy: data.continuationPolicy,
            idempotencyKey: data.idempotencyKey ?? null,
            sourceCommentId: data.sourceCommentId ?? null,
            sourceRunId: data.sourceRunId ?? null,
            title: data.title ?? null,
            summary: data.summary ?? null,
            createdByAgentId: actor.agentId ?? null,
            createdByUserId: actor.userId ?? null,
            payload: data.payload,
          })
          .returning();
      } catch (error) {
        if (!data.idempotencyKey || !isIssueThreadInteractionIdempotencyConflict(error)) {
          throw error;
        }
        const existing = await getIdempotentInteraction({
          issueId: issue.id,
          companyId: issue.companyId,
          idempotencyKey: data.idempotencyKey,
        });
        if (!existing) throw error;
        if (!isEquivalentCreateRequest(existing, data, actor)) {
          throw conflict("Interaction idempotency key already exists for a different request", {
            idempotencyKey: data.idempotencyKey,
          });
        }
        return hydrateInteraction(existing);
      }

      await touchIssue(db, issue.id);
      return hydrateInteraction(created);
    },

    acceptInteraction: async (
      issue: { id: string; companyId: string; projectId: string | null; goalId: string | null },
      interactionId: string,
      input: AcceptIssueThreadInteraction,
      actor: InteractionActor,
    ): Promise<ResolvedInteractionResult> => {
      const data = acceptIssueThreadInteractionSchema.parse(input);
      const current = await getPendingInteractionForResolution({ issue, interactionId });
      switch (current.kind) {
        case "suggest_tasks":
          return issueThreadInteractionService(db).acceptSuggestedTasks(issue, interactionId, data, actor);
        case "request_confirmation": {
          const accepted = await acceptRequestConfirmation({
            issue,
            current,
            actor,
          });
          return {
            interaction: accepted.interaction,
            continuationIssue: accepted.continuationIssue,
            createdIssues: [],
          };
        }
        default:
          throw unprocessable(`Interactions of kind ${current.kind} cannot be accepted`);
      }
    },

    acceptSuggestedTasks: async (
      issue: { id: string; companyId: string; projectId: string | null; goalId: string | null },
      interactionId: string,
      input: AcceptIssueThreadInteraction,
      actor: InteractionActor,
    ) => {
      const current = await db
        .select()
        .from(issueThreadInteractions)
        .where(eq(issueThreadInteractions.id, interactionId))
        .then((rows) => rows[0] ?? null);

      if (!current) throw notFound("Interaction not found");
      if (current.companyId !== issue.companyId || current.issueId !== issue.id) {
        throw notFound("Interaction not found");
      }
      if (current.kind !== "suggest_tasks") {
        throw unprocessable("Only suggest_tasks interactions can be accepted");
      }
      if (current.status !== "pending") {
        throw conflict("Interaction has already been resolved");
      }

      const interaction = hydrateInteraction(current) as SuggestTasksInteraction;
      const { selectedTasks, skippedClientKeys } = resolveSelectedSuggestedTasks({
        interaction,
        selectedClientKeys: input.selectedClientKeys,
      });
      const orderedTasks = buildTaskCreationOrder(selectedTasks);
      const explicitParentIds = [...new Set([
        issue.id,
        ...(interaction.payload.defaultParentId ? [interaction.payload.defaultParentId] : []),
        ...selectedTasks
          .map((task) => task.parentId ?? null)
          .filter((value): value is string => Boolean(value)),
      ])];

      const parentRows = explicitParentIds.length === 0
        ? []
        : await db
          .select({
            id: issues.id,
            identifier: issues.identifier,
            companyId: issues.companyId,
          })
          .from(issues)
          .where(and(eq(issues.companyId, issue.companyId), inArray(issues.id, explicitParentIds)));
      if (parentRows.length !== explicitParentIds.length) {
        throw unprocessable("Suggested tasks reference parent issues outside this company or issue tree");
      }

      const parentById = new Map(parentRows.map((row) => [row.id, row] as const));
      const createdByClientKey = new Map<string, SuggestTasksResultCreatedTask>();
      const createdWakeTargets: IssueWakeTarget[] = [];

      await db.transaction(async (tx) => {
        const resolvedAt = new Date();
        const [claimed] = await tx
          .update(issueThreadInteractions)
          .set({
            status: "accepted",
            resolvedByAgentId: actor.agentId ?? null,
            resolvedByUserId: actor.userId ?? null,
            resolvedAt,
            updatedAt: resolvedAt,
          })
          .where(and(
            eq(issueThreadInteractions.id, interactionId),
            eq(issueThreadInteractions.status, "pending"),
          ))
          .returning();

        if (!claimed) {
          throw conflict("Interaction has already been resolved");
        }

        for (const task of orderedTasks) {
          const parentIssueId = task.parentClientKey
            ? createdByClientKey.get(task.parentClientKey)?.issueId ?? null
            : task.parentId ?? interaction.payload.defaultParentId ?? issue.id;
          if (!parentIssueId) {
            throw unprocessable(`Unable to resolve parent for suggested task ${task.clientKey}`);
          }

          const { issue: createdIssue } = await issueService(tx as unknown as Db).createChild(parentIssueId, {
            title: task.title,
            description: task.description ?? null,
            status: "todo",
            workMode: task.workMode ?? "standard",
            priority: task.priority ?? "medium",
            assigneeAgentId: task.assigneeAgentId ?? null,
            assigneeUserId: task.assigneeUserId ?? null,
            projectId: task.projectId ?? issue.projectId,
            goalId: task.goalId ?? issue.goalId,
            billingCode: task.billingCode ?? null,
            createdByAgentId: actor.agentId ?? null,
            createdByUserId: actor.userId ?? null,
            actorAgentId: actor.agentId ?? null,
            actorUserId: actor.userId ?? null,
          } as Parameters<ReturnType<typeof issueService>["createChild"]>[1]);

          const parentIdentifier = createdByClientKey.get(task.parentClientKey ?? "")?.identifier
            ?? parentById.get(parentIssueId)?.identifier
            ?? null;
          createdByClientKey.set(task.clientKey, {
            clientKey: task.clientKey,
            issueId: createdIssue.id,
            identifier: createdIssue.identifier ?? null,
            title: createdIssue.title,
            parentIssueId,
            parentIdentifier,
          });
          createdWakeTargets.push({
            id: createdIssue.id,
            assigneeAgentId: createdIssue.assigneeAgentId ?? null,
            status: createdIssue.status,
          });
        }

        const [updated] = await tx
          .update(issueThreadInteractions)
          .set({
            result: {
              version: 1,
              createdTasks: [...createdByClientKey.values()],
              ...(skippedClientKeys.length > 0 ? { skippedClientKeys } : {}),
            },
            updatedAt: new Date(),
          })
          .where(eq(issueThreadInteractions.id, interactionId))
          .returning();

        await touchIssue(tx, issue.id);
        current.status = updated.status;
        current.result = updated.result;
        current.resolvedByAgentId = updated.resolvedByAgentId;
        current.resolvedByUserId = updated.resolvedByUserId;
        current.resolvedAt = updated.resolvedAt;
        current.updatedAt = updated.updatedAt;
      });

      return {
        interaction: hydrateInteraction(current),
        createdIssues: createdWakeTargets,
      };
    },

    rejectInteraction: async (
      issue: { id: string; companyId: string },
      interactionId: string,
      input: RejectIssueThreadInteraction,
      actor: InteractionActor,
    ) => {
      const data = rejectIssueThreadInteractionSchema.parse(input);
      const current = await getPendingInteractionForResolution({ issue, interactionId });
      switch (current.kind) {
        case "suggest_tasks":
          return issueThreadInteractionService(db).rejectSuggestedTasks(issue, interactionId, data, actor, current);
        case "request_confirmation":
          return rejectRequestConfirmation({
            issue,
            current,
            input: data,
            actor,
          });
        default:
          throw unprocessable(`Interactions of kind ${current.kind} cannot be rejected`);
      }
    },

    rejectSuggestedTasks: async (
      issue: { id: string; companyId: string },
      interactionId: string,
      input: RejectIssueThreadInteraction,
      actor: InteractionActor,
      current: IssueThreadInteractionRow,
    ) => {
      if (current.companyId !== issue.companyId || current.issueId !== issue.id) {
        throw notFound("Interaction not found");
      }
      if (current.kind !== "suggest_tasks") {
        throw unprocessable("Only suggest_tasks interactions can be rejected");
      }
      if (current.status !== "pending") {
        throw conflict("Interaction has already been resolved");
      }

      const [updated] = await db
        .update(issueThreadInteractions)
        .set({
          status: "rejected",
          result: {
            version: 1,
            rejectionReason: input.reason?.trim() || null,
          },
          resolvedByAgentId: actor.agentId ?? null,
          resolvedByUserId: actor.userId ?? null,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(issueThreadInteractions.id, interactionId),
          eq(issueThreadInteractions.status, "pending"),
        ))
        .returning();

      if (!updated) {
        throw conflict("Interaction has already been resolved");
      }

      await touchIssue(db, issue.id);
      return hydrateInteraction(updated);
    },

    expireRequestConfirmationsSupersededByComment: async (
      issue: { id: string; companyId: string },
      comment: { id: string; authorUserId?: string | null },
      actor: InteractionActor,
    ) => {
      if (!comment.authorUserId) return [];

      const rows = await db
        .select()
        .from(issueThreadInteractions)
        .where(and(
          eq(issueThreadInteractions.companyId, issue.companyId),
          eq(issueThreadInteractions.issueId, issue.id),
          eq(issueThreadInteractions.kind, "request_confirmation"),
          eq(issueThreadInteractions.status, "pending"),
        ));

      const superseded = rows.filter((row) => {
        const interaction = hydrateInteraction(row) as RequestConfirmationInteraction;
        return interaction.payload.supersedeOnUserComment === true;
      });

      if (superseded.length === 0) return [];

      const now = new Date();
      const expired: IssueThreadInteraction[] = [];
      for (const row of superseded) {
        const [updated] = await db
          .update(issueThreadInteractions)
          .set({
            status: "expired",
            result: {
              version: 1,
              outcome: "superseded_by_comment",
              commentId: comment.id,
            },
            resolvedByAgentId: actor.agentId ?? null,
            resolvedByUserId: actor.userId ?? null,
            resolvedAt: now,
            updatedAt: now,
          })
          .where(and(
            eq(issueThreadInteractions.id, row.id),
            eq(issueThreadInteractions.status, "pending"),
          ))
          .returning();
        if (updated) expired.push(hydrateInteraction(updated));
      }

      if (expired.length > 0) {
        await touchIssue(db, issue.id);
      }
      return expired;
    },

    expireStaleRequestConfirmationsForIssueDocument: async (
      issue: { id: string; companyId: string },
      document: { id: string; key: string; latestRevisionId?: string | null; latestRevisionNumber?: number | null } | null,
      actor: InteractionActor,
    ) => {
      const rows = await db
        .select()
        .from(issueThreadInteractions)
        .where(and(
          eq(issueThreadInteractions.companyId, issue.companyId),
          eq(issueThreadInteractions.issueId, issue.id),
          eq(issueThreadInteractions.kind, "request_confirmation"),
          eq(issueThreadInteractions.status, "pending"),
        ));

      const staleRows = rows.filter((row) => {
        const interaction = hydrateInteraction(row) as RequestConfirmationInteraction;
        const target = interaction.payload.target;
        if (!target || target.type !== "issue_document") return false;
        const targetIssueId = target.issueId ?? issue.id;
        if (targetIssueId !== issue.id) return false;
        if (document && target.documentId && target.documentId !== document.id) return false;
        if (document && target.key !== document.key) return false;
        if (!document) return true;
        return (
          target.revisionId !== document.latestRevisionId
          || (target.revisionNumber != null && target.revisionNumber !== document.latestRevisionNumber)
        );
      });

      if (staleRows.length === 0) return [];

      const now = new Date();
      const expired: IssueThreadInteraction[] = [];
      for (const row of staleRows) {
        const interaction = hydrateInteraction(row) as RequestConfirmationInteraction;
        const target = interaction.payload.target ?? null;
        const currentTarget = buildIssueDocumentTargetFromDocument({
          issueId: issue.id,
          document,
        });
        const [updated] = await db
          .update(issueThreadInteractions)
          .set({
            status: "expired",
            payload: currentTarget
              ? {
                  ...interaction.payload,
                  target: currentTarget,
                }
              : interaction.payload,
            result: {
              version: 1,
              outcome: "stale_target",
              staleTarget: target,
            },
            resolvedByAgentId: actor.agentId ?? null,
            resolvedByUserId: actor.userId ?? null,
            resolvedAt: now,
            updatedAt: now,
          })
          .where(and(
            eq(issueThreadInteractions.id, row.id),
            eq(issueThreadInteractions.status, "pending"),
          ))
          .returning();
        if (updated) expired.push(hydrateInteraction(updated));
      }

      if (expired.length > 0) {
        await touchIssue(db, issue.id);
      }
      return expired;
    },

    answerQuestions: async (
      issue: { id: string; companyId: string },
      interactionId: string,
      input: RespondIssueThreadInteraction,
      actor: InteractionActor,
    ) => {
      const current = await db
        .select()
        .from(issueThreadInteractions)
        .where(eq(issueThreadInteractions.id, interactionId))
        .then((rows) => rows[0] ?? null);

      if (!current) throw notFound("Interaction not found");
      if (current.companyId !== issue.companyId || current.issueId !== issue.id) {
        throw notFound("Interaction not found");
      }
      if (current.kind !== "ask_user_questions" && current.kind !== "agent_meeting") {
        throw unprocessable("Only ask_user_questions and agent_meeting interactions can be answered");
      }
      if (current.status !== "pending") {
        throw conflict("Interaction has already been resolved");
      }

      if (current.kind === "agent_meeting") {
        if (!input.meetingResult) {
          throw unprocessable("meetingResult is required for agent_meeting interactions");
        }
        const interaction = hydrateInteraction(current) as AgentMeetingInteraction;
        const result = agentMeetingResultSchema.parse(input.meetingResult);
        validateBusinessMeetingResult({
          result,
          expectedOutputs: interaction.payload.expectedOutputs,
          participantAgentIds: interaction.payload.participantAgentIds,
        });
        await validateMeetingResultIssueIdsForCompany(db, issue.companyId, result);
        const [updated] = await db
          .update(issueThreadInteractions)
          .set({
            status: "answered",
            result,
            resolvedByAgentId: actor.agentId ?? null,
            resolvedByUserId: actor.userId ?? null,
            resolvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(
            eq(issueThreadInteractions.id, interactionId),
            eq(issueThreadInteractions.status, "pending"),
          ))
          .returning();

        if (!updated) {
          throw conflict("Interaction has already been resolved");
        }

        await touchIssue(db, issue.id);
        return hydrateInteraction(updated);
      }

      const interaction = hydrateInteraction(current) as AskUserQuestionsInteraction;
      const normalizedAnswers = normalizeQuestionAnswers({
        questions: interaction.payload.questions,
        answers: input.answers,
      });

      const [updated] = await db
        .update(issueThreadInteractions)
        .set({
          status: "answered",
          result: {
            version: 1,
            answers: normalizedAnswers,
            summaryMarkdown: input.summaryMarkdown ?? null,
          },
          resolvedByAgentId: actor.agentId ?? null,
          resolvedByUserId: actor.userId ?? null,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(issueThreadInteractions.id, interactionId),
          eq(issueThreadInteractions.status, "pending"),
        ))
        .returning();

      if (!updated) {
        throw conflict("Interaction has already been resolved");
      }

      await touchIssue(db, issue.id);
      return hydrateInteraction(updated);
    },

    cancelQuestions: async (
      issue: { id: string; companyId: string },
      interactionId: string,
      input: CancelIssueThreadInteraction,
      actor: InteractionActor,
    ) => {
      const data = cancelIssueThreadInteractionSchema.parse(input);
      const current = await db
        .select()
        .from(issueThreadInteractions)
        .where(eq(issueThreadInteractions.id, interactionId))
        .then((rows) => rows[0] ?? null);

      if (!current) throw notFound("Interaction not found");
      if (current.companyId !== issue.companyId || current.issueId !== issue.id) {
        throw notFound("Interaction not found");
      }
      if (current.kind !== "ask_user_questions") {
        throw unprocessable("Only ask_user_questions interactions can be cancelled");
      }
      if (current.status !== "pending") {
        throw conflict("Interaction has already been resolved");
      }

      const reason = data.reason?.trim() || null;
      const [updated] = await db
        .update(issueThreadInteractions)
        .set({
          status: "cancelled",
          result: {
            version: 1,
            answers: [],
            cancelled: true,
            cancellationReason: reason,
            summaryMarkdown: null,
          },
          resolvedByAgentId: actor.agentId ?? null,
          resolvedByUserId: actor.userId ?? null,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(issueThreadInteractions.id, interactionId),
          eq(issueThreadInteractions.status, "pending"),
        ))
        .returning();

      if (!updated) {
        throw conflict("Interaction has already been resolved");
      }

      await touchIssue(db, issue.id);
      return hydrateInteraction(updated);
    },
  };
}
