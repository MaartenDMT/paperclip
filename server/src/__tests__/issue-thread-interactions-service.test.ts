import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  documentRevisions,
  documents,
  goals,
  heartbeatRuns,
  issueDocuments,
  instanceSettings,
  issueRelations,
  issueThreadInteractions,
  issues,
  meetingIssueLinks,
  meetingParticipants,
  meetings,
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
    await db.delete(meetingIssueLinks);
    await db.delete(meetingParticipants);
    await db.delete(meetings);
    await db.delete(issueThreadInteractions);
    await db.delete(activityLog);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issueRelations);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
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
    const participants = await db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, rows[0]!.id));
    expect(participants.map((participant) => participant.agentId)).toEqual(
      expect.arrayContaining([ceoId, engineeringHeadId, marketingHeadId, engineerId, marketerId]),
    );
    expect(rows[0]!.expectedOutputs).toEqual([
      "goals",
      "kpis",
      "right_track",
      "questions",
      "process",
    ]);
    expect(rows[0]!.agenda).toEqual(expect.arrayContaining([
      expect.stringContaining("goal and target"),
      expect.stringContaining("KPI"),
      expect.stringContaining("workflow"),
    ]));
    expect(rows[0]!.contextMarkdown).toContain("Business review focus");
    expect(rows[0]!.contextMarkdown).toContain("financial or budget impact");
    const links = await db.select().from(meetingIssueLinks).where(eq(meetingIssueLinks.meetingId, rows[0]!.id));
    expect(links).toEqual([
      expect.objectContaining({ issueId, linkKind: "source" }),
    ]);

    const duplicate = await interactionsSvc.reconcileMeetingWorkflow(companyId);
    expect(duplicate.created).toBe(0);

    const answered = await meetingService(db).respond(rows[0]!.id, {
      meetingResult: {
        version: 1,
        summaryMarkdown: "Launch plan reviewed; marketing follow-up remains.",
        decisions: ["Keep the launch plan in review until marketing notes are ready."],
        actionItems: [{ title: "Finish marketing notes", ownerAgentId: marketerId, issueId: childIssueId }],
        blockers: [],
        openQuestions: [],
        rightTrack: { status: "at_risk", rationale: "Review is stale without cross-functional notes.", corrections: ["Attach marketing notes before approval."] },
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
      status: "answered",
      resolvedByAgentId: null,
      resolvedByUserId: null,
    });
    expect(rows[0]!.result).toMatchObject({
      version: 1,
      decisions: ["Source issue is already done; no live meeting remains."],
      actionItems: [],
      blockers: [],
      openQuestions: [],
    });
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
    expect(reconciled.meetings).toEqual([{
      id: interactionId,
      issueId,
      participantAgentIds: [agentId],
      chairAgentId: agentId,
    }]);
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
});
