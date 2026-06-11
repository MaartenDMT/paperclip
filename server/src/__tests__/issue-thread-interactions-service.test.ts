import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  approvals,
  companies,
  createDb,
  documentRevisions,
  documents,
  goals,
  heartbeatRuns,
  issueApprovals,
  issueDocuments,
  instanceSettings,
  issueRelations,
  issueThreadInteractions,
  issues,
  meetingContributions,
  meetingIssueLinks,
  meetingParticipants,
  meetings,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { issueService } from "../services/issues.js";
import { issueThreadInteractionService } from "../services/issue-thread-interactions.js";
import { meetingService } from "../services/meetings.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("issueThreadInteractionService", () => {
  let db!: ReturnType<typeof createDb>;
  let issuesSvc!: ReturnType<typeof issueService>;
  let interactionsSvc!: ReturnType<typeof issueThreadInteractionService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-thread-interactions-");
    db = createDb(tempDb.connectionString);
    issuesSvc = issueService(db);
    interactionsSvc = issueThreadInteractionService(db);
  }, 120_000);

  afterEach(async () => {
    await db.delete(meetingContributions);
    await db.delete(meetingIssueLinks);
    await db.delete(meetingParticipants);
    await db.delete(meetings);
    await db.delete(issueApprovals);
    await db.delete(approvals);
    await db.delete(issueThreadInteractions);
    await db.delete(activityLog);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issueRelations);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("accepts suggested tasks by creating a rooted issue tree under the current issue", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const assigneeAgentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });

    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Persist thread interactions",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values({
      id: assigneeAgentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      requestDepth: 2,
    });

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "suggest_tasks",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        tasks: [
          {
            clientKey: "root",
            title: "Create the root follow-up",
            workMode: "planning",
            assigneeAgentId,
          },
          {
            clientKey: "child",
            parentClientKey: "root",
            title: "Create the nested follow-up",
          },
        ],
      },
    }, {
      userId: "local-board",
    });

    expect(created.status).toBe("pending");

    const accepted = await interactionsSvc.acceptSuggestedTasks({
      id: issueId,
      companyId,
      goalId,
      projectId: null,
    }, created.id, {}, {
      userId: "local-board",
    });

    expect(accepted.interaction.kind).toBe("suggest_tasks");
    expect(accepted.interaction.status).toBe("accepted");
    expect(accepted.interaction.result).toMatchObject({
      version: 1,
      createdTasks: [
        expect.objectContaining({ clientKey: "root", parentIssueId: issueId }),
        expect.objectContaining({ clientKey: "child" }),
      ],
    });
    expect(accepted.createdIssues).toEqual([
      expect.objectContaining({
        assigneeAgentId,
        status: "todo",
      }),
      expect.objectContaining({
        assigneeAgentId: null,
        status: "todo",
      }),
    ]);
    const createdIssueRows = await db
      .select({
        title: issues.title,
        workMode: issues.workMode,
      })
      .from(issues)
      .where(eq(issues.companyId, companyId));
    expect(createdIssueRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Create the root follow-up", workMode: "planning" }),
        expect.objectContaining({ title: "Create the nested follow-up", workMode: "standard" }),
      ]),
    );

    const children = await issuesSvc.list(companyId, { parentId: issueId });
    expect(children).toHaveLength(1);
    expect(children[0]?.title).toBe("Create the root follow-up");

    const nestedChildren = await issuesSvc.list(companyId, { parentId: children[0]!.id });
    expect(nestedChildren).toHaveLength(1);
    expect(nestedChildren[0]?.title).toBe("Create the nested follow-up");
    expect(nestedChildren[0]?.requestDepth).toBe(4);

    const listed = await interactionsSvc.listForIssue(issueId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("accepted");

    await expect(interactionsSvc.acceptSuggestedTasks({
      id: issueId,
      companyId,
      goalId,
      projectId: null,
    }, created.id, {}, {
      userId: "local-board",
    })).rejects.toThrow("Interaction has already been resolved");

    const childrenAfterDuplicateAccept = await issuesSvc.list(companyId, { parentId: issueId });
    expect(childrenAfterDuplicateAccept).toHaveLength(1);
  });

  it("accepts a selected subset of suggested tasks and records the skipped drafts", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });

    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Selectively persist thread interactions",
      level: "task",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      requestDepth: 2,
    });

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "suggest_tasks",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        tasks: [
          {
            clientKey: "root",
            title: "Create the root follow-up",
          },
          {
            clientKey: "child",
            parentClientKey: "root",
            title: "Create the nested follow-up",
          },
          {
            clientKey: "sibling",
            title: "Create the sibling follow-up",
          },
        ],
      },
    }, {
      userId: "local-board",
    });

    const accepted = await interactionsSvc.acceptSuggestedTasks({
      id: issueId,
      companyId,
      goalId,
      projectId: null,
    }, created.id, {
      selectedClientKeys: ["root"],
    }, {
      userId: "local-board",
    });

    expect(accepted.interaction.result).toMatchObject({
      version: 1,
      createdTasks: [
        expect.objectContaining({ clientKey: "root", parentIssueId: issueId }),
      ],
      skippedClientKeys: ["child", "sibling"],
    });

    const children = await issuesSvc.list(companyId, { parentId: issueId });
    expect(children).toHaveLength(1);
    expect(children[0]?.title).toBe("Create the root follow-up");
  });

  it("rejects partial acceptance when a selected task omits its selected-tree parent", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });

    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Validate selective acceptance",
      level: "task",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
    });

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "suggest_tasks",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        tasks: [
          {
            clientKey: "root",
            title: "Create the root follow-up",
          },
          {
            clientKey: "child",
            parentClientKey: "root",
            title: "Create the nested follow-up",
          },
        ],
      },
    }, {
      userId: "local-board",
    });

    await expect(
      interactionsSvc.acceptSuggestedTasks({
        id: issueId,
        companyId,
        goalId,
        projectId: null,
      }, created.id, {
        selectedClientKeys: ["child"],
      }, {
        userId: "local-board",
      }),
    ).rejects.toThrow("requires its parent");
  });

  it("persists validated answers for ask_user_questions interactions", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });

    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Persist question answers",
      level: "task",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Question parent",
      status: "todo",
      priority: "medium",
    });

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "ask_user_questions",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        questions: [
          {
            id: "scope",
            prompt: "Choose the scope",
            selectionMode: "single",
            required: true,
            options: [
              { id: "phase-1", label: "Phase 1" },
              { id: "phase-2", label: "Phase 2" },
            ],
          },
          {
            id: "extras",
            prompt: "Optional extras",
            selectionMode: "multi",
            options: [
              { id: "tests", label: "Tests" },
              { id: "docs", label: "Docs" },
            ],
          },
        ],
      },
    }, {
      userId: "local-board",
    });

    const answered = await interactionsSvc.answerQuestions({
      id: issueId,
      companyId,
    }, created.id, {
      answers: [
        { questionId: "scope", optionIds: ["phase-1"] },
        { questionId: "extras", optionIds: ["docs", "tests", "docs"] },
      ],
      summaryMarkdown: "Ship Phase 1 with tests and docs.",
    }, {
      userId: "local-board",
    });

    expect(answered.status).toBe("answered");
    expect(answered.result).toEqual({
      version: 1,
      answers: [
        { questionId: "scope", optionIds: ["phase-1"] },
        { questionId: "extras", optionIds: ["docs", "tests"] },
      ],
      summaryMarkdown: "Ship Phase 1 with tests and docs.",
    });

    await expect(interactionsSvc.answerQuestions({
      id: issueId,
      companyId,
    }, created.id, {
      answers: [
        { questionId: "scope", optionIds: ["phase-2"] },
      ],
    }, {
      userId: "local-board",
    })).rejects.toThrow("Interaction has already been resolved");
  });

  it("requires business-grade legacy meeting results and counts every unlinked outcome", async () => {
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const issueId = randomUUID();
    const agentId = randomUUID();
    const otherIssueId = randomUUID();

    await db.insert(companies).values([
      {
        id: companyId,
        name: "Paperclip",
        issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      },
      {
        id: otherCompanyId,
        name: "OtherCo",
        issuePrefix: `O${otherCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      },
    ]);
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values([
      {
        id: issueId,
        companyId,
        title: "Run operating review",
        status: "todo",
        priority: "medium",
      },
      {
        id: otherIssueId,
        companyId: otherCompanyId,
        title: "Wrong company work",
        status: "todo",
        priority: "medium",
      },
    ]);

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "agent_meeting",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        purpose: "Review company operating health.",
        participantAgentIds: [agentId],
        agenda: ["Review goals", "Review employee performance", "Create follow-up issues"],
        expectedOutputs: ["business_requirements", "agent_performance", "workflow_corrections", "memory_corrections", "idea_sharing"],
      },
    }, {
      agentId,
    });

    await expect(interactionsSvc.answerQuestions({
      id: issueId,
      companyId,
    }, created.id, {
      meetingResult: {
        version: 1,
        summaryMarkdown: "Missing business review.",
        decisions: [],
        actionItems: [],
        blockers: [],
        openQuestions: [],
      },
    }, {
      agentId,
    })).rejects.toThrow("businessReview");

    await expect(interactionsSvc.answerQuestions({
      id: issueId,
      companyId,
    }, created.id, {
      meetingResult: {
        version: 1,
        summaryMarkdown: "Cross-company issue reference.",
        decisions: [],
        actionItems: [{ title: "Wrong company task", ownerAgentId: null, issueId: otherIssueId }],
        blockers: [],
        openQuestions: [],
        businessReview: {
          goalAlignment: "Operating health is reviewed.",
          targetOrKpiImpact: null,
          financeOrBudgetImpact: null,
          customerOrBusinessValue: null,
          requirements: [],
          risks: [],
        },
        agentPerformanceReviews: [{
          agentId,
          assessment: "on_track",
          summary: "The chair has the required operating context.",
          evidence: [],
          corrections: [],
          issueId: null,
        }],
      },
    }, {
      agentId,
    })).rejects.toThrow("outside this company");

    const answered = await interactionsSvc.answerQuestions({
      id: issueId,
      companyId,
    }, created.id, {
      meetingResult: {
        version: 1,
        summaryMarkdown: "Operating review completed.",
        decisions: ["Keep the active goal but add operating follow-ups."],
        actionItems: [{ title: "Add operating review metric", ownerAgentId: agentId, issueId: null }],
        blockers: [{ summary: "Budget owner missing", ownerAgentId: null, issueId: null }],
        openQuestions: [],
        businessReview: {
          goalAlignment: "The current work still supports the company goal.",
          targetOrKpiImpact: "Adds a measurable operating metric.",
          financeOrBudgetImpact: "Clarifies the missing budget owner.",
          customerOrBusinessValue: "Keeps delivery work connected to business value.",
          requirements: ["Every operating meeting must state goal and KPI impact."],
          risks: ["Unlinked outcomes may not be acted on."],
        },
        agentPerformanceReviews: [{
          agentId,
          assessment: "needs_attention",
          summary: "The chair needs to convert outcomes into first-class issues.",
          evidence: ["The meeting produced several unlinked outcomes."],
          corrections: ["Create follow-up issues for operating outcomes."],
          issueId: null,
        }],
        workflowCorrections: [{ summary: "Require issue links for operating outcomes.", target: "meeting_workflow", issueId: null }],
        memoryCorrections: [{ system: "para-memory", filePath: "memory/meetings.md", correction: "Record the operating meeting done definition.", rationale: "Future agents need the rule.", issueId: null }],
        ideas: [{ title: "Operating digest", summary: "Publish a weekly digest from meeting outcomes.", ownerAgentId: agentId, issueId: null }],
      },
    }, {
      agentId,
    });

    expect(answered.status).toBe("answered");
    const meetingsList = await interactionsSvc.listMeetingsForCompany(companyId, { limit: 10 });
    expect(meetingsList[0]).toEqual(expect.objectContaining({
      unlinkedActionItems: 1,
      unlinkedBlockers: 1,
      unlinkedWorkflowCorrections: 1,
      unlinkedMemoryCorrections: 1,
      unlinkedIdeas: 1,
      unlinkedAgentPerformanceReviews: 1,
      unlinkedOutcomeItems: 6,
    }));
    const healthWithUnlinkedOutcomes = await interactionsSvc.getMeetingWorkflowHealth(companyId);
    expect(healthWithUnlinkedOutcomes.metrics.unlinkedOutcomeItems).toBe(6);

    const followUpIssueId = randomUUID();
    await db.insert(issues).values({
      id: followUpIssueId,
      companyId,
      title: "Add operating review metric",
      status: "todo",
      priority: "medium",
    });
    await interactionsSvc.linkMeetingOutcomeIssue(companyId, created.id, {
      outcomeType: "action_item",
      index: 0,
      issueId: followUpIssueId,
    }, {
      agentId,
    });
    const linkedMeetingsList = await interactionsSvc.listMeetingsForCompany(companyId, { limit: 10 });
    expect(linkedMeetingsList[0]).toEqual(expect.objectContaining({
      unlinkedActionItems: 0,
      unlinkedOutcomeItems: 5,
    }));
    const healthAfterLink = await interactionsSvc.getMeetingWorkflowHealth(companyId);
    expect(healthAfterLink.metrics.unlinkedOutcomeItems).toBe(5);
  });

  it("persists cancelled ask_user_questions interactions without answer data", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Cancel question answers",
      level: "task",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Question parent",
      status: "in_review",
      priority: "medium",
    });

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "ask_user_questions",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        questions: [{
          id: "scope",
          prompt: "Choose the scope",
          selectionMode: "single",
          required: true,
          options: [
            { id: "phase-1", label: "Phase 1" },
            { id: "phase-2", label: "Phase 2" },
          ],
        }],
      },
    }, {
      userId: "local-board",
    });

    const cancelled = await interactionsSvc.cancelQuestions({
      id: issueId,
      companyId,
    }, created.id, {
      reason: "Not needed anymore",
    }, {
      userId: "local-board",
    });

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.result).toEqual({
      version: 1,
      answers: [],
      cancelled: true,
      cancellationReason: "Not needed anymore",
      summaryMarkdown: null,
    });

    await expect(interactionsSvc.answerQuestions({
      id: issueId,
      companyId,
    }, created.id, {
      answers: [{ questionId: "scope", optionIds: ["phase-1"] }],
    }, {
      userId: "local-board",
    })).rejects.toThrow("Interaction has already been resolved");
  });

  it("reuses the existing interaction when the same idempotency key is submitted twice", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });

    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Interaction dedupe",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "manual",
      status: "running",
      startedAt: new Date("2026-04-20T12:00:00.000Z"),
    });

    const input = {
      kind: "ask_user_questions" as const,
      idempotencyKey: "run-1:questionnaire",
      sourceRunId: runId,
      continuationPolicy: "wake_assignee" as const,
      payload: {
        version: 1 as const,
        questions: [
          {
            id: "scope",
            prompt: "Pick a scope",
            selectionMode: "single" as const,
            options: [{ id: "phase-2", label: "Phase 2" }],
          },
        ],
      },
    };

    const first = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, input, {
      agentId,
    });

    const second = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, input, {
      agentId,
    });

    expect(second.id).toBe(first.id);
    expect(second.sourceRunId).toBe(runId);

    const rows = await db.select().from(issueThreadInteractions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.idempotencyKey).toBe("run-1:questionnaire");
  });

  it("accepts request_confirmation interactions without creating child issues", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Confirm a request",
      level: "task",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
    });

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "request_confirmation",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        prompt: "Apply this plan?",
        acceptLabel: "Apply",
        rejectLabel: "Keep editing",
        detailsMarkdown: "Creates follow-up work after acceptance.",
      },
    }, {
      userId: "local-board",
    });

    expect(created.kind).toBe("request_confirmation");
    expect(created.status).toBe("pending");

    const accepted = await interactionsSvc.acceptInteraction({
      id: issueId,
      companyId,
      goalId,
      projectId: null,
    }, created.id, {}, {
      userId: "local-board",
    });

    expect(accepted.createdIssues).toEqual([]);
    expect(accepted.interaction).toMatchObject({
      kind: "request_confirmation",
      status: "accepted",
      result: {
        version: 1,
        outcome: "accepted",
      },
      resolvedByUserId: "local-board",
    });

    const requiresReason = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "request_confirmation",
      payload: {
        version: 1,
        prompt: "Decline only with a reason?",
        rejectRequiresReason: true,
      },
    }, {
      userId: "local-board",
    });

    await expect(interactionsSvc.rejectInteraction({
      id: issueId,
      companyId,
    }, requiresReason.id, {}, {
      userId: "local-board",
    })).rejects.toThrow("A decline reason is required for this confirmation");
  });

  it("returns agent-authored request confirmations to the creating agent when a board user accepts", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Confirm a request",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Senior Product Engineer",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Review the plan",
      status: "in_review",
      priority: "medium",
      assigneeUserId: "local-board",
    });

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "request_confirmation",
      continuationPolicy: "wake_assignee_on_accept",
      payload: {
        version: 1,
        prompt: "Approve this plan?",
        acceptLabel: "Approve plan",
        rejectLabel: "Ask for changes",
      },
    }, {
      agentId,
    });

    const accepted = await interactionsSvc.acceptInteraction({
      id: issueId,
      companyId,
      goalId,
      projectId: null,
    }, created.id, {}, {
      userId: "local-board",
    });

    expect(accepted.continuationIssue).toEqual({
      id: issueId,
      assigneeAgentId: agentId,
      assigneeUserId: null,
      status: "todo",
    });

    const updatedIssue = (await db.select().from(issues)).find((issue) => issue.id === issueId);
    expect(updatedIssue).toMatchObject({
      id: issueId,
      status: "todo",
      assigneeAgentId: agentId,
      assigneeUserId: null,
    });
  });

  it("expires supersedable request confirmations when a user comments", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const commentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Comment supersede",
      level: "task",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
    });

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "request_confirmation",
      payload: {
        version: 1,
        prompt: "Proceed with the current draft?",
        supersedeOnUserComment: true,
      },
    }, {
      userId: "local-board",
    });

    const expired = await interactionsSvc.expireRequestConfirmationsSupersededByComment({
      id: issueId,
      companyId,
    }, {
      id: commentId,
      authorUserId: "local-board",
    }, {
      userId: "local-board",
    });

    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      id: created.id,
      status: "expired",
      result: {
        version: 1,
        outcome: "superseded_by_comment",
        commentId,
      },
      resolvedByUserId: "local-board",
    });
  });

  it("expires request confirmations when the watched issue document revision changes", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const documentId = randomUUID();
    const revisionId = randomUUID();
    const nextRevisionId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Document target confirmation",
      level: "task",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
    });
    await db.insert(documents).values({
      id: documentId,
      companyId,
      title: "Plan",
      format: "markdown",
      latestBody: "v1",
      latestRevisionId: revisionId,
      latestRevisionNumber: 1,
    });
    await db.insert(issueDocuments).values({
      companyId,
      issueId,
      documentId,
      key: "plan",
    });
    await db.insert(documentRevisions).values({
      id: revisionId,
      companyId,
      documentId,
      revisionNumber: 1,
      title: "Plan",
      format: "markdown",
      body: "v1",
    });

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "request_confirmation",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        prompt: "Apply the plan document?",
        target: {
          type: "issue_document",
          issueId,
          documentId,
          key: "plan",
          revisionId,
          revisionNumber: 1,
        },
      },
    }, {
      userId: "local-board",
    });

    await db.insert(documentRevisions).values({
      id: nextRevisionId,
      companyId,
      documentId,
      revisionNumber: 2,
      title: "Plan",
      format: "markdown",
      body: "v2",
    });
    await db.update(documents).set({
      latestBody: "v2",
      latestRevisionId: nextRevisionId,
      latestRevisionNumber: 2,
    });

    const accepted = await interactionsSvc.acceptInteraction({
      id: issueId,
      companyId,
      goalId,
      projectId: null,
    }, created.id, {}, {
      userId: "local-board",
    });

    expect(accepted.interaction).toMatchObject({
      id: created.id,
      status: "expired",
      payload: {
        target: {
          type: "issue_document",
          key: "plan",
          revisionId: nextRevisionId,
          revisionNumber: 2,
        },
      },
      result: {
        version: 1,
        outcome: "stale_target",
        staleTarget: {
          type: "issue_document",
          key: "plan",
          revisionId,
        },
      },
    });
  });

  it("materializes meeting workflow recommendations into pending agent meetings", async () => {
    const companyId = randomUUID();
    const ceoId = randomUUID();
    const engineeringHeadId = randomUUID();
    const marketingHeadId = randomUUID();
    const engineerId = randomUUID();
    const marketerId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const childIssueId = randomUUID();
    const staleUpdatedAt = new Date(Date.now() - 48 * 60 * 60 * 1000);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Coordinate departments",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values([
      {
        id: ceoId,
        companyId,
        name: "CEO",
        role: "ceo",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: engineeringHeadId,
        companyId,
        name: "CTO",
        role: "engineering",
        reportsTo: ceoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: marketingHeadId,
        companyId,
        name: "CMO",
        role: "marketing",
        reportsTo: ceoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: engineerId,
        companyId,
        name: "Engineer",
        role: "engineer",
        reportsTo: engineeringHeadId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: marketerId,
        companyId,
        name: "Marketer",
        role: "marketer",
        reportsTo: marketingHeadId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values([
      {
        id: issueId,
        companyId,
        goalId,
        title: "Review launch plan",
        status: "in_review",
        priority: "high",
        assigneeAgentId: engineerId,
        updatedAt: staleUpdatedAt,
      },
      {
        id: childIssueId,
        companyId,
        goalId,
        parentId: issueId,
        title: "Prepare marketing notes",
        status: "todo",
        priority: "medium",
        assigneeAgentId: marketerId,
        updatedAt: staleUpdatedAt,
      },
    ]);

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled.created).toBeGreaterThanOrEqual(1);
    expect(reconciled.meetings[0]).toEqual(expect.objectContaining({
      issueId,
      chairAgentId: engineeringHeadId,
    }));

    const legacyRows = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.companyId, companyId));
    expect(legacyRows).toHaveLength(0);

    const rows = await db.select().from(meetings).where(eq(meetings.companyId, companyId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "pending",
      sourceIssueId: issueId,
      idempotencyKey: `meeting-workflow:stale_review:${issueId}`,
    });
    expect(rows[0]!.title).toContain("Review waiting");
    expect(rows[0]!.title).toContain("Review launch plan");
    const participants = await db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, rows[0]!.id));
    expect(participants.map((participant) => participant.agentId)).toEqual(
      expect.arrayContaining([ceoId, engineeringHeadId, marketingHeadId, engineerId, marketerId]),
    );
    expect(rows[0]!.expectedOutputs).toEqual([
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
    ]);
    expect(rows[0]!.agenda).toEqual(expect.arrayContaining([
      expect.stringContaining("goal and target"),
      expect.stringContaining("KPI"),
      expect.stringContaining("employees"),
      expect.stringContaining("workflow"),
    ]));
    expect(rows[0]!.contextMarkdown).toContain("Business review focus");
    expect(rows[0]!.contextMarkdown).toContain("financial or budget impact");
    expect(rows[0]!.contextMarkdown).toContain("employee decision quality");
    const links = await db.select().from(meetingIssueLinks).where(eq(meetingIssueLinks.meetingId, rows[0]!.id));
    expect(links).toEqual([
      expect.objectContaining({ issueId, linkKind: "source" }),
    ]);

    const duplicate = await interactionsSvc.reconcileMeetingWorkflow(companyId);
    expect(duplicate.created).toBe(0);

    const otherCompanyId = randomUUID();
    const otherIssueId = randomUUID();
    await db.insert(companies).values({
      id: otherCompanyId,
      name: "OtherCo",
      issuePrefix: `O${otherCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(issues).values({
      id: otherIssueId,
      companyId: otherCompanyId,
      title: "Wrong company issue",
      status: "todo",
      priority: "medium",
    });
    const participantAgentIds = [ceoId, engineeringHeadId, marketingHeadId, engineerId, marketerId];
    await expect(meetingService(db).respond(rows[0]!.id, {
      meetingResult: {
        version: 1,
        summaryMarkdown: "Invalid result.",
        decisions: ["This should not close the meeting."],
        actionItems: [{ title: "Cross-company action", ownerAgentId: null, issueId: otherIssueId }],
        blockers: [],
        openQuestions: [],
        businessReview: {
          goalAlignment: "Invalid cross-company result still claims goal alignment.",
          targetOrKpiImpact: "Invalid result.",
          financeOrBudgetImpact: null,
          customerOrBusinessValue: null,
          requirements: [],
          risks: [],
        },
        agentPerformanceReviews: participantAgentIds.map((agentId) => ({
          agentId,
          assessment: "on_track" as const,
          summary: "Invalid result includes required performance review shape.",
          evidence: [],
          corrections: [],
          issueId: null,
        })),
      },
    }, { agentId: engineeringHeadId })).rejects.toThrow("outside this company");
    const [stillPending] = await db.select().from(meetings).where(eq(meetings.id, rows[0]!.id));
    expect(stillPending?.status).toBe("pending");
    const linksAfterRejectedResponse = await db.select().from(meetingIssueLinks).where(eq(meetingIssueLinks.meetingId, rows[0]!.id));
    expect(linksAfterRejectedResponse).toEqual([
      expect.objectContaining({ issueId, linkKind: "source" }),
    ]);

    for (const agentId of participantAgentIds.filter((agentId) => agentId !== engineeringHeadId)) {
      await meetingService(db).contribute(rows[0]!.id, {
        summaryMarkdown: `Participant ${agentId} is ready for chair synthesis.`,
        progress: ["Reviewed the stale launch review."],
        blockers: [],
        risks: ["Skipping cross-functional synthesis would lower review quality."],
        nextActions: ["Chair should synthesize the operating decision."],
        proposedDecisions: ["Keep the launch plan in review until marketing notes are ready."],
        betterAlternatives: [],
      }, { agentId });
    }

    const answered = await meetingService(db).respond(rows[0]!.id, {
      meetingResult: {
        version: 1,
        summaryMarkdown: "Launch plan reviewed; marketing follow-up remains.",
        decisions: ["Keep the launch plan in review until marketing notes are ready."],
        actionItems: [{ title: "Finish marketing notes", ownerAgentId: marketerId, issueId: childIssueId }],
        blockers: [],
        openQuestions: [],
        rightTrack: { status: "at_risk", rationale: "Review is stale without cross-functional notes.", corrections: ["Attach marketing notes before approval."] },
        businessReview: {
          goalAlignment: "Launch readiness still advances the release goal.",
          targetOrKpiImpact: "Reduces stale review time before launch.",
          financeOrBudgetImpact: "Avoids repeated review spend.",
          customerOrBusinessValue: "Keeps customer-facing launch material accurate.",
          requirements: ["Marketing notes must be attached before approval."],
          risks: ["Release quality drops if cross-functional review is skipped."],
        },
        agentPerformanceReviews: participantAgentIds.map((agentId) => ({
          agentId,
          assessment: "on_track" as const,
          summary: "Participant has a clear role in closing the launch review.",
          evidence: ["The meeting assigned review ownership and follow-up."],
          corrections: [],
          issueId: null,
        })),
        workflowCorrections: [{ summary: "Require marketing sign-off before review completion.", target: "review_workflow", issueId }],
        memoryCorrections: [{ system: "karpathy-memory", filePath: "issues/PAP-review.md", correction: "Record review dependency on marketing notes.", rationale: "Future agents need the cross-functional dependency.", issueId }],
        ideas: [{ title: "Launch checklist", summary: "Create a reusable launch review checklist.", ownerAgentId: engineeringHeadId, issueId: null }],
      },
    }, { agentId: engineeringHeadId });
    expect(answered.status).toBe("answered");
    const answeredParticipants = await db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, rows[0]!.id));
    expect(answeredParticipants.every((participant) => participant.status === "answered")).toBe(true);
    const outcomeLinks = await db.select().from(meetingIssueLinks).where(eq(meetingIssueLinks.meetingId, rows[0]!.id));
    expect(outcomeLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ issueId, linkKind: "source" }),
      expect.objectContaining({ issueId: childIssueId, linkKind: "outcome" }),
    ]));
  });

  it("creates a repeat meeting when an old answered meeting no longer covers an open gap", async () => {
    const companyId = randomUUID();
    const ceoId = randomUUID();
    const ctoId = randomUUID();
    const engineerId = randomUUID();
    const issueId = randomUUID();
    const meetingId = randomUUID();
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: ceoId,
        companyId,
        name: "CEO",
        role: "ceo",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: ctoId,
        companyId,
        name: "CTO",
        role: "cto",
        reportsTo: ceoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: engineerId,
        companyId,
        name: "Engineer",
        role: "engineer",
        reportsTo: ctoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Still blocked",
      status: "blocked",
      priority: "high",
      assigneeAgentId: engineerId,
      createdAt: oldDate,
      updatedAt: oldDate,
    });
    await db.insert(meetings).values({
      id: meetingId,
      companyId,
      sourceIssueId: issueId,
      purpose: "Older blocker review.",
      status: "answered",
      idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
      agenda: ["Review the blocker."],
      expectedOutputs: ["decisions"],
      result: {
        version: 1,
        summaryMarkdown: "The old meeting was answered, but the issue remains blocked.",
        decisions: ["Keep investigating."],
        actionItems: [],
        blockers: [],
        openQuestions: [],
      },
      createdAt: oldDate,
      updatedAt: oldDate,
      resolvedAt: oldDate,
    });
    await db.insert(meetingIssueLinks).values({
      companyId,
      meetingId,
      issueId,
      linkKind: "source",
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled.created).toBe(1);
    const rows = await db.select().from(meetings).where(eq(meetings.companyId, companyId));
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: meetingId,
        status: "answered",
        idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
      }),
      expect.objectContaining({
        status: "pending",
        sourceIssueId: issueId,
        idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}:repeat:2`,
      }),
    ]));
  });

  it("does not include the CEO in single-department blocked issue meetings", async () => {
    const companyId = randomUUID();
    const ceoId = randomUUID();
    const engineeringHeadId = randomUUID();
    const engineerId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const childIssueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Keep engineering moving",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values([
      {
        id: ceoId,
        companyId,
        name: "CEO",
        role: "ceo",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: engineeringHeadId,
        companyId,
        name: "CTO",
        role: "cto",
        reportsTo: ceoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: engineerId,
        companyId,
        name: "Engineer",
        role: "engineer",
        reportsTo: engineeringHeadId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Blocked engineering issue",
      status: "blocked",
      priority: "high",
      assigneeAgentId: engineerId,
    });
    await db.insert(issues).values({
      id: childIssueId,
      companyId,
      goalId,
      parentId: issueId,
      title: "Non-critical CEO child issue",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: ceoId,
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled.created).toBe(1);
    expect(reconciled.meetings[0]).toEqual(expect.objectContaining({
      issueId,
      chairAgentId: engineeringHeadId,
    }));

    const rows = await db.select().from(meetings).where(eq(meetings.companyId, companyId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toContain("Blocked work");
    expect(rows[0]!.title).toContain("Blocked engineering issue");
    const participants = await db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, rows[0]!.id));
    const participantIds = participants.map((participant) => participant.agentId);
    expect(participantIds).toEqual(expect.arrayContaining([engineeringHeadId, engineerId]));
    expect(participantIds).not.toContain(ceoId);
  });

  it("keeps workflow meetings multi-agent and wakes contributors before the chair", async () => {
    const companyId = randomUUID();
    const ceoId = randomUUID();
    const engineeringHeadId = randomUUID();
    const engineerId = randomUUID();
    const issueId = randomUUID();
    const staleUpdatedAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: ceoId,
        companyId,
        name: "CEO",
        role: "ceo",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: engineeringHeadId,
        companyId,
        name: "CTO",
        role: "cto",
        reportsTo: ceoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: engineerId,
        companyId,
        name: "Engineer",
        role: "engineer",
        reportsTo: engineeringHeadId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Unmoving platform review",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: engineeringHeadId,
      updatedAt: staleUpdatedAt,
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled.created).toBe(1);
    expect(reconciled.meetings[0]).toEqual(expect.objectContaining({
      issueId,
      chairAgentId: engineeringHeadId,
      participantAgentIds: [engineerId],
    }));
    const rows = await db.select().from(meetings).where(eq(meetings.companyId, companyId));
    expect(rows).toHaveLength(1);
    const participants = await db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, rows[0]!.id));
    const participantIds = participants.map((participant) => participant.agentId);
    expect(participantIds).toEqual(expect.arrayContaining([engineeringHeadId, engineerId]));
    expect(participantIds).not.toContain(ceoId);
  });

  it("does not recommend blocker-hygiene meetings for blocked issues with first-class blocker edges", async () => {
    const companyId = randomUUID();
    const ceoId = randomUUID();
    const engineeringHeadId = randomUUID();
    const engineerId = randomUUID();
    const issueId = randomUUID();
    const blockerIssueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: ceoId,
        companyId,
        name: "CEO",
        role: "ceo",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: engineeringHeadId,
        companyId,
        name: "CTO",
        role: "cto",
        reportsTo: ceoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: engineerId,
        companyId,
        name: "Engineer",
        role: "engineer",
        reportsTo: engineeringHeadId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values([
      {
        id: issueId,
        companyId,
        title: "Blocked issue with blocker edge",
        status: "blocked",
        priority: "high",
        assigneeAgentId: engineerId,
      },
      {
        id: blockerIssueId,
        companyId,
        title: "First-class blocker",
        status: "todo",
        priority: "high",
        assigneeAgentId: engineeringHeadId,
      },
    ]);
    await db.insert(issueRelations).values({
      companyId,
      issueId: blockerIssueId,
      relatedIssueId: issueId,
      type: "blocks",
    });

    const health = await interactionsSvc.getMeetingWorkflowHealth(companyId);
    expect(health.recommendations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        trigger: "blocked_without_edge",
        issueId,
      }),
    ]));

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);
    expect(reconciled.meetings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ issueId }),
    ]));
    const meetingRows = await db.select().from(meetings).where(eq(meetings.companyId, companyId));
    expect(meetingRows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceIssueId: issueId,
        idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
      }),
    ]));
  });

  it("lets a direct department head chair their own blocked issue without the CEO", async () => {
    const companyId = randomUUID();
    const ceoId = randomUUID();
    const cmoId = randomUUID();
    const goalId = randomUUID();
    const projectId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Keep marketing moving",
      level: "task",
      status: "active",
    });
    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Marketing",
      status: "in_progress",
      goalId,
    });
    await db.insert(agents).values([
      {
        id: ceoId,
        companyId,
        name: "CEO",
        role: "ceo",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: cmoId,
        companyId,
        name: "CMO",
        role: "cmo",
        reportsTo: ceoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      goalId,
      title: "Blocked marketing issue",
      status: "blocked",
      priority: "high",
      assigneeAgentId: cmoId,
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled.created).toBe(1);
    expect(reconciled.meetings[0]).toEqual(expect.objectContaining({
      issueId,
      chairAgentId: cmoId,
      participantAgentIds: [cmoId],
    }));
    const participants = await db
      .select()
      .from(meetingParticipants)
      .where(eq(meetingParticipants.meetingId, reconciled.meetings[0]!.id));
    expect(participants.map((participant) => participant.agentId)).toEqual([cmoId]);
    const rows = await db.select().from(meetings).where(eq(meetings.companyId, companyId));
    expect(rows[0]).toMatchObject({
      sourceIssueId: issueId,
      projectId,
      goalId,
    });
  });

  it("records participant meeting contributions without resolving the meeting", async () => {
    const companyId = randomUUID();
    const chairAgentId = randomUUID();
    const contributorAgentId = randomUUID();
    const meetingId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: chairAgentId,
        companyId,
        name: "CTO",
        role: "cto",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: contributorAgentId,
        companyId,
        name: "Engineer",
        role: "engineer",
        reportsTo: chairAgentId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(meetings).values({
      id: meetingId,
      companyId,
      title: "Execution check-in",
      purpose: "Review stalled work.",
      status: "pending",
      chairAgentId,
      agenda: ["Review progress.", "Choose next action."],
      expectedOutputs: ["tasks", "blockers", "decisions"],
    });
    await db.insert(meetingParticipants).values([
      { companyId, meetingId, agentId: chairAgentId, role: "chair" },
      { companyId, meetingId, agentId: contributorAgentId, role: "participant" },
    ]);

    const contributed = await meetingService(db).contribute(meetingId, {
      summaryMarkdown: "Implementation is blocked by missing API details.",
      progress: ["Finished the data model sketch."],
      blockers: ["Need API ownership decision."],
      risks: ["Delay will push the review past the target date."],
      nextActions: ["Assign API owner."],
      proposedDecisions: ["Move API ownership to the platform team."],
      betterAlternatives: ["Split the issue into API and UI tasks."],
    }, { agentId: contributorAgentId });

    expect(contributed.agentId).toBe(contributorAgentId);
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    expect(meeting?.status).toBe("pending");
    expect(meeting?.result).toBeNull();
    const participants = await db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, meetingId));
    expect(participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: contributorAgentId, status: "contributed" }),
      expect.objectContaining({ agentId: chairAgentId, status: "pending" }),
    ]));
    const listed = await meetingService(db).listForCompany(companyId);
    expect(listed[0]).toEqual(expect.objectContaining({
      id: meetingId,
      contributedAgentIds: [contributorAgentId],
      pendingParticipantAgentIds: [chairAgentId],
    }));
    expect(listed[0]?.contributions).toEqual([
      expect.objectContaining({
        agentId: contributorAgentId,
        summaryMarkdown: "Implementation is blocked by missing API details.",
        blockers: ["Need API ownership decision."],
        betterAlternatives: ["Split the issue into API and UI tasks."],
      }),
    ]);
  });

  it("prevents the chair from answering before non-chair contributors submit updates", async () => {
    const companyId = randomUUID();
    const chairAgentId = randomUUID();
    const contributorAgentId = randomUUID();
    const meetingId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: chairAgentId,
        companyId,
        name: "CTO",
        role: "cto",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: contributorAgentId,
        companyId,
        name: "Engineer",
        role: "engineer",
        reportsTo: chairAgentId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(meetings).values({
      id: meetingId,
      companyId,
      title: "Execution check-in",
      purpose: "Review stalled work.",
      status: "pending",
      chairAgentId,
      agenda: ["Review progress.", "Choose next action."],
      expectedOutputs: ["tasks", "blockers", "decisions"],
    });
    await db.insert(meetingParticipants).values([
      { companyId, meetingId, agentId: chairAgentId, role: "chair" },
      { companyId, meetingId, agentId: contributorAgentId, role: "participant" },
    ]);

    await expect(meetingService(db).respond(meetingId, {
      meetingResult: {
        version: 1,
        summaryMarkdown: "Chair summarized the meeting without the engineer update.",
        decisions: ["Proceed without waiting."],
        actionItems: [],
        blockers: [],
        openQuestions: [],
      },
    }, { agentId: chairAgentId })).rejects.toThrow("Meeting is waiting on participant contributions");

    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    expect(meeting?.status).toBe("pending");
  });

  it("lets the board override missing meeting contributions with an audited reason", async () => {
    const companyId = randomUUID();
    const chairAgentId = randomUUID();
    const contributorAgentId = randomUUID();
    const meetingId = randomUUID();
    const boardUserId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: chairAgentId,
        companyId,
        name: "CTO",
        role: "cto",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: contributorAgentId,
        companyId,
        name: "Engineer",
        role: "engineer",
        reportsTo: chairAgentId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(meetings).values({
      id: meetingId,
      companyId,
      title: "Execution check-in",
      purpose: "Review stalled work.",
      status: "pending",
      chairAgentId,
      agenda: ["Review progress.", "Choose next action."],
      expectedOutputs: ["tasks", "blockers", "decisions"],
    });
    await db.insert(meetingParticipants).values([
      { companyId, meetingId, agentId: chairAgentId, role: "chair" },
      { companyId, meetingId, agentId: contributorAgentId, role: "participant" },
    ]);

    const answered = await meetingService(db).respond(meetingId, {
      meetingResult: {
        version: 1,
        summaryMarkdown: "Board closed the meeting after contributor timeout.",
        decisions: ["Proceed with board override."],
        actionItems: [],
        blockers: [],
        openQuestions: [],
      },
      overrideMissingContributions: true,
      overrideReason: "Contributor timed out; board accepted the available evidence.",
    }, { userId: boardUserId });

    expect(answered.status).toBe("answered");
    const logs = await db.select().from(activityLog).where(eq(activityLog.entityId, meetingId));
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "meeting.contribution_override",
        actorType: "user",
        actorId: boardUserId,
        details: expect.objectContaining({
          missingContributorIds: [contributorAgentId],
          overrideReason: "Contributor timed out; board accepted the available evidence.",
        }),
      }),
      expect.objectContaining({
        action: "meeting.answered",
        actorType: "user",
        actorId: boardUserId,
      }),
    ]));
  });

  it("rejects agent attempts to override missing meeting contributions", async () => {
    const companyId = randomUUID();
    const chairAgentId = randomUUID();
    const contributorAgentId = randomUUID();
    const meetingId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: chairAgentId,
        companyId,
        name: "CTO",
        role: "cto",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: contributorAgentId,
        companyId,
        name: "Engineer",
        role: "engineer",
        reportsTo: chairAgentId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(meetings).values({
      id: meetingId,
      companyId,
      title: "Execution check-in",
      purpose: "Review stalled work.",
      status: "pending",
      chairAgentId,
      agenda: ["Review progress.", "Choose next action."],
      expectedOutputs: ["tasks", "blockers", "decisions"],
    });
    await db.insert(meetingParticipants).values([
      { companyId, meetingId, agentId: chairAgentId, role: "chair" },
      { companyId, meetingId, agentId: contributorAgentId, role: "participant" },
    ]);

    await expect(meetingService(db).respond(meetingId, {
      meetingResult: {
        version: 1,
        summaryMarkdown: "Chair tried to override missing participant input.",
        decisions: ["Proceed anyway."],
        actionItems: [],
        blockers: [],
        openQuestions: [],
      },
      overrideMissingContributions: true,
      overrideReason: "I want to move on.",
    }, { agentId: chairAgentId })).rejects.toThrow("Only board users can override missing meeting contributions");

    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    expect(meeting?.status).toBe("pending");
  });

  it("requeues missing meeting contributors before waking the chair for synthesis", async () => {
    const companyId = randomUUID();
    const chairAgentId = randomUUID();
    const contributorAgentId = randomUUID();
    const meetingId = randomUUID();
    const staleUpdatedAt = new Date(Date.now() - 20 * 60 * 1000);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: chairAgentId,
        companyId,
        name: "CTO",
        role: "cto",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: contributorAgentId,
        companyId,
        name: "Engineer",
        role: "engineer",
        reportsTo: chairAgentId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(meetings).values({
      id: meetingId,
      companyId,
      title: "Execution check-in",
      purpose: "Review stalled work.",
      status: "pending",
      chairAgentId,
      idempotencyKey: `meeting-workflow:stale_in_progress:${meetingId}`,
      agenda: ["Review progress.", "Choose next action."],
      expectedOutputs: ["tasks", "blockers", "decisions"],
      updatedAt: staleUpdatedAt,
    });
    await db.insert(meetingParticipants).values([
      { companyId, meetingId, agentId: chairAgentId, role: "chair", status: "pending" },
      { companyId, meetingId, agentId: contributorAgentId, role: "participant", status: "pending" },
    ]);

    const missingContributorWake = await meetingService(db).reconcilePendingWorkflowWakeups(companyId);

    expect(missingContributorWake.meetings).toEqual([
      expect.objectContaining({
        id: meetingId,
        participantAgentIds: [contributorAgentId],
        chairAgentId,
      }),
    ]);

    await meetingService(db).contribute(meetingId, {
      summaryMarkdown: "Contributor update is ready for synthesis.",
      progress: ["Completed technical review."],
      blockers: [],
      risks: [],
      nextActions: ["Chair should decide next owner."],
      proposedDecisions: ["Proceed with the split plan."],
      betterAlternatives: [],
    }, { agentId: contributorAgentId });

    const chairWake = await meetingService(db).reconcilePendingWorkflowWakeups(companyId);

    expect(chairWake.meetings).toEqual([
      expect.objectContaining({
        id: meetingId,
        participantAgentIds: [chairAgentId],
        chairAgentId,
      }),
    ]);
  });

  it("creates company-level meeting workflow meetings when no recent meeting exists", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Win the market",
      level: "company",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Open non-stale work",
      status: "todo",
      priority: "medium",
      updatedAt: new Date(),
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled.created).toBe(1);
    expect(reconciled.meetings[0]).toEqual(expect.objectContaining({
      issueId: null,
      chairAgentId: agentId,
      participantAgentIds: [agentId],
    }));
    const rows = await db.select().from(meetings).where(eq(meetings.companyId, companyId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceIssueId: null,
      meetingType: "standup",
      idempotencyKey: "meeting-workflow:no_recent_meetings:company",
      status: "pending",
      title: "Operating review: company work health",
      goalId,
    });
    const links = await db.select().from(meetingIssueLinks).where(eq(meetingIssueLinks.meetingId, rows[0]!.id));
    expect(links).toHaveLength(0);
  });

  it("creates concise operating-review meetings from active work pressure signals", async () => {
    const companyId = randomUUID();
    const ceoId = randomUUID();
    const ctoId = randomUUID();
    const engineerId = randomUUID();
    const issueId = randomUUID();
    const recentMeetingId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: ceoId,
        companyId,
        name: "CEO",
        role: "ceo",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: ctoId,
        companyId,
        name: "CTO",
        role: "cto",
        reportsTo: ceoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: engineerId,
        companyId,
        name: "Engineer",
        role: "engineer",
        reportsTo: ctoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Non-stale active implementation",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: engineerId,
      updatedAt: new Date(),
    });
    await db.insert(meetings).values({
      id: recentMeetingId,
      companyId,
      meetingType: "operating_review",
      title: "Recent meeting suppresses cadence-only trigger",
      purpose: "Recent operating review.",
      status: "answered",
      chairAgentId: ceoId,
      agenda: ["Recent review"],
      expectedOutputs: ["decisions"],
      result: {
        version: 1,
        summaryMarkdown: "Recent review happened.",
        decisions: ["Keep operating."],
        actionItems: [],
        blockers: [],
        openQuestions: [],
      },
      resolvedAt: new Date(),
    });
    await db.insert(heartbeatRuns).values([
      {
        id: randomUUID(),
        companyId,
        agentId: engineerId,
        status: "running",
        invocationSource: "on_demand",
        contextSnapshot: { issueId },
      },
      {
        id: randomUUID(),
        companyId,
        agentId: engineerId,
        status: "queued",
        invocationSource: "on_demand",
        contextSnapshot: { issueId },
      },
      {
        id: randomUUID(),
        companyId,
        agentId: ctoId,
        status: "queued",
        invocationSource: "on_demand",
        contextSnapshot: { issueId },
      },
    ]);

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled.created).toBe(1);
    const rows = await db.select().from(meetings).where(eq(meetings.companyId, companyId));
    const review = rows.find((row) => row.id !== recentMeetingId);
    expect(review).toMatchObject({
      sourceIssueId: null,
      meetingType: "operating_review",
      idempotencyKey: "meeting-workflow:active_work_pressure:company",
      status: "pending",
      title: "Operating pressure: queued and running work",
    });
    expect(review?.agenda).toEqual(expect.arrayContaining([
      expect.stringContaining("What changed"),
      expect.stringContaining("What is blocked"),
      expect.stringContaining("Who is underperforming or stuck"),
      expect.stringContaining("What decision is needed"),
      expect.stringContaining("exact issue"),
    ]));
    expect(review?.contextMarkdown).toContain("Active queued/running work: 3");
    expect(review?.contextMarkdown).toContain("minimal, precise operating review");
  });

  it("keeps company-level no-recent-meeting cadence to CEO and direct heads", async () => {
    const companyId = randomUUID();
    const ceoId = randomUUID();
    const ctoId = randomUUID();
    const cmoId = randomUUID();
    const engineerId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: ceoId,
        companyId,
        name: "CEO",
        role: "ceo",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: ctoId,
        companyId,
        name: "CTO",
        role: "cto",
        reportsTo: ceoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: cmoId,
        companyId,
        name: "CMO",
        role: "cmo",
        reportsTo: ceoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: engineerId,
        companyId,
        name: "Engineer",
        role: "engineer",
        reportsTo: ctoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Open non-stale work",
      status: "todo",
      priority: "medium",
      assigneeAgentId: engineerId,
      updatedAt: new Date(),
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled.created).toBe(1);
    expect(reconciled.meetings[0]).toEqual(expect.objectContaining({
      issueId: null,
      chairAgentId: ceoId,
    }));
    expect(reconciled.meetings[0]?.participantAgentIds).toEqual(expect.arrayContaining([ceoId, ctoId, cmoId]));
    expect(reconciled.meetings[0]?.participantAgentIds).not.toContain(engineerId);
  });

  it("does not add paused agents to workflow meetings", async () => {
    const companyId = randomUUID();
    const ceoId = randomUUID();
    const ctoId = randomUUID();
    const cmoId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: ceoId,
        companyId,
        name: "CEO",
        role: "ceo",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: ctoId,
        companyId,
        name: "CTO",
        role: "cto",
        reportsTo: ceoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: cmoId,
        companyId,
        name: "CMO",
        role: "cmo",
        reportsTo: ceoId,
        status: "paused",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Open non-stale work",
      status: "todo",
      priority: "medium",
      updatedAt: new Date(),
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled.created).toBe(1);
    expect(reconciled.meetings[0]?.participantAgentIds).toEqual([ceoId, ctoId]);
    expect(reconciled.meetings[0]?.participantAgentIds).not.toContain(cmoId);

    const rows = await db.select().from(meetings).where(eq(meetings.companyId, companyId));
    expect(rows).toHaveLength(1);
    const participants = await db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, rows[0]!.id));
    expect(participants.map((participant) => participant.agentId)).toEqual([ceoId, ctoId]);
  });

  it("repairs queued CEO issue-level meetings to the department head immediately", async () => {
    const companyId = randomUUID();
    const ceoId = randomUUID();
    const ctoId = randomUUID();
    const issueId = randomUUID();
    const doneChildIssueId = randomUUID();
    const meetingId = randomUUID();
    const runId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: ceoId,
        companyId,
        name: "CEO",
        role: "ceo",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: ctoId,
        companyId,
        name: "CTO",
        role: "cto",
        reportsTo: ceoId,
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Blocked engineering owner",
      status: "blocked",
      priority: "high",
      assigneeAgentId: ctoId,
    });
    await db.insert(issues).values({
      id: doneChildIssueId,
      companyId,
      parentId: issueId,
      title: "CEO follow-up that should not own the department meeting",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: ceoId,
    });
    await db.insert(meetings).values({
      id: meetingId,
      companyId,
      sourceIssueId: issueId,
      title: "Work meeting: PAP-4",
      purpose: "Issue is blocked, but no first-class blocker edge exists.",
      status: "pending",
      chairAgentId: ceoId,
      idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
      expectedOutputs: ["blockers", "decisions"],
    });
    await db.insert(meetingParticipants).values([
      { companyId, meetingId, agentId: ceoId, role: "chair" },
      { companyId, meetingId, agentId: ctoId, role: "participant" },
    ]);
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId: ceoId,
      status: "queued",
      invocationSource: "automation",
      triggerDetail: "system",
      contextSnapshot: {
        issueId,
        meetingId,
        interactionKind: "agent_meeting",
        wakeReason: "agent_meeting_requested",
      },
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled).toMatchObject({
      created: 0,
      requeuedPending: 1,
    });
    expect(reconciled.meetings).toEqual([{
      id: meetingId,
      issueId,
      participantAgentIds: [ctoId],
      chairAgentId: ctoId,
    }]);
    const participants = await db
      .select()
      .from(meetingParticipants)
      .where(eq(meetingParticipants.meetingId, meetingId));
    expect(participants.map((participant) => participant.agentId)).toEqual([ctoId]);
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    expect(meeting?.chairAgentId).toBe(ctoId);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(run).toMatchObject({
      status: "cancelled",
      errorCode: "meeting_participant_repaired",
    });
  });

  it("prunes paused participants from pending first-class workflow meetings", async () => {
    const companyId = randomUUID();
    const activeAgentId = randomUUID();
    const pausedAgentId = randomUUID();
    const issueId = randomUUID();
    const meetingId = randomUUID();
    const runId = randomUUID();
    const staleAt = new Date(Date.now() - 60 * 60 * 1000);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: activeAgentId,
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
        id: pausedAgentId,
        companyId,
        name: "CMO",
        role: "cmo",
        status: "paused",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Blocked launch work",
      status: "blocked",
      priority: "medium",
      assigneeAgentId: activeAgentId,
    });
    await db.insert(meetings).values({
      id: meetingId,
      companyId,
      sourceIssueId: issueId,
      title: "Work meeting: PAP-5",
      purpose: "Issue is blocked, but no first-class blocker edge exists.",
      status: "pending",
      chairAgentId: pausedAgentId,
      idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
      expectedOutputs: ["blockers", "decisions"],
      createdAt: staleAt,
      updatedAt: staleAt,
    });
    await db.insert(meetingParticipants).values([
      { companyId, meetingId, agentId: activeAgentId, role: "participant" },
      { companyId, meetingId, agentId: pausedAgentId, role: "chair" },
    ]);
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId: pausedAgentId,
      status: "queued",
      invocationSource: "automation",
      triggerDetail: "system",
      contextSnapshot: {
        issueId,
        meetingId,
        interactionKind: "agent_meeting",
        wakeReason: "agent_meeting_requested",
      },
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled).toMatchObject({
      created: 0,
      requeuedPending: 1,
    });
    expect(reconciled.meetings).toEqual([{
      id: meetingId,
      issueId,
      participantAgentIds: [activeAgentId],
      chairAgentId: activeAgentId,
    }]);
    const participants = await db
      .select()
      .from(meetingParticipants)
      .where(eq(meetingParticipants.meetingId, meetingId));
    expect(participants.map((participant) => participant.agentId)).toEqual([activeAgentId]);
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    expect(meeting?.chairAgentId).toBe(activeAgentId);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(run).toMatchObject({
      status: "cancelled",
      errorCode: "meeting_participant_unrunnable",
    });
  });

  it("answers pending meeting workflow interactions when their source issue is terminal", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Close stale meetings",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Already complete",
      status: "done",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    await db.insert(issueThreadInteractions).values({
      companyId,
      issueId,
      kind: "agent_meeting",
      status: "pending",
      continuationPolicy: "wake_assignee",
      idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
      title: "Work meeting: PAP-1",
      summary: "Issue is blocked, but no first-class blocker edge exists.",
      payload: {
        version: 1,
        purpose: "Issue is blocked, but no first-class blocker edge exists.",
        participantAgentIds: [agentId],
        agenda: ["Review the stale meeting."],
        expectedOutputs: ["decisions"],
        contextMarkdown: null,
      },
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled.resolvedTerminal).toBe(1);
    const rows = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.companyId, companyId));
    expect(rows[0]).toMatchObject({
      kind: "agent_meeting",
      status: "cancelled",
      resolvedByAgentId: null,
      resolvedByUserId: null,
    });
    const [meeting] = await db.select().from(meetings).where(eq(meetings.companyId, companyId));
    expect(meeting).toMatchObject({
      sourceIssueId: issueId,
      status: "answered",
    });
    expect(meeting!.result).toMatchObject({
      version: 1,
      decisions: ["Source issue is already done; no live meeting remains."],
      actionItems: [],
      blockers: [],
      openQuestions: [],
    });
  });

  it("auto-resolves first-class pending meetings when their source issue is terminal", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const meetingId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Already complete",
      status: "done",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    await db.insert(meetings).values({
      id: meetingId,
      companyId,
      sourceIssueId: issueId,
      purpose: "Resolve terminal issue meeting.",
      status: "pending",
      idempotencyKey: `meeting-workflow:stale_review:${issueId}`,
      agenda: ["Review stale terminal meeting."],
      expectedOutputs: ["decisions"],
    });
    await db.insert(meetingParticipants).values({
      companyId,
      meetingId,
      agentId,
      role: "chair",
      status: "pending",
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled.resolvedTerminal).toBe(1);
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    expect(meeting).toMatchObject({
      status: "answered",
      resolvedByAgentId: null,
      resolvedByUserId: null,
    });
    expect((meeting?.result as any)?.summaryMarkdown).toContain("already done");
    const [participant] = await db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, meetingId));
    expect(participant).toMatchObject({ status: "answered" });
    const activityRows = await db.select().from(activityLog).where(eq(activityLog.entityId, meetingId));
    expect(activityRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "meeting.auto_resolved",
        entityType: "meeting",
      }),
    ]));
  });

  it("repairs first-class meeting issue links and missing goal context during reconciliation", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const projectId = randomUUID();
    const sourceIssueId = randomUUID();
    const outcomeIssueId = randomUUID();
    const meetingId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Keep meetings tied to goals",
      level: "company",
      status: "active",
    });
    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Operating System",
      goalId,
    });
    await db.insert(issues).values([
      {
        id: sourceIssueId,
        companyId,
        projectId,
        goalId,
        title: "Review operating work",
        status: "in_progress",
        priority: "medium",
        updatedAt: new Date(),
      },
      {
        id: outcomeIssueId,
        companyId,
        projectId,
        goalId,
        title: "Meeting follow-up",
        status: "todo",
        priority: "medium",
      },
    ]);
    await db.insert(meetings).values({
      id: meetingId,
      companyId,
      sourceIssueId,
      title: "Operating review",
      purpose: "Repair missing links from a previously answered meeting.",
      status: "answered",
      result: {
        version: 1,
        summaryMarkdown: "The team agreed to create a follow-up.",
        decisions: ["Keep the goal attached."],
        actionItems: [{ title: "Meeting follow-up", issueId: outcomeIssueId }],
        blockers: [],
        openQuestions: [],
      },
      resolvedAt: new Date(),
      expectedOutputs: ["decisions", "tasks"],
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled).toMatchObject({
      created: 0,
      requeuedPending: 0,
      resolvedTerminal: 0,
    });
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    expect(meeting).toMatchObject({
      projectId,
      goalId,
    });
    const links = await db
      .select({
        issueId: meetingIssueLinks.issueId,
        linkKind: meetingIssueLinks.linkKind,
      })
      .from(meetingIssueLinks)
      .where(eq(meetingIssueLinks.meetingId, meetingId));
    expect(links).toEqual(expect.arrayContaining([
      { issueId: sourceIssueId, linkKind: "source" },
      { issueId: outcomeIssueId, linkKind: "outcome" },
    ]));
    const activityRows = await db.select().from(activityLog).where(eq(activityLog.entityId, companyId));
    expect(activityRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "meeting.workflow_repaired",
        entityType: "company",
      }),
    ]));
  });

  it("requeues stale pending meeting workflow interactions for runnable participants", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const interactionId = randomUUID();
    const staleAt = new Date(Date.now() - 60 * 60 * 1000);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Rewake stale meetings",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CTO",
      role: "cto",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Still blocked",
      status: "blocked",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      companyId,
      issueId,
      kind: "agent_meeting",
      status: "pending",
      continuationPolicy: "wake_assignee",
      idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
      title: "Work meeting: PAP-2",
      summary: "Issue is blocked, but no first-class blocker edge exists.",
      createdAt: staleAt,
      updatedAt: staleAt,
      payload: {
        version: 1,
        purpose: "Issue is blocked, but no first-class blocker edge exists.",
        participantAgentIds: [agentId],
        agenda: ["Review the stale meeting."],
        expectedOutputs: ["decisions"],
        contextMarkdown: null,
      },
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled).toMatchObject({
      created: 0,
      requeuedPending: 1,
      cancelledUnrunnable: 0,
      resolvedTerminal: 0,
    });
    expect(reconciled.meetings).toEqual([expect.objectContaining({
      issueId,
      participantAgentIds: [agentId],
      chairAgentId: agentId,
    })]);
    expect(reconciled.meetings[0]?.id).not.toBe(interactionId);
  });

  it("migrates legacy workflow meeting interactions to first-class meetings during reconciliation", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const interactionId = randomUUID();
    const staleAt = new Date(Date.now() - 60 * 60 * 1000);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Migrate legacy meetings",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CTO",
      role: "cto",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Still blocked",
      status: "blocked",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      companyId,
      issueId,
      kind: "agent_meeting",
      status: "pending",
      continuationPolicy: "wake_assignee",
      idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
      title: "Work meeting: PAP-2",
      summary: "Issue is blocked, but no first-class blocker edge exists.",
      createdAt: staleAt,
      updatedAt: staleAt,
      payload: {
        version: 1,
        purpose: "Issue is blocked, but no first-class blocker edge exists.",
        participantAgentIds: [agentId],
        agenda: ["Review the stale meeting."],
        expectedOutputs: ["decisions"],
        contextMarkdown: "Legacy meeting context.",
      },
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled).toMatchObject({
      created: 0,
      requeuedPending: 1,
      cancelledUnrunnable: 0,
    });
    expect(reconciled.meetings).toHaveLength(1);
    expect(reconciled.meetings[0]).toMatchObject({
      issueId,
      participantAgentIds: [agentId],
      chairAgentId: agentId,
    });
    expect(reconciled.meetings[0]?.id).not.toBe(interactionId);

    const firstClassRows = await db.select().from(meetings).where(eq(meetings.companyId, companyId));
    expect(firstClassRows).toHaveLength(1);
    expect(firstClassRows[0]).toMatchObject({
      sourceIssueId: issueId,
      status: "pending",
      title: "Work meeting: PAP-2",
      purpose: "Issue is blocked, but no first-class blocker edge exists.",
      idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
    });
    expect(firstClassRows[0]?.contextMarkdown).toContain("Legacy meeting context.");

    const participantRows = await db
      .select()
      .from(meetingParticipants)
      .where(eq(meetingParticipants.meetingId, firstClassRows[0]!.id));
    expect(participantRows.map((participant) => participant.agentId)).toEqual([agentId]);

    const [legacyRow] = await db
      .select()
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.id, interactionId));
    expect(legacyRow).toMatchObject({
      status: "cancelled",
      resolvedByAgentId: null,
      resolvedByUserId: null,
    });
  });

  it("does not recommend blocked_without_edge meetings when a pending non-meeting interaction already owns next action", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Covered blocked issue",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CTO",
      role: "cto",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Blocked but already waiting on board input",
      status: "blocked",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    await db.insert(issueThreadInteractions).values({
      id: randomUUID(),
      companyId,
      issueId,
      kind: "ask_user_questions",
      status: "pending",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        questions: [{
          id: "publish_path",
          prompt: "Which publish path will you provide?",
          selectionMode: "single",
          options: [{
            id: "scheduler",
            label: "Connected scheduler",
            description: "Board will provide scheduler access.",
          }],
        }],
      },
    });

    const health = await interactionsSvc.getMeetingWorkflowHealth(companyId);

    expect(health.recommendations.filter((recommendation) => recommendation.issueId === issueId)).toEqual([]);
  });

  it("auto-resolves stale pending meeting workflow interactions when a pending non-meeting interaction already owns next action", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const interactionId = randomUUID();
    const staleAt = new Date(Date.now() - 60 * 60 * 1000);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Superseded legacy meeting",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CTO",
      role: "cto",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Blocked issue with explicit next action",
      status: "blocked",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    await db.insert(issueThreadInteractions).values([
      {
        id: interactionId,
        companyId,
        issueId,
        kind: "agent_meeting",
        status: "pending",
        continuationPolicy: "wake_assignee",
        idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
        title: "Work meeting: PAP-2",
        summary: "Issue is blocked, but no first-class blocker edge exists.",
        createdAt: staleAt,
        updatedAt: staleAt,
        payload: {
          version: 1,
          purpose: "Issue is blocked, but no first-class blocker edge exists.",
          participantAgentIds: [agentId],
          agenda: ["Review the stale meeting."],
          expectedOutputs: ["decisions"],
          contextMarkdown: null,
        },
      },
      {
        id: randomUUID(),
        companyId,
        issueId,
        kind: "ask_user_questions",
        status: "pending",
        continuationPolicy: "wake_assignee",
        payload: {
          version: 1,
          questions: [{
            id: "publish_path",
            prompt: "Which publish path will you provide?",
            selectionMode: "single",
            options: [{
              id: "scheduler",
              label: "Connected scheduler",
              description: "Board will provide scheduler access.",
            }],
          }],
        },
      },
    ]);

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled).toMatchObject({
      created: 0,
      requeuedPending: 0,
      cancelledUnrunnable: 0,
      resolvedTerminal: 1,
    });
    expect(reconciled.meetings).toEqual([]);
    const [row] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interactionId));
    expect(row).toMatchObject({
      status: "cancelled",
      resolvedByAgentId: null,
      resolvedByUserId: null,
    });
    const [meeting] = await db.select().from(meetings).where(eq(meetings.companyId, companyId));
    expect(meeting).toMatchObject({
      sourceIssueId: issueId,
      status: "answered",
    });
    expect((meeting?.result as any)?.summaryMarkdown).toContain("pending non-meeting interaction or approval");
  });

  it("does not duplicate requeue meeting wakeups while one is already active", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const interactionId = randomUUID();
    const staleAt = new Date(Date.now() - 60 * 60 * 1000);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Deduplicate stale meetings",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CTO",
      role: "cto",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Still blocked",
      status: "blocked",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      companyId,
      issueId,
      kind: "agent_meeting",
      status: "pending",
      continuationPolicy: "wake_assignee",
      idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
      title: "Work meeting: PAP-2",
      summary: "Issue is blocked, but no first-class blocker edge exists.",
      createdAt: staleAt,
      updatedAt: staleAt,
      payload: {
        version: 1,
        purpose: "Issue is blocked, but no first-class blocker edge exists.",
        participantAgentIds: [agentId],
        agenda: ["Review the stale meeting."],
        expectedOutputs: ["decisions"],
        contextMarkdown: null,
      },
    });
    await db.insert(heartbeatRuns).values({
      companyId,
      agentId,
      status: "queued",
      invocationSource: "automation",
      triggerDetail: "system",
      contextSnapshot: {
        issueId,
        interactionId,
        interactionKind: "agent_meeting",
        interactionStatus: "pending",
      },
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled).toMatchObject({
      created: 0,
      requeuedPending: 0,
      cancelledUnrunnable: 0,
      resolvedTerminal: 0,
    });
    expect(reconciled.meetings).toEqual([]);
    const [row] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interactionId));
    expect(row?.updatedAt?.getTime()).toBe(staleAt.getTime());
  });

  it("cancels stale pending meeting workflow interactions with no runnable participants", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const interactionId = randomUUID();
    const staleAt = new Date(Date.now() - 60 * 60 * 1000);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Cancel unrunnable meetings",
      level: "task",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Blocked without a live owner",
      status: "blocked",
      priority: "medium",
    });
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      companyId,
      issueId,
      kind: "agent_meeting",
      status: "pending",
      continuationPolicy: "wake_assignee",
      idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
      title: "Work meeting: PAP-3",
      summary: "Issue is blocked, but no first-class blocker edge exists.",
      createdAt: staleAt,
      updatedAt: staleAt,
      payload: {
        version: 1,
        purpose: "Issue is blocked, but no first-class blocker edge exists.",
        participantAgentIds: [randomUUID()],
        agenda: ["Review the stale meeting."],
        expectedOutputs: ["decisions"],
        contextMarkdown: null,
      },
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled.cancelledUnrunnable).toBe(1);
    expect(reconciled.meetings).toEqual([]);
    const [row] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interactionId));
    expect(row).toMatchObject({
      status: "cancelled",
      resolvedByAgentId: null,
      resolvedByUserId: null,
    });
  });

  it("cancels stale pending meeting workflow interactions when participants are paused", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const interactionId = randomUUID();
    const staleAt = new Date(Date.now() - 60 * 60 * 1000);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Cancel paused meeting participants",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Paused CTO",
      role: "cto",
      status: "paused",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Blocked with paused participant",
      status: "blocked",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      companyId,
      issueId,
      kind: "agent_meeting",
      status: "pending",
      continuationPolicy: "wake_assignee",
      idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
      title: "Work meeting: PAP-4",
      summary: "Issue is blocked, but no first-class blocker edge exists.",
      createdAt: staleAt,
      updatedAt: staleAt,
      payload: {
        version: 1,
        purpose: "Issue is blocked, but no first-class blocker edge exists.",
        participantAgentIds: [agentId],
        agenda: ["Review the stale meeting."],
        expectedOutputs: ["decisions"],
        contextMarkdown: null,
      },
    });

    const reconciled = await interactionsSvc.reconcileMeetingWorkflow(companyId);

    expect(reconciled.cancelledUnrunnable).toBe(1);
    expect(reconciled.meetings).toEqual([]);
    const [row] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interactionId));
    expect(row).toMatchObject({
      status: "cancelled",
      resolvedByAgentId: null,
      resolvedByUserId: null,
    });
  });

  it("auto-resolves stale first-class workflow meetings when a pending non-meeting interaction already owns next action", async () => {
    const companyId = randomUUID();
    const chairAgentId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const meetingId = randomUUID();
    const staleUpdatedAt = new Date(Date.now() - 60 * 60 * 1000);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Superseded first-class meeting",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values({
      id: chairAgentId,
      companyId,
      name: "CTO",
      role: "cto",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Blocked issue with explicit next action",
      status: "blocked",
      priority: "medium",
      assigneeAgentId: chairAgentId,
    });
    await db.insert(issueThreadInteractions).values({
      id: randomUUID(),
      companyId,
      issueId,
      kind: "ask_user_questions",
      status: "pending",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        questions: [{
          id: "publish_path",
          prompt: "Which publish path will you provide?",
          selectionMode: "single",
          options: [{
            id: "scheduler",
            label: "Connected scheduler",
            description: "Board will provide scheduler access.",
          }],
        }],
      },
    });
    await db.insert(meetings).values({
      id: meetingId,
      companyId,
      sourceIssueId: issueId,
      title: "Blocked work: covered by board question",
      purpose: "Issue is blocked, but no first-class blocker edge exists.",
      status: "pending",
      chairAgentId,
      idempotencyKey: `meeting-workflow:blocked_without_edge:${issueId}`,
      agenda: ["Review the stale meeting."],
      expectedOutputs: ["decisions"],
      updatedAt: staleUpdatedAt,
    });
    await db.insert(meetingParticipants).values({
      companyId,
      meetingId,
      agentId: chairAgentId,
      role: "chair",
      status: "pending",
    });

    const reconciled = await meetingService(db).reconcilePendingWorkflowWakeups(companyId);

    expect(reconciled.meetings).toEqual([]);
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    expect(meeting).toMatchObject({
      status: "answered",
    });
    expect((meeting?.result as any)?.summaryMarkdown).toContain("pending non-meeting interaction or approval");
    const [participant] = await db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, meetingId));
    expect(participant).toMatchObject({ status: "answered" });
  });
});
