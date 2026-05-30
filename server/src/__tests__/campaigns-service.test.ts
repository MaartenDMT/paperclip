import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  approvals,
  campaignPhases,
  campaignProjects,
  campaigns,
  companies,
  createDb,
  documentRevisions,
  documents,
  goals,
  issues,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { approvalService } from "../services/approvals.js";
import { campaignService } from "../services/campaigns.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres campaign service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("campaignService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-campaigns-service-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(approvals);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(campaignPhases);
    await db.delete(campaignProjects);
    await db.delete(campaigns);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedFixture() {
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const agentId = randomUUID();
    const productionProjectId = randomUUID();
    const socialProjectId = randomUUID();
    const otherCompanyProjectId = randomUUID();

    await db.insert(companies).values([
      {
        id: companyId,
        name: "Readerbase",
        issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      },
      {
        id: otherCompanyId,
        name: "Other company",
        issuePrefix: `T${otherCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      },
    ]);

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Zinc",
      role: "creative_director",
      title: "Creative Director",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(projects).values([
      {
        id: productionProjectId,
        companyId,
        name: "Production",
        description: "Production work",
        status: "in_progress",
        color: "#2563eb",
      },
      {
        id: socialProjectId,
        companyId,
        name: "Social",
        description: "Social work",
        status: "planned",
        color: "#16a34a",
      },
      {
        id: otherCompanyProjectId,
        companyId: otherCompanyId,
        name: "Other project",
        description: null,
        status: "planned",
      },
    ]);

    const svc = campaignService(db);
    const actor = { userId: "board-user" };

    return {
      actor,
      agentId,
      companyId,
      otherCompanyId,
      otherCompanyProjectId,
      productionProjectId,
      socialProjectId,
      svc,
    };
  }

  it("creates a company-scoped campaign with linked projects", async () => {
    const { actor, agentId, companyId, productionProjectId, socialProjectId, svc } = await seedFixture();

    const created = await svc.create(
      companyId,
      {
        title: "Readerbase fantasy world",
        objective: "Build a deeply intertwined fantasy setting.",
        leadAgentId: agentId,
        goalId: null,
        status: "draft",
        projectIds: [productionProjectId, socialProjectId],
      },
      actor,
    );

    const detail = await svc.getDetail(created.id);

    expect(created.companyId).toBe(companyId);
    expect(detail?.projects.map((project) => project.id).sort()).toEqual(
      [productionProjectId, socialProjectId].sort(),
    );
    expect(detail?.leadAgent).toMatchObject({ id: agentId, name: "Zinc" });
    expect(detail?.phaseCount).toBe(0);
    expect(detail?.pendingReviewCount).toBe(0);
  });

  it("rejects project links from another company", async () => {
    const { actor, companyId, otherCompanyProjectId, svc } = await seedFixture();

    await expect(
      svc.create(
        companyId,
        {
          title: "Cross tenant",
          objective: null,
          leadAgentId: null,
          goalId: null,
          status: "draft",
          projectIds: [otherCompanyProjectId],
        },
        actor,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("creates phases with increasing sequence numbers", async () => {
    const { actor, agentId, companyId, productionProjectId, svc } = await seedFixture();
    const campaign = await svc.create(
      companyId,
      {
        title: "Readerbase fantasy world",
        objective: null,
        leadAgentId: agentId,
        goalId: null,
        status: "draft",
        projectIds: [productionProjectId],
      },
      actor,
    );

    const first = await svc.createPhase(
      companyId,
      campaign.id,
      {
        title: "Magical jobs",
        objective: "Define mage jobs and why each belongs.",
        assigneeAgentId: agentId,
        planBody: "## Plan\n\n- Research guild roles\n- Propose jobs",
      },
      actor,
    );
    const second = await svc.createPhase(
      companyId,
      campaign.id,
      {
        title: "Regional conflicts",
        objective: null,
        assigneeAgentId: null,
      },
      actor,
    );

    expect(first).toMatchObject({
      sequenceNumber: 1,
      status: "planning",
      assigneeAgentId: agentId,
      planDocumentId: expect.any(String),
      planDocument: expect.objectContaining({
        title: "Readerbase fantasy world: Magical jobs plan",
        latestBody: "## Plan\n\n- Research guild roles\n- Propose jobs",
        latestRevisionNumber: 1,
      }),
    });
    expect(second).toMatchObject({
      sequenceNumber: 2,
      assigneeAgentId: agentId,
      planDocument: null,
    });
    await expect(svc.listPhases(companyId, campaign.id)).resolves.toHaveLength(2);
  });

  it("links an existing same-company issue as a phase execution issue", async () => {
    const { actor, agentId, companyId, productionProjectId, svc } = await seedFixture();
    const campaign = await svc.create(
      companyId,
      {
        title: "Readerbase fantasy world",
        objective: null,
        leadAgentId: agentId,
        goalId: null,
        status: "draft",
        projectIds: [productionProjectId],
      },
      actor,
    );
    const phase = await svc.createPhase(
      companyId,
      campaign.id,
      {
        title: "Live author setup",
        assigneeAgentId: agentId,
      },
      actor,
    );
    const [issue] = await db
      .insert(issues)
      .values({
        companyId,
        projectId: productionProjectId,
        title: "Create World Vault",
        status: "todo",
        priority: "high",
        identifier: "REA-9999",
        issueNumber: 9999,
      })
      .returning();

    const linked = await svc.linkExecutionIssue(companyId, phase.id, { issueId: issue!.id }, actor);

    expect(linked.executionIssueId).toBe(issue!.id);
    expect(linked.executionIssue).toMatchObject({
      id: issue!.id,
      identifier: "REA-9999",
      title: "Create World Vault",
      status: "todo",
      priority: "high",
    });
  });

  it("submits a phase plan for review with a campaign_phase_plan approval", async () => {
    const { actor, agentId, companyId, productionProjectId, svc } = await seedFixture();
    const campaign = await svc.create(
      companyId,
      {
        title: "Readerbase fantasy world",
        objective: null,
        leadAgentId: agentId,
        goalId: null,
        status: "draft",
        projectIds: [productionProjectId],
      },
      actor,
    );
    const phase = await svc.createPhase(
      companyId,
      campaign.id,
      {
        title: "Magical jobs",
        objective: "Define mage jobs and why each belongs.",
        assigneeAgentId: agentId,
        planBody: "## Plan\n\n- Research guild roles\n- Propose jobs",
      },
      actor,
    );

    const submission = await svc.submitPlanForReview(
      companyId,
      phase.id,
      { decisionNote: "Ready for board review." },
      actor,
    );

    expect(submission.phase.status).toBe("in_review");
    expect(submission.phase.approvalId).toBe(submission.approval.id);
    expect(submission.approval).toMatchObject({
      companyId,
      type: "campaign_phase_plan",
      requestedByUserId: "board-user",
      status: "pending",
    });
    expect(submission.approval.payload).toMatchObject({
      kind: "campaign_phase_plan",
      campaignId: campaign.id,
      campaignTitle: "Readerbase fantasy world",
      phaseId: phase.id,
      phaseTitle: "Magical jobs",
      planDocumentId: phase.planDocumentId,
      planRevisionId: submission.planRevision.id,
      assigneeAgentId: agentId,
      projectIds: [productionProjectId],
    });
  });

  it("does not create another approval when a phase plan is already in review", async () => {
    const { actor, agentId, companyId, productionProjectId, svc } = await seedFixture();
    const campaign = await svc.create(
      companyId,
      {
        title: "Readerbase fantasy world",
        objective: null,
        leadAgentId: agentId,
        goalId: null,
        status: "draft",
        projectIds: [productionProjectId],
      },
      actor,
    );
    const phase = await svc.createPhase(
      companyId,
      campaign.id,
      {
        title: "Magical jobs",
        objective: "Define mage jobs and why each belongs.",
        assigneeAgentId: agentId,
        planBody: "## Plan\n\n- Research guild roles\n- Propose jobs",
      },
      actor,
    );

    const first = await svc.submitPlanForReview(companyId, phase.id, {}, actor);
    await expect(svc.submitPlanForReview(companyId, phase.id, {}, actor)).rejects.toMatchObject({
      status: 409,
    });

    const approvalRows = await db.select().from(approvals).where(eq(approvals.companyId, companyId));
    expect(approvalRows).toHaveLength(1);
    expect(approvalRows[0]?.id).toBe(first.approval.id);
  });

  it("marks a phase approved when its campaign phase plan approval is approved", async () => {
    const { actor, agentId, companyId, productionProjectId, svc } = await seedFixture();
    const campaign = await svc.create(
      companyId,
      {
        title: "Readerbase fantasy world",
        objective: null,
        leadAgentId: agentId,
        goalId: null,
        status: "draft",
        projectIds: [productionProjectId],
      },
      actor,
    );
    const phase = await svc.createPhase(
      companyId,
      campaign.id,
      {
        title: "Magical jobs",
        objective: null,
        assigneeAgentId: agentId,
        planBody: "## Plan\n\n- Propose jobs",
      },
      actor,
    );
    const submission = await svc.submitPlanForReview(companyId, phase.id, {}, actor);

    const result = await approvalService(db).approve(submission.approval.id, "board", "Approved");
    const approvedPhase = await svc.getPhase(phase.id);

    expect(result.applied).toBe(true);
    expect(result.approval.status).toBe("approved");
    expect(approvedPhase).toMatchObject({
      status: "approved",
      approvalId: submission.approval.id,
      approvedPlanRevisionId: submission.planRevision.id,
    });
  });

  it("creates one execution issue when a campaign phase plan approval is approved", async () => {
    const { actor, agentId, companyId, productionProjectId, svc } = await seedFixture();
    const goalId = randomUUID();
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Grow Readerbase",
      level: "company",
      status: "active",
    });
    const campaign = await svc.create(
      companyId,
      {
        title: "Readerbase fantasy world",
        objective: "Build a deeply intertwined fantasy setting.",
        leadAgentId: agentId,
        goalId,
        status: "draft",
        projectIds: [productionProjectId],
      },
      actor,
    );
    const phase = await svc.createPhase(
      companyId,
      campaign.id,
      {
        title: "Magical jobs",
        objective: "Define mage jobs and why each belongs.",
        assigneeAgentId: agentId,
        planBody: "## Plan\n\n- Research guild roles\n- Propose jobs",
      },
      actor,
    );
    const submission = await svc.submitPlanForReview(companyId, phase.id, {}, actor);

    await approvalService(db).approve(submission.approval.id, "board", "Approved");
    const firstApprovalResult = await svc.handleApprovalApproved(submission.approval.id, actor);
    const createdIssueId = firstApprovalResult?.executionIssueId;
    await svc.handleApprovalApproved(submission.approval.id, actor);

    const issueRows = await db.select().from(issues).where(eq(issues.companyId, companyId));
    const approvedPhase = await svc.getPhase(phase.id);

    expect(createdIssueId).toEqual(expect.any(String));
    expect(approvedPhase).toMatchObject({
      status: "approved",
      approvedPlanRevisionId: submission.planRevision.id,
      executionIssueId: createdIssueId,
    });
    expect(issueRows).toHaveLength(1);
    expect(issueRows[0]).toMatchObject({
      id: createdIssueId,
      companyId,
      projectId: productionProjectId,
      goalId,
      assigneeAgentId: agentId,
      status: "todo",
      priority: "medium",
      originKind: "campaign_phase_execution",
      originId: phase.id,
      originFingerprint: submission.planRevision.id,
      createdByUserId: "board",
    });
    expect(issueRows[0]?.title).toContain("Readerbase fantasy world");
    expect(issueRows[0]?.title).toContain("Magical jobs");
    expect(issueRows[0]?.description).toContain(submission.planRevision.id);
    expect(issueRows[0]?.description).toContain(phase.id);
  });

  it("creates one execution issue when campaign phase approval hooks race", async () => {
    const { actor, agentId, companyId, productionProjectId, svc } = await seedFixture();
    const campaign = await svc.create(
      companyId,
      {
        title: "Readerbase fantasy world",
        objective: "Build a deeply intertwined fantasy setting.",
        leadAgentId: agentId,
        goalId: null,
        status: "draft",
        projectIds: [productionProjectId],
      },
      actor,
    );
    const phase = await svc.createPhase(
      companyId,
      campaign.id,
      {
        title: "Magical jobs",
        objective: "Define mage jobs and why each belongs.",
        assigneeAgentId: agentId,
        planBody: "## Plan\n\n- Research guild roles\n- Propose jobs",
      },
      actor,
    );
    const submission = await svc.submitPlanForReview(companyId, phase.id, {}, actor);
    await db
      .update(approvals)
      .set({
        status: "approved",
        decidedByUserId: "board",
        decidedAt: new Date(),
      })
      .where(eq(approvals.id, submission.approval.id));

    const results = await Promise.all([
      svc.handleApprovalApproved(submission.approval.id, actor),
      svc.handleApprovalApproved(submission.approval.id, actor),
    ]);

    const issueRows = await db.select().from(issues).where(eq(issues.companyId, companyId));
    const approvedPhase = await svc.getPhase(phase.id);
    const executionIssueIds = results.map((result) => result?.executionIssueId);

    expect(new Set(executionIssueIds)).toHaveProperty("size", 1);
    expect(issueRows).toHaveLength(1);
    expect(approvedPhase?.executionIssueId).toBe(issueRows[0]?.id);
    expect(issueRows[0]).toMatchObject({
      companyId,
      originKind: "campaign_phase_execution",
      originId: phase.id,
    });
  });

  it("does not downgrade an advanced campaign phase on approval retry", async () => {
    const { actor, agentId, companyId, productionProjectId, svc } = await seedFixture();
    const campaign = await svc.create(
      companyId,
      {
        title: "Readerbase fantasy world",
        objective: "Build a deeply intertwined fantasy setting.",
        leadAgentId: agentId,
        goalId: null,
        status: "draft",
        projectIds: [productionProjectId],
      },
      actor,
    );
    const phase = await svc.createPhase(
      companyId,
      campaign.id,
      {
        title: "Magical jobs",
        objective: "Define mage jobs and why each belongs.",
        assigneeAgentId: agentId,
        planBody: "## Plan\n\n- Research guild roles\n- Propose jobs",
      },
      actor,
    );
    const submission = await svc.submitPlanForReview(companyId, phase.id, {}, actor);
    await approvalService(db).approve(submission.approval.id, "board", "Approved");
    await svc.updatePhase(companyId, phase.id, { status: "executing" }, actor);

    const retried = await approvalService(db).approve(submission.approval.id, "board", "Approved again");
    const issueRows = await db.select().from(issues).where(eq(issues.companyId, companyId));

    expect(retried.applied).toBe(false);
    await expect(svc.getPhase(phase.id)).resolves.toMatchObject({
      status: "executing",
      approvedPlanRevisionId: submission.planRevision.id,
      executionIssueId: issueRows[0]?.id,
    });
    expect(issueRows).toHaveLength(1);
  });

  it("moves rejected and revision-requested campaign phase plan approvals to revision_requested", async () => {
    const { actor, agentId, companyId, productionProjectId, svc } = await seedFixture();
    const campaign = await svc.create(
      companyId,
      {
        title: "Readerbase fantasy world",
        objective: null,
        leadAgentId: agentId,
        goalId: null,
        status: "draft",
        projectIds: [productionProjectId],
      },
      actor,
    );
    const rejectedPhase = await svc.createPhase(
      companyId,
      campaign.id,
      {
        title: "Magical jobs",
        objective: null,
        assigneeAgentId: agentId,
        planBody: "## Plan\n\n- Propose jobs",
      },
      actor,
    );
    const revisionPhase = await svc.createPhase(
      companyId,
      campaign.id,
      {
        title: "Regional conflicts",
        objective: null,
        assigneeAgentId: agentId,
        planBody: "## Plan\n\n- Draft conflicts",
      },
      actor,
    );
    const rejectedSubmission = await svc.submitPlanForReview(companyId, rejectedPhase.id, {}, actor);
    const revisionSubmission = await svc.submitPlanForReview(companyId, revisionPhase.id, {}, actor);

    await approvalService(db).reject(rejectedSubmission.approval.id, "board", "Needs a rewrite");
    await approvalService(db).requestRevision(
      revisionSubmission.approval.id,
      "board",
      "Explain economic impacts",
    );

    await expect(svc.getPhase(rejectedPhase.id)).resolves.toMatchObject({
      status: "revision_requested",
      approvalId: rejectedSubmission.approval.id,
      approvedPlanRevisionId: null,
      executionIssueId: null,
    });
    await expect(svc.getPhase(revisionPhase.id)).resolves.toMatchObject({
      status: "revision_requested",
      approvalId: revisionSubmission.approval.id,
      approvedPlanRevisionId: null,
      executionIssueId: null,
    });
  });

  it("uses standalone document updates for editable phase plans", async () => {
    const { actor, agentId, companyId, productionProjectId, svc } = await seedFixture();
    const campaign = await svc.create(
      companyId,
      {
        title: "Readerbase fantasy world",
        objective: null,
        leadAgentId: agentId,
        goalId: null,
        status: "draft",
        projectIds: [productionProjectId],
      },
      actor,
    );
    const phase = await svc.createPhase(
      companyId,
      campaign.id,
      {
        title: "Magical jobs",
        objective: null,
        assigneeAgentId: agentId,
        planBody: "## Plan\n\n- Propose jobs",
      },
      actor,
    );

    const updated = await svc.upsertPhasePlan(
      companyId,
      phase.id,
      {
        body: "## Plan\n\n- Propose jobs\n- Add guild economics",
        changeSummary: "Added economics",
      },
      actor,
    );

    expect(updated).toMatchObject({
      id: phase.planDocumentId,
      latestBody: "## Plan\n\n- Propose jobs\n- Add guild economics",
      latestRevisionNumber: 2,
    });
  });

  it("rejects cross-company phase plan updates and submissions", async () => {
    const { actor, agentId, companyId, otherCompanyId, productionProjectId, svc } = await seedFixture();
    const campaign = await svc.create(
      companyId,
      {
        title: "Readerbase fantasy world",
        objective: null,
        leadAgentId: agentId,
        goalId: null,
        status: "draft",
        projectIds: [productionProjectId],
      },
      actor,
    );
    const phase = await svc.createPhase(
      companyId,
      campaign.id,
      {
        title: "Magical jobs",
        objective: null,
        assigneeAgentId: agentId,
        planBody: "## Plan\n\n- Propose jobs",
      },
      actor,
    );

    await expect(
      svc.upsertPhasePlan(
        otherCompanyId,
        phase.id,
        {
          body: "## Plan\n\n- Cross-company rewrite",
          changeSummary: "Unauthorized rewrite",
        },
        actor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(svc.submitPlanForReview(otherCompanyId, phase.id, {}, actor)).rejects.toMatchObject({
      status: 404,
    });

    await expect(svc.getPhase(phase.id)).resolves.toMatchObject({
      status: "planning",
      approvalId: null,
    });
    const detail = await svc.getDetail(campaign.id);
    expect(detail?.phases[0]?.planDocument).toMatchObject({
      latestBody: "## Plan\n\n- Propose jobs",
      latestRevisionNumber: 1,
    });
  });

  it("rejects cross-company mutations against existing campaigns", async () => {
    const { actor, agentId, companyId, otherCompanyId, productionProjectId, socialProjectId, svc } =
      await seedFixture();
    const campaign = await svc.create(
      companyId,
      {
        title: "Readerbase fantasy world",
        objective: null,
        leadAgentId: agentId,
        goalId: null,
        status: "draft",
        projectIds: [productionProjectId],
      },
      actor,
    );

    await expect(svc.replaceProjects(otherCompanyId, campaign.id, [socialProjectId])).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      svc.update(otherCompanyId, campaign.id, { title: "Other company rewrite" }, actor),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      svc.createPhase(
        otherCompanyId,
        campaign.id,
        {
          title: "Unauthorized phase",
          objective: null,
          assigneeAgentId: null,
        },
        actor,
      ),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(svc.listPhases(otherCompanyId, campaign.id)).rejects.toMatchObject({
      status: 404,
    });

    await expect(svc.getDetail(campaign.id)).resolves.toMatchObject({
      title: "Readerbase fantasy world",
      projects: [expect.objectContaining({ id: productionProjectId })],
      phases: [],
    });
  });
});
