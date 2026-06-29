import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  approvals,
  campaignPhases,
  campaigns,
  costEvents,
  documents,
  heartbeatRuns,
  issueApprovals,
  issueComments,
  issueDocuments,
  issueRelations,
  issueThreadInteractions,
  issues,
  meetingIssueLinks,
  meetingParticipants,
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
  parseStoredMeetingResult,
  readIssueIdsFromMeetingResult,
  setMeetingOutcomeIssueId,
  type MeetingOutcomeLinkType,
  validateBusinessMeetingResult,
} from "./meeting-outcome-utils.js";
import { meetingService } from "./meetings.js";
import {
  findFictionDirector,
  isFictionStoryAlignmentIssue,
  needsFictionVisualStoryParticipant,
} from "./fiction-story-alignment.js";

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
  offset?: number;
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
const OPERATING_SIGNAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WORK_PRESSURE_RUNS = 3;
const FICTION_RESEARCH_ROLE_RE = /\b(?:research|researcher|research-agent|classification)\b/i;
const FICTION_DRAFT_ROLE_RE = /\b(?:draft|writer|author|prose)\b/i;
const FICTION_CHARACTER_ROLE_RE = /\bcharacter\b/i;
const FICTION_PLOT_ROLE_RE = /\b(?:plot|arc|twist|sequence)\b/i;
const FICTION_WORLDBUILDING_ROLE_RE = /\b(?:story[-_\s]*architect|world\s*building|worldbuilding|world[-_\s]*vault|lore|canon|setting|location|faction|country|empire|realm|geopolitic|magic[-_\s]*system)\b/i;
const FICTION_VISUAL_STORY_ROLE_RE = /\b(?:storybook|graphic|visual|illustrat|cover|asset)\b/i;
const FICTION_CONTINUITY_COORDINATOR_ROLE_RE = /\b(?:continuity|coordinator|canon|evaluation|gate)\b/i;

async function listIssueIdsWithPendingNextActionPath(db: Db, companyId: string, issueIds: string[]) {
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
  active_work_pressure: BUSINESS_OPERATING_MEETING_OUTPUTS,
  failed_run_review: BUSINESS_OPERATING_MEETING_OUTPUTS,
  campaign_phase_review: BUSINESS_OPERATING_MEETING_OUTPUTS,
  productivity_review: BUSINESS_OPERATING_MEETING_OUTPUTS,
  fiction_story_alignment: BUSINESS_OPERATING_MEETING_OUTPUTS,
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
  active_work_pressure: [
    "What changed across active queued/running work since the last operating review?",
    "What is blocked, overloaded, duplicated, or waiting on scheduler/agent capacity?",
    "Who is underperforming or stuck based on active run pressure, handoff clarity, output quality, and churn?",
    "What decision is needed now to protect goal, KPI, budget, or delivery path?",
    "Name the exact issue to create, reassign, block, unblock, close, or move back to review.",
  ],
  failed_run_review: [
    "What changed in the failed or stale runs, and what user-visible work is affected?",
    "What is blocked by runtime errors, adapter failures, stale runs, or missing output?",
    "Who is underperforming or stuck based on repeated failure, missing comments, unclear next action, or high churn?",
    "What decision is needed: retry, reassign, pause, escalate, approve spend, or create recovery work?",
    "Name the exact issue to create, reassign, block, unblock, close, or move back to review.",
  ],
  campaign_phase_review: [
    "What changed in active campaign phases and linked execution issues?",
    "What is blocked in planning, review, approval, execution, or result documentation?",
    "Who is underperforming or stuck across lead, assignee, reviewer, and contributors?",
    "What decision is needed to approve, revise, execute, pause, or complete the phase?",
    "Name the exact issue, phase, document, or approval that must change next.",
  ],
  productivity_review: [
    "What changed in productivity review evidence: no-comment streaks, long-active work, churn, cost, and next actions?",
    "What is blocked by repeated planning, missing output, repeated failure, unclear ownership, or absent comments?",
    "Who is underperforming or stuck, and what concrete coaching, reassignment, or workflow correction is needed?",
    "What decision is needed: continue, stop, reassign, split work, create follow-up, or change process?",
    "Name the exact issue to create, reassign, block, unblock, close, or move back to review.",
  ],
  fiction_story_alignment: [
    "Research/classification: what facts, references, constraints, and labels should the story team use?",
    "Character: what backstories, history, family, friends, enemies, lovers, motivations, and contradictions need alignment?",
    "Plot and series sequence: what setup, reversals, causality, stakes, pacing, twist pipeline, book/season order, and long-range continuity need to change?",
    "World Vault and lore: what locations, countries, alliances, factions, empires, realms, worlds, magic/power systems, history, laws, and constraints need updating?",
    "Format and art density: is this a compact picture book, graphic/visual story, or long-form novel/storybook where images should be sparse and reserved for critical events?",
    "Evaluation gates: what canon, continuity, escalation, twist, location, faction, and character checks must pass before the next draft continues?",
    "Draft: what concrete chapter/scene direction should the drafting agent write next, and what must not change?",
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
  active_work_pressure: "Business review focus: minimal, precise operating review of what changed, what is blocked, who is underperforming or stuck, what decision is needed, and the exact issue operation to take.",
  failed_run_review: "Business review focus: minimal, precise operating review of failed/stale run impact, blocked work, agent performance, retry/reassignment decisions, cost/churn, and exact recovery issue operations.",
  campaign_phase_review: "Business review focus: minimal, precise operating review of campaign phase progress, plan/review/execution blockers, responsible agents, required decisions, and exact issue/document/approval operations.",
  productivity_review: "Business review focus: minimal, precise operating review of productivity evidence, churn, cost, missing comments, agent performance, required decisions, and exact follow-up issue operations.",
  fiction_story_alignment: "Story alignment focus: research classification, character backstories and relationships, plot causality, series sequence, World Vault lore, locations, countries, alliances, factions, empires, realms, multiple worlds, magic/power systems, twist continuity, evaluation gates, format/art density including sparse critical-event images for long-form storybooks, draft direction, contradictions, and exact issue/document updates needed before writing continues.",
  no_recent_meetings: "Business review focus: company goals, targets, KPI trend, finance, business requirements, employee performance, cross-team problems, idea sharing, workflow health, memory correctness, and operating process improvements.",
};

const MEETING_TRIGGER_TITLE_PREFIX: Record<MeetingWorkflowTrigger, string> = {
  blocked_without_edge: "Blocked work",
  stale_review: "Review waiting",
  stale_in_progress: "Execution check-in",
  active_work_pressure: "Operating pressure",
  failed_run_review: "Run failure review",
  campaign_phase_review: "Campaign phase review",
  productivity_review: "Productivity review",
  fiction_story_alignment: "Story alignment",
  no_recent_meetings: "Operating review",
};

function compactMeetingTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117).trimEnd()}...`;
}

function meetingTitleForRecommendation(recommendation: MeetingWorkflowRecommendation) {
  const prefix = MEETING_TRIGGER_TITLE_PREFIX[recommendation.trigger];
  if (recommendation.trigger === "no_recent_meetings") {
    return `${prefix}: company work health`;
  }
  if (!recommendation.issueId) {
    if (recommendation.trigger === "active_work_pressure") return `${prefix}: queued and running work`;
    if (recommendation.trigger === "failed_run_review") return `${prefix}: failed and stale runs`;
    if (recommendation.trigger === "campaign_phase_review") return `${prefix}: active campaign phases`;
    if (recommendation.trigger === "productivity_review") return `${prefix}: stuck work evidence`;
  }
  const topic = [
    recommendation.issueIdentifier,
    recommendation.issueTitle,
  ].filter((value): value is string => Boolean(value?.trim())).join(" - ");
  return compactMeetingTitle(`${prefix}: ${topic || "unlabeled issue"}`);
}

function meetingWorkflowPolicy(): MeetingWorkflowHealth["policy"] {
  return {
    purpose: "Meetings are structured operating reviews used when company work needs recorded goals, targets, KPIs, finance context, business requirements, agent employee performance review, problems, optimizations, workflow/process changes, memory corrections, idea sharing, right-track checks, decisions, tasks, blockers, questions, or plan updates.",
    chairRule: "The chair is the nearest operational owner: a specialist's manager, or the department/domain head themselves when the assignee reports directly to the CEO. The CEO is reserved for company-wide cadence, priority-critical escalations, or true multi-head coordination.",
    triggerRules: [
      {
        id: "blocked_without_edge",
        label: "Blocker hygiene",
        when: "An issue says blocked/stuck/waiting but no first-class blocker edge exists.",
        chair: "Nearest department/domain owner; CEO only for critical or multi-head escalation.",
        expectedOutputs: MEETING_TRIGGER_OUTPUTS.blocked_without_edge,
      },
      {
        id: "stale_review",
        label: "Review waiting",
        when: "An issue sits in review for more than 24 hours.",
        chair: "Review owner or nearest department/domain owner.",
        expectedOutputs: MEETING_TRIGGER_OUTPUTS.stale_review,
      },
      {
        id: "stale_in_progress",
        label: "Execution ambiguity",
        when: "An in-progress issue has not moved for more than 72 hours.",
        chair: "Nearest department/domain owner.",
        expectedOutputs: MEETING_TRIGGER_OUTPUTS.stale_in_progress,
      },
      {
        id: "active_work_pressure",
        label: "Active work pressure",
        when: "Queued/running/scheduled work accumulates enough to require a short operating review.",
        chair: "CEO with direct department/domain heads, or the nearest operating head when scoped.",
        expectedOutputs: MEETING_TRIGGER_OUTPUTS.active_work_pressure,
      },
      {
        id: "failed_run_review",
        label: "Failed run review",
        when: "Recent failed or timed-out runs indicate runtime, quality, ownership, or recovery risk.",
        chair: "CEO with direct department/domain heads, or the nearest operating head when scoped.",
        expectedOutputs: MEETING_TRIGGER_OUTPUTS.failed_run_review,
      },
      {
        id: "campaign_phase_review",
        label: "Campaign phase review",
        when: "Campaign phases are waiting in review, revision, approval, or execution states.",
        chair: "Campaign lead, CEO, or relevant department/domain heads.",
        expectedOutputs: MEETING_TRIGGER_OUTPUTS.campaign_phase_review,
      },
      {
        id: "productivity_review",
        label: "Productivity review",
        when: "Open productivity review issues show no-comment streaks, long-active work, churn, cost, or weak next actions.",
        chair: "Responsible manager or direct operating head.",
        expectedOutputs: MEETING_TRIGGER_OUTPUTS.productivity_review,
      },
      {
        id: "fiction_story_alignment",
        label: "Fiction story alignment",
        when: "Fiction setup or draft work touches research, characters, plot, series sequence, World Vault lore, locations, factions, countries, alliances, empires, worlds, magic systems, or evaluation gates and needs coordinated story decisions before writing continues.",
        chair: "Fiction Director with research, draft, visual-story, character, plot/sequence, World Vault/lore, architecture, and continuity/coordinator participants when relevant.",
        expectedOutputs: MEETING_TRIGGER_OUTPUTS.fiction_story_alignment,
      },
      {
        id: "no_recent_meetings",
        label: "No meeting activity",
        when: "Open work exists but no structured meeting was recorded in the last 7 days.",
        chair: "CEO with direct department/domain heads only.",
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
  if (trigger === "blocked_without_edge" || trigger === "failed_run_review") return "urgent";
  if (
    trigger === "stale_review" ||
    trigger === "stale_in_progress" ||
    trigger === "active_work_pressure" ||
    trigger === "campaign_phase_review" ||
    trigger === "productivity_review"
  ) return "warning";
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

    return meetingService(db).createFromRecommendation(companyId, recommendation, {
      title: meetingTitleForRecommendation(recommendation),
      agenda: MEETING_TRIGGER_AGENDAS[recommendation.trigger],
      expectedOutputs: recommendation.expectedOutputs,
      contextMarkdown: [
        recommendation.issueId ? `Issue: ${recommendation.issueIdentifier ?? recommendation.issueId}` : "Scope: company",
        recommendation.issueTitle ? `Title: ${recommendation.issueTitle}` : null,
        recommendation.issueStatus ? `Status: ${recommendation.issueStatus}` : null,
        recommendation.suggestedHeadName ? `Suggested chair: ${recommendation.suggestedHeadName}` : null,
        `Signal: ${recommendation.reason}`,
        MEETING_TRIGGER_FOCUS[recommendation.trigger],
        "Record the outcome as a meeting result, including businessReview, agentPerformanceReviews, right-track checks, ideas, workflow corrections, and memory corrections when relevant.",
        "Convert action items/blockers into linked issues; agentPerformanceReviews can link follow-up issues for coaching or reassignment; memoryCorrections should name karpathy-memory, para-memory, or other and identify the file/path when known.",
      ].filter(Boolean).join("\n"),
    });
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
        sql`${agents.status} not in ('paused', 'pending_approval', 'terminated')`,
      ));
    const runnableIds = new Set(rows.map((row) => row.id));
    return uniqueIds.filter((agentId) => runnableIds.has(agentId));
  }

  async function migrateLegacyMeetingWorkflowInteractions(companyId: string): Promise<{
    meetings: ReconcileMeetingWorkflowResult["meetings"];
    cancelledUnrunnable: number;
    migrated: number;
    activeLegacyIssueIds: Set<string>;
  }> {
    const rows = await db
      .select({
        interaction: issueThreadInteractions,
        projectId: issues.projectId,
        goalId: issues.goalId,
      })
      .from(issueThreadInteractions)
      .innerJoin(issues, eq(issues.id, issueThreadInteractions.issueId))
      .where(and(
        eq(issueThreadInteractions.companyId, companyId),
        eq(issueThreadInteractions.kind, "agent_meeting"),
        sql`${issueThreadInteractions.status} <> 'cancelled'`,
      ))
      .orderBy(asc(issueThreadInteractions.createdAt), asc(issueThreadInteractions.id))
      .limit(200);

    const wakeTargets: ReconcileMeetingWorkflowResult["meetings"] = [];
    const activeLegacyIssueIds = new Set<string>();
    let cancelledUnrunnable = 0;
    let migrated = 0;

    for (const row of rows) {
      const interaction = hydrateInteraction(row.interaction);
      if (interaction.kind !== "agent_meeting") continue;
      const now = new Date();
      const idempotencyKey = row.interaction.idempotencyKey ?? `legacy-issue-interaction:${row.interaction.id}`;
      const participantAgentIds = [...new Set(interaction.payload.participantAgentIds)];
      const runnableParticipantIds = interaction.status === "pending"
        ? await listRunnableMeetingParticipantIds(companyId, participantAgentIds)
        : participantAgentIds;
      const hasActiveLegacyRun = interaction.status === "pending"
        ? await db
            .select({ id: heartbeatRuns.id })
            .from(heartbeatRuns)
            .where(and(
              eq(heartbeatRuns.companyId, companyId),
              inArray(heartbeatRuns.status, ["queued", "running"]),
              sql`${heartbeatRuns.contextSnapshot}->>'interactionId' = ${row.interaction.id}`,
            ))
            .limit(1)
            .then((activeRows) => activeRows.length > 0)
        : false;
      if (hasActiveLegacyRun) {
        activeLegacyIssueIds.add(interaction.issueId);
        continue;
      }
      if (interaction.status === "pending" && runnableParticipantIds.length === 0) {
        const [cancelled] = await db
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
        if (cancelled) cancelledUnrunnable += 1;
        continue;
      }

      const existingMeeting = await db
        .select({ id: meetings.id, status: meetings.status, chairAgentId: meetings.chairAgentId, sourceIssueId: meetings.sourceIssueId })
        .from(meetings)
        .where(and(eq(meetings.companyId, companyId), eq(meetings.idempotencyKey, idempotencyKey)))
        .then((existingRows) => existingRows[0] ?? null);

      const chairAgentId = runnableParticipantIds.includes(participantAgentIds[0] ?? "")
        ? participantAgentIds[0]!
        : runnableParticipantIds[0] ?? null;
      const migratedMeeting = existingMeeting ?? await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const [meeting] = await txDb
          .insert(meetings)
          .values({
            companyId,
            projectId: row.projectId ?? null,
            goalId: row.goalId ?? null,
            sourceIssueId: interaction.issueId,
            meetingType: "operating_review",
            title: interaction.title ?? null,
            purpose: interaction.payload.purpose,
            status: interaction.status,
            chairAgentId,
            idempotencyKey,
            agenda: interaction.payload.agenda,
            expectedOutputs: interaction.payload.expectedOutputs,
            contextMarkdown: interaction.payload.contextMarkdown ?? null,
            result: interaction.result ?? null,
            createdByAgentId: row.interaction.createdByAgentId ?? null,
            createdByUserId: row.interaction.createdByUserId ?? null,
            resolvedByAgentId: row.interaction.resolvedByAgentId ?? null,
            resolvedByUserId: row.interaction.resolvedByUserId ?? null,
            resolvedAt: row.interaction.resolvedAt ?? null,
            createdAt: row.interaction.createdAt,
            updatedAt: interaction.status === "pending" ? now : row.interaction.updatedAt,
          })
          .returning();
        if (runnableParticipantIds.length > 0) {
          await txDb
            .insert(meetingParticipants)
            .values(runnableParticipantIds.map((agentId) => ({
              companyId,
              meetingId: meeting.id,
              agentId,
              role: agentId === chairAgentId ? "chair" : "participant",
              status: interaction.status === "pending" ? "pending" : interaction.status,
              createdAt: row.interaction.createdAt,
              updatedAt: interaction.status === "pending" ? now : row.interaction.updatedAt,
            })))
            .onConflictDoNothing();
        }
        await txDb
          .insert(meetingIssueLinks)
          .values({
            companyId,
            meetingId: meeting.id,
            issueId: interaction.issueId,
            linkKind: "source",
          })
          .onConflictDoNothing();
        return meeting;
      });

      const [cancelledLegacy] = await db
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
          sql`${issueThreadInteractions.status} <> 'cancelled'`,
        ))
        .returning();
      if (!cancelledLegacy) continue;
      migrated += existingMeeting ? 0 : 1;

      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "meeting_workflow",
        action: "issue.thread_interaction_meeting_migrated",
        entityType: "meeting",
        entityId: migratedMeeting.id,
        details: {
          legacyInteractionId: row.interaction.id,
          issueId: interaction.issueId,
          idempotencyKey,
        },
      });

      if (interaction.status === "pending") {
        wakeTargets.push({
          id: migratedMeeting.id,
          issueId: interaction.issueId,
          participantAgentIds: runnableParticipantIds,
          chairAgentId,
        });
      }
    }

    return { meetings: wakeTargets, cancelledUnrunnable, migrated, activeLegacyIssueIds };
  }

  return {
    listMeetingsForCompany: async (
      companyId: string,
      options: ListWorkMeetingsOptions = {},
    ): Promise<WorkMeetingSummary[]> => {
      return meetingService(db).listForCompany(companyId, options);
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
      const migratedIdempotencyKey = current.idempotencyKey ?? `legacy-issue-interaction:${current.id}`;
      const [migratedMeeting] = await db
        .select({ id: meetings.id })
        .from(meetings)
        .where(and(eq(meetings.companyId, companyId), eq(meetings.idempotencyKey, migratedIdempotencyKey)))
        .limit(1);
      if (migratedMeeting) {
        await meetingService(db).linkOutcomeIssue(migratedMeeting.id, input, actor);
        return { threadKind: "meeting" as const, meetingId: migratedMeeting.id, issueId: input.issueId };
      }

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
      const meetingRows: IssueThreadInteractionRow[] = [];
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
          description: issues.description,
          status: issues.status,
          priority: issues.priority,
          originKind: issues.originKind,
          assigneeAgentId: issues.assigneeAgentId,
          assigneeUserId: issues.assigneeUserId,
          executionState: issues.executionState,
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
      const topLevelHead =
        companyAgentRows.find((agent) => agent.role === "ceo" && agent.reportsTo === null) ??
        companyAgentRows.find((agent) => agent.reportsTo === null) ??
        null;
      const topLevelHeadId = topLevelHead?.id ?? null;
      const directHeadIds = new Set(
        companyAgentRows
          .filter((agent) => topLevelHeadId && agent.reportsTo === topLevelHeadId)
          .map((agent) => agent.id),
      );

      const blockerEdgeRows = openIssueIds.length > 0
        ? await db
            .select({ issueId: issueRelations.relatedIssueId })
            .from(issueRelations)
            .where(and(
              eq(issueRelations.companyId, companyId),
              inArray(issueRelations.relatedIssueId, openIssueIds),
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

      const pendingInteractionRows = openIssueIds.length > 0
        ? await db
            .select({ issueId: issueThreadInteractions.issueId })
            .from(issueThreadInteractions)
            .where(and(
              eq(issueThreadInteractions.companyId, companyId),
              inArray(issueThreadInteractions.issueId, openIssueIds),
              eq(issueThreadInteractions.status, "pending"),
              sql`${issueThreadInteractions.kind} <> 'agent_meeting'`,
            ))
        : [];
      const pendingInteractionIssueIds = new Set(pendingInteractionRows.map((row) => row.issueId));

      const pendingApprovalRows = openIssueIds.length > 0
        ? await db
            .select({ issueId: issueApprovals.issueId })
            .from(issueApprovals)
            .innerJoin(approvals, eq(issueApprovals.approvalId, approvals.id))
            .where(and(
              eq(issueApprovals.companyId, companyId),
              inArray(issueApprovals.issueId, openIssueIds),
              inArray(approvals.status, ["pending", "revision_requested"]),
            ))
        : [];
      const pendingApprovalIssueIds = new Set(pendingApprovalRows.map((row) => row.issueId));

      const activeRunRows = await db
        .select({
          id: heartbeatRuns.id,
          status: heartbeatRuns.status,
          agentId: heartbeatRuns.agentId,
          contextSnapshot: heartbeatRuns.contextSnapshot,
          createdAt: heartbeatRuns.createdAt,
          updatedAt: heartbeatRuns.updatedAt,
        })
        .from(heartbeatRuns)
        .where(and(
          eq(heartbeatRuns.companyId, companyId),
          inArray(heartbeatRuns.status, ["queued", "running", "scheduled_retry"]),
        ))
        .orderBy(desc(heartbeatRuns.createdAt))
        .limit(200);
      const failedRunRows = await db
        .select({
          id: heartbeatRuns.id,
          status: heartbeatRuns.status,
          agentId: heartbeatRuns.agentId,
          errorCode: heartbeatRuns.errorCode,
          contextSnapshot: heartbeatRuns.contextSnapshot,
          createdAt: heartbeatRuns.createdAt,
          updatedAt: heartbeatRuns.updatedAt,
        })
        .from(heartbeatRuns)
        .where(and(
          eq(heartbeatRuns.companyId, companyId),
          inArray(heartbeatRuns.status, ["failed", "timed_out"]),
          gte(heartbeatRuns.updatedAt, new Date(now - OPERATING_SIGNAL_WINDOW_MS)),
        ))
        .orderBy(desc(heartbeatRuns.updatedAt))
        .limit(100);
      const activeCampaignPhaseRows = await db
        .select({
          id: campaignPhases.id,
          status: campaignPhases.status,
          title: campaignPhases.title,
          campaignTitle: campaigns.title,
        })
        .from(campaignPhases)
        .innerJoin(campaigns, eq(campaignPhases.campaignId, campaigns.id))
        .where(and(
          eq(campaignPhases.companyId, companyId),
          inArray(campaignPhases.status, ["in_review", "revision_requested", "approved", "executing"]),
          sql`${campaigns.status} not in ('completed', 'cancelled', 'archived')`,
        ))
        .orderBy(desc(campaignPhases.updatedAt))
        .limit(50);
      const recentCostRow = await db
        .select({
          costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
          eventCount: sql<number>`count(*)::int`,
        })
        .from(costEvents)
        .where(and(
          eq(costEvents.companyId, companyId),
          gte(costEvents.occurredAt, new Date(now - OPERATING_SIGNAL_WINDOW_MS)),
        ))
        .then((rows) => rows[0] ?? { costCents: 0, eventCount: 0 });
      const issueIdFromRunContext = (context: Record<string, unknown> | null | undefined) => {
        const issueId = typeof context?.issueId === "string" ? context.issueId : null;
        const taskId = typeof context?.taskId === "string" ? context.taskId : null;
        return issueId ?? taskId;
      };
      const openIssueIdSet = new Set(openIssueIds);
      const activeIssueScopedRuns = activeRunRows.filter((run) => {
        const issueId = issueIdFromRunContext(run.contextSnapshot);
        return !issueId || openIssueIdSet.has(issueId);
      });
      const failedIssueScopedRuns = failedRunRows.filter((run) => {
        const issueId = issueIdFromRunContext(run.contextSnapshot);
        return !issueId || openIssueIdSet.has(issueId);
      });
      const openProductivityReviewIssues = openIssueRows.filter(
        (issue) => issue.originKind === "issue_productivity_review",
      );

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
        if (assignee && (assignee.reportsTo === topLevelHeadId || directHeadIds.has(assignee.id))) return assignee;
        if (assignee?.reportsTo) return agentById.get(assignee.reportsTo) ?? assignee;
        return assignee ?? topLevelHead;
      };
      const resolveDepartmentHeadId = (agentId: string | null) => resolveHead(agentId)?.id ?? null;
      const isMeetingRunnableAgentId = (agentId: string | null | undefined) => {
        const status = agentId ? agentById.get(agentId)?.status : null;
        return Boolean(status && !["paused", "pending_approval", "terminated"].includes(status));
      };
      const agentSearchText = (agent: typeof companyAgentRows[number]) =>
        [agent.name, agent.role, agent.title].filter(Boolean).join(" ").toLowerCase();
      const fictionDirector = findFictionDirector(companyAgentRows);
      const findFictionAgent = (pattern: RegExp) =>
        companyAgentRows.find((agent) =>
          isMeetingRunnableAgentId(agent.id) &&
          (!fictionDirector || agent.id === fictionDirector.id || agent.reportsTo === fictionDirector.id) &&
          pattern.test(agentSearchText(agent)),
        ) ?? null;
      const fictionStoryParticipantIds = (issue: typeof openIssueRows[number]) => {
        if (!fictionDirector || !isFictionStoryAlignmentIssue(issue, { fictionDirector, agentById })) return [];
        const ids = [
          fictionDirector.id,
          findFictionAgent(FICTION_RESEARCH_ROLE_RE)?.id ?? null,
          findFictionAgent(FICTION_DRAFT_ROLE_RE)?.id ?? null,
          needsFictionVisualStoryParticipant(issue) ? findFictionAgent(FICTION_VISUAL_STORY_ROLE_RE)?.id ?? null : null,
          findFictionAgent(FICTION_CHARACTER_ROLE_RE)?.id ?? null,
          findFictionAgent(FICTION_PLOT_ROLE_RE)?.id ?? null,
          findFictionAgent(FICTION_WORLDBUILDING_ROLE_RE)?.id ?? null,
          findFictionAgent(FICTION_CONTINUITY_COORDINATOR_ROLE_RE)?.id ?? null,
          issue.assigneeAgentId,
        ].filter((agentId): agentId is string => Boolean(agentId && isMeetingRunnableAgentId(agentId)));
        return [...new Set(ids)].slice(0, 20);
      };
      const companyOperatingParticipantIds = () => {
        const headIds = [...directHeadIds].filter((agentId) => isMeetingRunnableAgentId(agentId));
        return [...new Set([
          ...(isMeetingRunnableAgentId(topLevelHeadId) ? [topLevelHeadId!] : []),
          ...headIds,
        ])].slice(0, 20);
      };
      const ensureDiscussionParticipantIds = (participantIds: string[], chairCandidateId: string | null) => {
        if (participantIds.length !== 1) return participantIds;
        const [soleParticipantId] = participantIds;
        const soleParticipant = agentById.get(soleParticipantId!);
        const directReportIds = companyAgentRows
          .filter((agent) => agent.reportsTo === soleParticipantId)
          .map((agent) => agent.id);
        const peerIds = soleParticipant?.reportsTo
          ? companyAgentRows
              .filter((agent) => agent.reportsTo === soleParticipant.reportsTo)
              .map((agent) => agent.id)
          : [];
        const candidates = [
          ...directReportIds,
          ...peerIds,
          chairCandidateId && chairCandidateId !== soleParticipantId ? chairCandidateId : null,
        ].filter((agentId): agentId is string =>
          Boolean(agentId) &&
          agentId !== soleParticipantId &&
          isMeetingRunnableAgentId(agentId),
        );
        const nextIds = [...participantIds];
        for (const candidate of candidates) {
          if (!nextIds.includes(candidate)) {
            nextIds.push(candidate);
            break;
          }
        }
        return nextIds;
      };
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
        const uniqueRelatedHeadIds = [...new Set(relatedHeadIds)];
        const issueIsCritical = issue?.priority === "critical";
        const nonTopRelatedHeadIds = uniqueRelatedHeadIds.filter((agentId) => agentId !== topLevelHeadId);
        const participantHeadIds =
          !issueIsCritical && nonTopRelatedHeadIds.length > 0
            ? nonTopRelatedHeadIds
            : uniqueRelatedHeadIds;
        const crossesDepartments = participantHeadIds.length > 1;
        const isHeadsCoordination =
          crossesDepartments &&
          participantHeadIds.every((agentId) => directHeadIds.has(agentId) || agentId === topLevelHeadId);
        const headForMeeting =
          head?.id === topLevelHeadId && !issueIsCritical && nonTopRelatedHeadIds.length > 0
            ? agentById.get(nonTopRelatedHeadIds[0]!) ?? head
            : head;
        const includeTopLevelHead =
          trigger === "no_recent_meetings" ||
          issueIsCritical ||
          isHeadsCoordination ||
          !headForMeeting;
        const participantAssigneeIds = includeTopLevelHead
          ? relatedAssigneeIds
          : relatedAssigneeIds.filter((agentId) => agentId !== topLevelHeadId);
        const issueParticipantIds = [...new Set([
          ...(headForMeeting ? [headForMeeting.id] : []),
          ...participantHeadIds,
          ...participantAssigneeIds,
          ...(includeTopLevelHead && topLevelHead
            ? [topLevelHead.id]
            : []),
        ])].slice(0, 20);
        const rawParticipantIds = trigger === "no_recent_meetings" || issue === null
          ? companyOperatingParticipantIds()
          : issueParticipantIds;
        const participantIds = ensureDiscussionParticipantIds(
          rawParticipantIds.filter((agentId) => isMeetingRunnableAgentId(agentId)),
          headForMeeting?.id ?? null,
        );
        const preferredHead = trigger === "no_recent_meetings" ? topLevelHead : headForMeeting;
        const suggestedHeadId = participantIds.includes(preferredHead?.id ?? "")
          ? preferredHead?.id ?? null
          : participantIds[0] ?? null;
        const suggestedHead = suggestedHeadId ? agentById.get(suggestedHeadId) ?? null : null;
        return {
          id: `${trigger}:${issue?.id ?? "company"}`,
          trigger,
          severity: severityForMeetingTrigger(trigger),
          reason,
          issueId: issue?.id ?? null,
          issueIdentifier: issue?.identifier ?? null,
          issueTitle: issue?.title ?? null,
          issueStatus: issue?.status as MeetingWorkflowRecommendation["issueStatus"] ?? null,
          suggestedHeadAgentId: suggestedHeadId,
          suggestedHeadName: suggestedHead?.name ?? null,
          participantAgentIds: participantIds,
          participantNames: participantIds
            .map((agentId) => agentById.get(agentId)?.name ?? null)
            .filter((name): name is string => Boolean(name)),
          expectedOutputs: MEETING_TRIGGER_OUTPUTS[trigger],
        };
      };
      const buildFictionStoryAlignmentRecommendation = (
        issue: typeof openIssueRows[number],
      ): MeetingWorkflowRecommendation | null => {
        const participantIds = fictionStoryParticipantIds(issue);
        if (!fictionDirector || participantIds.length < 2) return null;
        return {
          ...buildRecommendation(
            "fiction_story_alignment",
            issue,
            "Fiction setup/draft work needs research, character, plot/sequence, World Vault lore, large-scale worldbuilding, evaluation gates, format/art-density, and drafting alignment before continuing.",
          ),
          suggestedHeadAgentId: fictionDirector.id,
          suggestedHeadName: fictionDirector.name ?? null,
          participantAgentIds: participantIds,
          participantNames: participantIds
            .map((agentId) => agentById.get(agentId)?.name ?? null)
            .filter((name): name is string => Boolean(name)),
          expectedOutputs: MEETING_TRIGGER_OUTPUTS.fiction_story_alignment,
        };
      };
      const hasExplicitWaitingPath = (issue: typeof openIssueRows[number]) => (
        Boolean(issue.assigneeUserId) ||
        Boolean(issue.executionState) ||
        pendingInteractionIssueIds.has(issue.id) ||
        pendingApprovalIssueIds.has(issue.id)
      );

      const recommendations: MeetingWorkflowRecommendation[] = [];
      for (const issue of openIssueRows) {
        if (hasMeetingCoverage(issue.id)) continue;
        const fictionStoryRecommendation = buildFictionStoryAlignmentRecommendation(issue);
        if (fictionStoryRecommendation) {
          recommendations.push(fictionStoryRecommendation);
          continue;
        }
        const ageMs = now - issue.updatedAt.getTime();
        if (issue.status === "blocked" && !blockerEdgeIssueIds.has(issue.id) && !hasExplicitWaitingPath(issue)) {
          recommendations.push(buildRecommendation(
            "blocked_without_edge",
            issue,
            "Issue is blocked, but no first-class blocker edge exists.",
          ));
          continue;
        }
        if (issue.status === "in_review" && ageMs >= STALE_REVIEW_MS && !hasExplicitWaitingPath(issue)) {
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

      if (recommendations.length === 0 && failedIssueScopedRuns.length > 0) {
        const errorCodes = [...new Set(failedIssueScopedRuns.map((run) => run.errorCode).filter(Boolean))];
        recommendations.push(buildRecommendation(
          "failed_run_review",
          null,
          [
            `${failedIssueScopedRuns.length} failed/timed-out runs in the last 24h require operating review.`,
            errorCodes.length > 0 ? `Error codes: ${errorCodes.slice(0, 5).join(", ")}.` : null,
            `Cost events in window: ${recentCostRow.eventCount}; cost: ${recentCostRow.costCents} cents.`,
          ].filter(Boolean).join(" "),
        ));
      }

      if (recommendations.length === 0 && activeIssueScopedRuns.length >= ACTIVE_WORK_PRESSURE_RUNS) {
        const queuedCount = activeIssueScopedRuns.filter((run) => run.status === "queued").length;
        const runningCount = activeIssueScopedRuns.filter((run) => run.status === "running").length;
        const scheduledRetryCount = activeIssueScopedRuns.filter((run) => run.status === "scheduled_retry").length;
        recommendations.push(buildRecommendation(
          "active_work_pressure",
          null,
          [
            `Active queued/running work: ${activeIssueScopedRuns.length} runs (${queuedCount} queued, ${runningCount} running, ${scheduledRetryCount} scheduled retry).`,
            `Cost events in window: ${recentCostRow.eventCount}; cost: ${recentCostRow.costCents} cents.`,
            "Review scheduler pressure, stuck agents, blockers, decisions, and exact issue operations.",
          ].join(" "),
        ));
      }

      if (recommendations.length === 0 && openProductivityReviewIssues.length > 0) {
        recommendations.push(buildRecommendation(
          "productivity_review",
          null,
          [
            `${openProductivityReviewIssues.length} open productivity review issue(s) need management synthesis.`,
            `Cost events in window: ${recentCostRow.eventCount}; cost: ${recentCostRow.costCents} cents.`,
            "Review no-comment streaks, long-active work, churn, agent performance, decisions, and exact follow-up issue operations.",
          ].join(" "),
        ));
      }

      if (recommendations.length === 0 && activeCampaignPhaseRows.length > 0) {
        const phaseSummary = activeCampaignPhaseRows
          .slice(0, 5)
          .map((phase) => `${phase.campaignTitle}: ${phase.title} (${phase.status})`)
          .join("; ");
        recommendations.push(buildRecommendation(
          "campaign_phase_review",
          null,
          [
            `${activeCampaignPhaseRows.length} campaign phase(s) are in review/revision/approval/execution.`,
            phaseSummary ? `Phases: ${phaseSummary}.` : null,
            "Review progress, blockers, responsible agents, decisions, and exact issue/document/approval operations.",
          ].filter(Boolean).join(" "),
        ));
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
      const unlinkedOutcomeItems = [
        ...meetingRows.map((meeting) =>
          countUnlinkedMeetingOutcomes(
            parseStoredMeetingResult(meeting.result),
          ).unlinkedOutcomeItems,
        ),
        ...firstClassMeetingRows.map((meeting) =>
          countUnlinkedMeetingOutcomes(
            parseStoredMeetingResult(meeting.result),
          ).unlinkedOutcomeItems,
        ),
      ].reduce((sum, count) => sum + count, 0);
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
            ...pendingMeetings.map((meeting) => meeting.updatedAt ?? meeting.createdAt),
            ...firstClassPendingMeetings.map((meeting) => meeting.updatedAt ?? meeting.createdAt),
          ].filter(
            (createdAt) => now - createdAt.getTime() >= STALE_PENDING_MEETING_MS,
          ).length,
          meetingsLast7Days,
          openMeetingGaps: recommendations.length,
          unlinkedOutcomeItems,
          lastMeetingAt: allMeetingCreatedAts[0] ?? null,
        },
        policy: meetingWorkflowPolicy(),
        recommendations: recommendations.slice(0, 12),
      };
    },

    reconcileMeetingWorkflow: async (companyId: string): Promise<ReconcileMeetingWorkflowResult> => {
      const meetingsSvc = meetingService(db);
      await meetingsSvc.repairWorkflowMeetingLinks(companyId);
      const migratedLegacyMeetings = await migrateLegacyMeetingWorkflowInteractions(companyId);
      const resolvedTerminal =
        await meetingsSvc.resolveSupersededWorkflowMeetings(companyId) +
        await meetingsSvc.resolveTerminalWorkflowMeetings(companyId);
      const firstClassPendingWakeups = await meetingsSvc.reconcilePendingWorkflowWakeups(companyId);
      const health = await issueThreadInteractionService(db).getMeetingWorkflowHealth(companyId);
      const migratedWakeupIds = migratedLegacyMeetings.meetings.map((meeting) => meeting.id);
      const pendingMigratedWakeupIds = migratedWakeupIds.length > 0
        ? new Set((await db
            .select({ id: meetings.id })
            .from(meetings)
            .where(and(
              eq(meetings.companyId, companyId),
              inArray(meetings.id, migratedWakeupIds),
              eq(meetings.status, "pending"),
            ))).map((meeting) => meeting.id))
        : new Set<string>();
      const pendingMigratedWakeups = migratedLegacyMeetings.meetings.filter((meeting) => pendingMigratedWakeupIds.has(meeting.id));
      const meetingWakeTargets: ReconcileMeetingWorkflowResult["meetings"] = [
        ...pendingMigratedWakeups,
        ...firstClassPendingWakeups.meetings,
      ];
      const coveredRecommendationKeys = new Set<string>();
      let skipped = 0;

      for (const recommendation of health.recommendations) {
        const recommendationKey = recommendation.issueId ?? recommendation.id;
        if (recommendation.issueId && migratedLegacyMeetings.activeLegacyIssueIds.has(recommendation.issueId)) {
          skipped += 1;
          continue;
        }
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
        meetingWakeTargets.push({
          id: meeting.id,
          issueId: meeting.issueId,
          participantAgentIds: meeting.participantAgentIds,
          chairAgentId: recommendation.suggestedHeadAgentId,
        });
      }

      return {
        checked: health.recommendations.length,
        created: meetingWakeTargets.length - pendingMigratedWakeups.length - firstClassPendingWakeups.meetings.length,
        requeuedPending: pendingMigratedWakeups.length + firstClassPendingWakeups.meetings.length,
        cancelledUnrunnable: migratedLegacyMeetings.cancelledUnrunnable + firstClassPendingWakeups.cancelledUnrunnable,
        resolvedTerminal,
        skipped,
        meetings: meetingWakeTargets,
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
        await migrateLegacyMeetingWorkflowInteractions(issue.companyId);
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
