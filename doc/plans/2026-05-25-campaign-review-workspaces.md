# Campaign Review Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Work section called Campaigns where board operators can supervise large, multi-phase agent work across one or more projects, approve each phase plan once, and let agents execute the approved phase without another approval step.

**Architecture:** Campaigns are company-scoped work-management objects that can link to many existing projects. Each campaign owns ordered phases; each phase has a reviewable markdown plan document, an optional result document, an approval link, and an execution issue created automatically when the phase plan is approved. This keeps campaigns in the Work navigation while reusing Paperclip's existing documents, approvals, issues, company access checks, and activity log.

**Tech Stack:** TypeScript, Express, Drizzle/PostgreSQL, Zod validators in `@paperclipai/shared`, React + Vite + TanStack Query, Vitest, embedded PostgreSQL route/service tests.

---

## Product Model

Campaigns are not Projects. Projects remain operating domains like Production, Remotion, and Social Media. Campaigns live under Work and can coordinate inside one project or across several projects.

The intended board flow:

1. Board creates a campaign with title, objective, lead agent, and one or more linked projects.
2. Board or agent creates a campaign phase.
3. Agent writes the phase plan as a markdown document.
4. Board approves, requests revision, rejects, or edits the plan.
5. Approval creates the execution issue and marks the phase ready/executing.
6. Agent works the generated issue.
7. Phase completion stores a result document and allows the next phase plan to be created.

Approval is the only gate before execution. Once the plan is approved, no second "start work" approval is required.

## File Structure

### Database

- Create `packages/db/src/schema/campaigns.ts`
  - `campaigns`
  - `campaignProjects`
  - `campaignPhases`
- Modify `packages/db/src/schema/index.ts`
  - export the three new tables.
- Generate migration in `packages/db/src/migrations/`
  - created by `pnpm db:generate`.

### Shared Contracts

- Modify `packages/shared/src/constants.ts`
  - add campaign status constants and extend approval/activity entity tables if needed.
- Create `packages/shared/src/types/campaign.ts`
  - public Campaign, CampaignDetail, CampaignPhase, CampaignProjectSummary, and request helper types.
- Create `packages/shared/src/validators/campaign.ts`
  - create/update campaign schemas.
  - create/update phase schemas.
  - create plan/revision/approve request schemas.
- Modify `packages/shared/src/types/index.ts`
  - export campaign types.
- Modify `packages/shared/src/validators/index.ts`
  - export campaign validators.
- Modify `packages/shared/src/index.ts`
  - export campaign contract entry points if this package uses barrel exports for new domains.

### Server

- Create `server/src/services/campaigns.ts`
  - data access, ownership checks, document creation, phase state transitions, approval creation, approval decision side effects, execution issue creation.
- Modify `server/src/services/index.ts`
  - export `campaignService`.
- Create `server/src/routes/campaigns.ts`
  - REST endpoints.
- Modify `server/src/routes/approvals.ts`
  - after an approval is approved/revision-requested/rejected, delegate campaign approval side effects when `approval.type === "campaign_phase_plan"`.
- Modify `server/src/app.ts`
  - mount campaign routes under `/api`.
- Modify `server/src/services/companies.ts`
  - include campaign tables in company deletion cleanup only if cascade is not enough.

### UI

- Create `ui/src/api/campaigns.ts`
  - REST client for campaign endpoints.
- Modify `ui/src/api/index.ts`
  - export `campaignsApi`.
- Modify `ui/src/lib/queryKeys.ts`
  - add campaign list/detail/phase/document keys.
- Create `ui/src/pages/Campaigns.tsx`
  - Work section list page with composer, filters, and project grouping.
- Create `ui/src/pages/CampaignDetail.tsx`
  - campaign overview, linked projects, phase timeline, current plan review panel, execution issue link.
- Create `ui/src/components/NewCampaignDialog.tsx`
  - title/objective/lead/projects creation dialog.
- Create `ui/src/components/CampaignPhaseComposer.tsx`
  - create/edit phase and plan document panel.
- Create `ui/src/components/CampaignPhaseTimeline.tsx`
  - ordered phase list with status, approval, execution issue, and result indicators.
- Modify `ui/src/App.tsx`
  - add `/campaigns` and `/campaigns/:campaignId` routes.
- Modify `ui/src/components/Sidebar.tsx`
  - add Campaigns under Work, not Projects.
- Modify `ui/src/components/MobileBottomNav.tsx`
  - add Campaigns only if the existing mobile nav can fit; otherwise keep desktop sidebar only for the first implementation.
- Modify `ui/src/components/ActivityRow.tsx`
  - route campaign/campaign_phase activity to campaign detail.
- Modify `ui/src/components/ApprovalPayload.tsx`
  - render campaign phase plan approvals with campaign/phase/plan context.

### Tests

- Create `server/src/__tests__/campaigns-service.test.ts`
- Create `server/src/__tests__/campaigns-routes.test.ts`
- Modify or add `server/src/__tests__/approval-routes-idempotency.test.ts`
- Create `ui/src/pages/Campaigns.test.tsx`
- Create `ui/src/pages/CampaignDetail.test.tsx`
- Modify `ui/src/components/Sidebar.test.tsx`
- Modify `ui/src/components/ApprovalPayload.test.tsx`

---

## Data Contract

### Tables

`campaigns`

```ts
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    leadAgentId: uuid("lead_agent_id").references(() => agents.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    objective: text("objective"),
    status: text("status").notNull().default("draft"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    updatedByAgentId: uuid("updated_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    updatedByUserId: text("updated_by_user_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("campaigns_company_status_idx").on(table.companyId, table.status),
    companyLeadIdx: index("campaigns_company_lead_idx").on(table.companyId, table.leadAgentId),
  }),
);
```

`campaign_projects`

```ts
export const campaignProjects = pgTable(
  "campaign_projects",
  {
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.campaignId, table.projectId], name: "campaign_projects_pk" }),
    companyIdx: index("campaign_projects_company_idx").on(table.companyId),
    projectIdx: index("campaign_projects_project_idx").on(table.projectId),
  }),
);
```

`campaign_phases`

```ts
export const campaignPhases = pgTable(
  "campaign_phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    sequenceNumber: integer("sequence_number").notNull(),
    title: text("title").notNull(),
    objective: text("objective"),
    status: text("status").notNull().default("planning"),
    planDocumentId: uuid("plan_document_id").references(() => documents.id, { onDelete: "set null" }),
    resultDocumentId: uuid("result_document_id").references(() => documents.id, { onDelete: "set null" }),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    approvedPlanRevisionId: uuid("approved_plan_revision_id").references(() => documentRevisions.id, { onDelete: "set null" }),
    executionIssueId: uuid("execution_issue_id").references(() => issues.id, { onDelete: "set null" }),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    updatedByAgentId: uuid("updated_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    updatedByUserId: text("updated_by_user_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campaignSequenceUq: uniqueIndex("campaign_phases_campaign_sequence_uq").on(table.campaignId, table.sequenceNumber),
    companyStatusIdx: index("campaign_phases_company_status_idx").on(table.companyId, table.status),
    campaignIdx: index("campaign_phases_campaign_idx").on(table.campaignId),
    approvalIdx: index("campaign_phases_approval_idx").on(table.approvalId),
    executionIssueIdx: index("campaign_phases_execution_issue_idx").on(table.executionIssueId),
  }),
);
```

### Statuses

Campaign statuses:

```ts
export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed", "cancelled", "archived"] as const;
```

Campaign phase statuses:

```ts
export const CAMPAIGN_PHASE_STATUSES = [
  "planning",
  "in_review",
  "revision_requested",
  "approved",
  "executing",
  "completed",
  "cancelled",
] as const;
```

Approval type:

```ts
"campaign_phase_plan"
```

The approval payload shape:

```ts
export interface CampaignPhasePlanApprovalPayload {
  kind: "campaign_phase_plan";
  campaignId: string;
  campaignTitle: string;
  phaseId: string;
  phaseTitle: string;
  planDocumentId: string;
  planRevisionId: string;
  assigneeAgentId: string | null;
  projectIds: string[];
}
```

---

## Task 1: Add Shared Campaign Constants And Types

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Create: `packages/shared/src/types/campaign.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add constants**

Add these exports to `packages/shared/src/constants.ts` near existing work/status constants:

```ts
export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed", "cancelled", "archived"] as const;
export type CampaignStatus = typeof CAMPAIGN_STATUSES[number];

export const CAMPAIGN_PHASE_STATUSES = [
  "planning",
  "in_review",
  "revision_requested",
  "approved",
  "executing",
  "completed",
  "cancelled",
] as const;
export type CampaignPhaseStatus = typeof CAMPAIGN_PHASE_STATUSES[number];
```

If `APPROVAL_TYPES` exists as a literal array, add `"campaign_phase_plan"` to it. If approval types are currently loose strings, keep the status constants only and type the payload in `campaign.ts`.

- [ ] **Step 2: Create campaign types**

Create `packages/shared/src/types/campaign.ts`:

```ts
import type { CampaignPhaseStatus, CampaignStatus } from "../constants.js";
import type { Approval } from "./approval.js";
import type { DocumentRevision } from "./issue.js";

export interface CampaignProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  color: string | null;
}

export interface CampaignAgentSummary {
  id: string;
  name: string;
  role: string;
  title: string | null;
  icon?: string | null;
  urlKey?: string | null;
}

export interface CampaignIssueSummary {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string;
  updatedAt: Date;
}

export interface CampaignDocumentSummary {
  id: string;
  title: string | null;
  format: "markdown";
  latestBody: string;
  latestRevisionId: string | null;
  latestRevisionNumber: number;
  updatedAt: Date;
}

export interface Campaign {
  id: string;
  companyId: string;
  goalId: string | null;
  leadAgentId: string | null;
  title: string;
  objective: string | null;
  status: CampaignStatus;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  updatedByAgentId: string | null;
  updatedByUserId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignPhase {
  id: string;
  companyId: string;
  campaignId: string;
  sequenceNumber: number;
  title: string;
  objective: string | null;
  status: CampaignPhaseStatus;
  planDocumentId: string | null;
  resultDocumentId: string | null;
  approvalId: string | null;
  approvedPlanRevisionId: string | null;
  executionIssueId: string | null;
  assigneeAgentId: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  updatedByAgentId: string | null;
  updatedByUserId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignPhaseDetail extends CampaignPhase {
  assignee: CampaignAgentSummary | null;
  planDocument: CampaignDocumentSummary | null;
  resultDocument: CampaignDocumentSummary | null;
  approval: Approval | null;
  executionIssue: CampaignIssueSummary | null;
}

export interface CampaignListItem extends Campaign {
  projects: CampaignProjectSummary[];
  leadAgent: CampaignAgentSummary | null;
  phaseCount: number;
  activePhase: CampaignPhaseDetail | null;
  pendingReviewCount: number;
}

export interface CampaignDetail extends CampaignListItem {
  phases: CampaignPhaseDetail[];
}

export interface CampaignPhasePlanApprovalPayload {
  kind: "campaign_phase_plan";
  campaignId: string;
  campaignTitle: string;
  phaseId: string;
  phaseTitle: string;
  planDocumentId: string;
  planRevisionId: string;
  assigneeAgentId: string | null;
  projectIds: string[];
}

export interface CampaignPhasePlanSubmission {
  phase: CampaignPhaseDetail;
  approval: Approval;
  planRevision: DocumentRevision;
}
```

- [ ] **Step 3: Export campaign types**

Add this to `packages/shared/src/types/index.ts`:

```ts
export * from "./campaign.js";
```

If `packages/shared/src/index.ts` exports type barrels explicitly, add:

```ts
export * from "./types/campaign.js";
```

- [ ] **Step 4: Run shared type check**

Run:

```sh
pnpm --filter @paperclipai/shared build
```

Expected: compile errors only for validators not created yet if the package compiles all barrels together. If it fails because exports reference missing validators, continue to Task 2 before rerunning.

---

## Task 2: Add Shared Campaign Validators

**Files:**
- Create: `packages/shared/src/validators/campaign.ts`
- Modify: `packages/shared/src/validators/index.ts`

- [ ] **Step 1: Create validator file**

Create `packages/shared/src/validators/campaign.ts`:

```ts
import { z } from "zod";
import { CAMPAIGN_PHASE_STATUSES, CAMPAIGN_STATUSES, ISSUE_PRIORITIES } from "../constants.js";

export const createCampaignSchema = z.object({
  goalId: z.string().uuid().optional().nullable(),
  leadAgentId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  objective: z.string().trim().max(20_000).optional().nullable(),
  status: z.enum(CAMPAIGN_STATUSES).optional().default("draft"),
  projectIds: z.array(z.string().uuid()).max(50).optional().default([]),
});

export type CreateCampaign = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = createCampaignSchema.partial().extend({
  archivedAt: z.string().datetime().optional().nullable(),
});

export type UpdateCampaign = z.infer<typeof updateCampaignSchema>;

export const replaceCampaignProjectsSchema = z.object({
  projectIds: z.array(z.string().uuid()).max(50).default([]),
});

export type ReplaceCampaignProjects = z.infer<typeof replaceCampaignProjectsSchema>;

export const createCampaignPhaseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  objective: z.string().trim().max(20_000).optional().nullable(),
  sequenceNumber: z.number().int().positive().optional(),
  assigneeAgentId: z.string().uuid().optional().nullable(),
  planBody: z.string().max(200_000).optional().nullable(),
});

export type CreateCampaignPhase = z.infer<typeof createCampaignPhaseSchema>;

export const updateCampaignPhaseSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  objective: z.string().trim().max(20_000).optional().nullable(),
  sequenceNumber: z.number().int().positive().optional(),
  status: z.enum(CAMPAIGN_PHASE_STATUSES).optional(),
  assigneeAgentId: z.string().uuid().optional().nullable(),
});

export type UpdateCampaignPhase = z.infer<typeof updateCampaignPhaseSchema>;

export const upsertCampaignPhasePlanSchema = z.object({
  body: z.string().trim().min(1).max(200_000),
  changeSummary: z.string().trim().max(500).optional().nullable(),
});

export type UpsertCampaignPhasePlan = z.infer<typeof upsertCampaignPhasePlanSchema>;

export const submitCampaignPhasePlanForReviewSchema = z.object({
  decisionNote: z.string().trim().max(2_000).optional().nullable(),
});

export type SubmitCampaignPhasePlanForReview = z.infer<typeof submitCampaignPhasePlanForReviewSchema>;

export const approveCampaignPhasePlanSchema = z.object({
  decisionNote: z.string().trim().max(2_000).optional().nullable(),
  issueTitle: z.string().trim().min(1).max(200).optional(),
  issuePriority: z.enum(ISSUE_PRIORITIES).optional().default("medium"),
});

export type ApproveCampaignPhasePlan = z.infer<typeof approveCampaignPhasePlanSchema>;

export const completeCampaignPhaseSchema = z.object({
  resultBody: z.string().trim().max(200_000).optional().nullable(),
  resultTitle: z.string().trim().max(200).optional().nullable(),
});

export type CompleteCampaignPhase = z.infer<typeof completeCampaignPhaseSchema>;
```

- [ ] **Step 2: Export validators**

Add this to `packages/shared/src/validators/index.ts`:

```ts
export * from "./campaign.js";
```

- [ ] **Step 3: Run validator tests/build**

Run:

```sh
pnpm --filter @paperclipai/shared build
```

Expected: PASS.

---

## Task 3: Add Campaign Database Schema

**Files:**
- Create: `packages/db/src/schema/campaigns.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Add schema file**

Create `packages/db/src/schema/campaigns.ts` using the table definitions from the "Data Contract" section. Include imports:

```ts
import { index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { approvals } from "./approvals.js";
import { companies } from "./companies.js";
import { documentRevisions } from "./document_revisions.js";
import { documents } from "./documents.js";
import { goals } from "./goals.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";
```

- [ ] **Step 2: Export schema**

Add to `packages/db/src/schema/index.ts`:

```ts
export { campaigns, campaignProjects, campaignPhases } from "./campaigns.js";
```

- [ ] **Step 3: Build DB package**

Run:

```sh
pnpm --filter @paperclipai/db build
```

Expected: PASS.

- [ ] **Step 4: Generate migration**

Run:

```sh
pnpm db:generate
```

Expected: a new SQL migration and snapshot under `packages/db/src/migrations/`. Inspect the SQL and confirm:

- all three tables are created.
- all foreign keys include the expected delete behavior.
- `campaign_phases_campaign_sequence_uq` exists.
- no existing table is dropped or rewritten.

---

## Task 4: Implement Campaign Service Read/Write Core

**Files:**
- Create: `server/src/services/campaigns.ts`
- Modify: `server/src/services/index.ts`
- Test: `server/src/__tests__/campaigns-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `server/src/__tests__/campaigns-service.test.ts` with embedded DB setup following `server/src/__tests__/routines-service.test.ts`. Include these tests:

```ts
it("creates a company-scoped campaign with linked projects", async () => {
  const created = await svc.create(companyId, {
    title: "Readerbase fantasy world",
    objective: "Build a deeply intertwined fantasy setting.",
    leadAgentId: agentId,
    goalId: null,
    status: "draft",
    projectIds: [productionProjectId, socialProjectId],
  }, actor);

  const detail = await svc.getDetail(created.id);

  expect(created.companyId).toBe(companyId);
  expect(detail?.projects.map((project) => project.id).sort()).toEqual(
    [productionProjectId, socialProjectId].sort(),
  );
});

it("rejects project links from another company", async () => {
  await expect(
    svc.create(companyId, {
      title: "Cross tenant",
      objective: null,
      leadAgentId: null,
      goalId: null,
      status: "draft",
      projectIds: [otherCompanyProjectId],
    }, actor),
  ).rejects.toMatchObject({ status: 422 });
});

it("creates phases with increasing sequence numbers and plan documents", async () => {
  const phase = await svc.createPhase(campaignId, {
    title: "Magical jobs",
    objective: "Define mage jobs and why each belongs.",
    assigneeAgentId: agentId,
    planBody: "## Plan\n\n- Research guild roles\n- Propose jobs",
  }, actor);

  expect(phase.sequenceNumber).toBe(1);
  expect(phase.status).toBe("planning");
  expect(phase.planDocument?.latestBody).toContain("Research guild roles");
});
```

- [ ] **Step 2: Implement service skeleton**

Create `server/src/services/campaigns.ts`:

```ts
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import {
  agents,
  approvals,
  campaignPhases,
  campaignProjects,
  campaigns,
  documents,
  documentRevisions,
  issues,
  projects,
  type Db,
} from "@paperclipai/db";
import type {
  ApproveCampaignPhasePlan,
  CompleteCampaignPhase,
  CreateCampaign,
  CreateCampaignPhase,
  UpdateCampaign,
  UpdateCampaignPhase,
  UpsertCampaignPhasePlan,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { documentService } from "./documents.js";

type ActorInput = {
  agentId?: string | null;
  userId?: string | null;
  runId?: string | null;
};

export function campaignService(db: Db) {
  const documentsSvc = documentService(db);

  async function assertProjectOwnership(companyId: string, projectIds: string[]) {
    if (projectIds.length === 0) return;
    const rows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), inArray(projects.id, projectIds)));
    if (rows.length !== new Set(projectIds).size) {
      throw unprocessable("Campaign projects must belong to the same company");
    }
  }

  async function get(id: string) {
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    return row ?? null;
  }

  async function getPhase(id: string) {
    const [row] = await db.select().from(campaignPhases).where(eq(campaignPhases.id, id)).limit(1);
    return row ?? null;
  }

  return {
    get,
    getPhase,
    async list(companyId: string) {
      const rows = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.companyId, companyId))
        .orderBy(desc(campaigns.updatedAt));
      return Promise.all(rows.map((row) => this.hydrateListItem(row)));
    },
    async getDetail(id: string) {
      const row = await get(id);
      if (!row) return null;
      const item = await this.hydrateListItem(row);
      const phases = await this.listPhases(id);
      return { ...item, phases };
    },
    async hydrateListItem(row) {
      const projectRows = await db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          status: projects.status,
          color: projects.color,
        })
        .from(campaignProjects)
        .innerJoin(projects, eq(campaignProjects.projectId, projects.id))
        .where(eq(campaignProjects.campaignId, row.id))
        .orderBy(asc(projects.name));

      const phaseRows = await this.listPhases(row.id);
      const activePhase =
        phaseRows.find((phase) => ["in_review", "revision_requested", "approved", "executing"].includes(phase.status)) ??
        phaseRows[0] ??
        null;

      const leadAgent = row.leadAgentId
        ? await this.getAgentSummary(row.leadAgentId)
        : null;

      return {
        ...row,
        projects: projectRows,
        leadAgent,
        phaseCount: phaseRows.length,
        activePhase,
        pendingReviewCount: phaseRows.filter((phase) => phase.status === "in_review").length,
      };
    },
    async getAgentSummary(agentId: string) {
      const [row] = await db
        .select({
          id: agents.id,
          name: agents.name,
          role: agents.role,
          title: agents.title,
          icon: agents.icon,
          urlKey: agents.urlKey,
        })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);
      return row ?? null;
    },
    async create(companyId: string, data: CreateCampaign, actor: ActorInput) {
      await assertProjectOwnership(companyId, data.projectIds ?? []);
      const [created] = await db.transaction(async (tx) => {
        const [campaign] = await tx.insert(campaigns).values({
          companyId,
          goalId: data.goalId ?? null,
          leadAgentId: data.leadAgentId ?? null,
          title: data.title,
          objective: data.objective ?? null,
          status: data.status ?? "draft",
          createdByAgentId: actor.agentId ?? null,
          createdByUserId: actor.userId ?? null,
          updatedByAgentId: actor.agentId ?? null,
          updatedByUserId: actor.userId ?? null,
        }).returning();
        if ((data.projectIds ?? []).length > 0) {
          await tx.insert(campaignProjects).values([...new Set(data.projectIds)].map((projectId) => ({
            companyId,
            campaignId: campaign.id,
            projectId,
          })));
        }
        return [campaign];
      });
      return created;
    },
    async replaceProjects(campaignId: string, projectIds: string[]) {
      const campaign = await get(campaignId);
      if (!campaign) throw notFound("Campaign not found");
      await assertProjectOwnership(campaign.companyId, projectIds);
      await db.transaction(async (tx) => {
        await tx.delete(campaignProjects).where(eq(campaignProjects.campaignId, campaignId));
        if (projectIds.length > 0) {
          await tx.insert(campaignProjects).values([...new Set(projectIds)].map((projectId) => ({
            companyId: campaign.companyId,
            campaignId,
            projectId,
          })));
        }
        await tx.update(campaigns).set({ updatedAt: new Date() }).where(eq(campaigns.id, campaignId));
      });
      return this.getDetail(campaignId);
    },
    async update(campaignId: string, data: UpdateCampaign, actor: ActorInput) {
      const campaign = await get(campaignId);
      if (!campaign) throw notFound("Campaign not found");
      if (data.projectIds) await assertProjectOwnership(campaign.companyId, data.projectIds);
      await db.transaction(async (tx) => {
        await tx.update(campaigns).set({
          ...(data.goalId !== undefined ? { goalId: data.goalId } : {}),
          ...(data.leadAgentId !== undefined ? { leadAgentId: data.leadAgentId } : {}),
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.objective !== undefined ? { objective: data.objective } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.archivedAt !== undefined ? { archivedAt: data.archivedAt ? new Date(data.archivedAt) : null } : {}),
          updatedByAgentId: actor.agentId ?? null,
          updatedByUserId: actor.userId ?? null,
          updatedAt: new Date(),
        }).where(eq(campaigns.id, campaignId));
        if (data.projectIds) {
          await tx.delete(campaignProjects).where(eq(campaignProjects.campaignId, campaignId));
          if (data.projectIds.length > 0) {
            await tx.insert(campaignProjects).values([...new Set(data.projectIds)].map((projectId) => ({
              companyId: campaign.companyId,
              campaignId,
              projectId,
            })));
          }
        }
      });
      return this.getDetail(campaignId);
    },
    async listPhases(campaignId: string) {
      const rows = await db
        .select()
        .from(campaignPhases)
        .where(eq(campaignPhases.campaignId, campaignId))
        .orderBy(asc(campaignPhases.sequenceNumber));
      return Promise.all(rows.map((row) => this.hydratePhase(row)));
    },
    async hydratePhase(row) {
      const [planDocument] = row.planDocumentId
        ? await db.select().from(documents).where(eq(documents.id, row.planDocumentId)).limit(1)
        : [null];
      const [resultDocument] = row.resultDocumentId
        ? await db.select().from(documents).where(eq(documents.id, row.resultDocumentId)).limit(1)
        : [null];
      const [approval] = row.approvalId
        ? await db.select().from(approvals).where(eq(approvals.id, row.approvalId)).limit(1)
        : [null];
      const [executionIssue] = row.executionIssueId
        ? await db.select({
            id: issues.id,
            identifier: issues.identifier,
            title: issues.title,
            status: issues.status,
            priority: issues.priority,
            updatedAt: issues.updatedAt,
          }).from(issues).where(eq(issues.id, row.executionIssueId)).limit(1)
        : [null];
      const assignee = row.assigneeAgentId ? await this.getAgentSummary(row.assigneeAgentId) : null;
      return { ...row, planDocument, resultDocument, approval, executionIssue, assignee };
    },
    async createPhase(campaignId: string, data: CreateCampaignPhase, actor: ActorInput) {
      const campaign = await get(campaignId);
      if (!campaign) throw notFound("Campaign not found");
      const [{ value: maxSequence } = { value: 0 }] = await db
        .select({ value: max(campaignPhases.sequenceNumber) })
        .from(campaignPhases)
        .where(eq(campaignPhases.campaignId, campaignId));
      const sequenceNumber = data.sequenceNumber ?? Number(maxSequence ?? 0) + 1;
      const title = `${campaign.title}: ${data.title} plan`;
      const [created] = await db.transaction(async (tx) => {
        const [document] = await documentsSvc.upsertStandaloneDocument(tx, {
          companyId: campaign.companyId,
          title,
          body: data.planBody ?? "",
          createdByAgentId: actor.agentId ?? null,
          createdByUserId: actor.userId ?? null,
          updatedByAgentId: actor.agentId ?? null,
          updatedByUserId: actor.userId ?? null,
          changeSummary: "Created campaign phase plan",
        });
        const [phase] = await tx.insert(campaignPhases).values({
          companyId: campaign.companyId,
          campaignId,
          sequenceNumber,
          title: data.title,
          objective: data.objective ?? null,
          assigneeAgentId: data.assigneeAgentId ?? campaign.leadAgentId ?? null,
          planDocumentId: document.id,
          createdByAgentId: actor.agentId ?? null,
          createdByUserId: actor.userId ?? null,
          updatedByAgentId: actor.agentId ?? null,
          updatedByUserId: actor.userId ?? null,
        }).returning();
        return [phase];
      });
      return this.hydratePhase(created);
    },
  };
}
```

Adjust the `documentsSvc.upsertStandaloneDocument` call to the actual document service API. If there is no standalone method, add one in Task 5.

- [ ] **Step 3: Export service**

Add to `server/src/services/index.ts`:

```ts
export { campaignService } from "./campaigns.js";
```

- [ ] **Step 4: Run tests and confirm failure reason changes**

Run:

```sh
pnpm -C server test -- src/__tests__/campaigns-service.test.ts
```

Expected before Task 5: either PASS for create/list basics or a focused compile failure for missing standalone document helper.

---

## Task 5: Add Standalone Document Service Helper

**Files:**
- Modify: `server/src/services/documents.ts`
- Modify: `server/src/__tests__/documents-service.test.ts`

- [ ] **Step 1: Add failing document helper test**

In `server/src/__tests__/documents-service.test.ts`, add:

```ts
it("creates standalone markdown documents with an initial revision", async () => {
  const created = await svc.upsertStandaloneDocument(db, {
    companyId,
    title: "Campaign phase plan",
    body: "# Plan",
    createdByAgentId: null,
    createdByUserId: "board",
    updatedByAgentId: null,
    updatedByUserId: "board",
    changeSummary: "Created campaign phase plan",
  });

  expect(created.latestBody).toBe("# Plan");
  expect(created.latestRevisionNumber).toBe(1);
  expect(created.latestRevisionId).toBeTruthy();
});
```

- [ ] **Step 2: Implement helper**

Add a method to `documentService` that accepts either `db` or transaction object:

```ts
async upsertStandaloneDocument(client, input: {
  companyId: string;
  title: string | null;
  body: string;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  updatedByAgentId: string | null;
  updatedByUserId: string | null;
  changeSummary: string | null;
}) {
  const [document] = await client.insert(documents).values({
    companyId: input.companyId,
    title: input.title,
    format: "markdown",
    latestBody: input.body,
    latestRevisionNumber: 1,
    createdByAgentId: input.createdByAgentId,
    createdByUserId: input.createdByUserId,
    updatedByAgentId: input.updatedByAgentId,
    updatedByUserId: input.updatedByUserId,
  }).returning();

  const [revision] = await client.insert(documentRevisions).values({
    companyId: input.companyId,
    documentId: document.id,
    revisionNumber: 1,
    body: input.body,
    changeSummary: input.changeSummary,
  }).returning();

  const [updated] = await client.update(documents).set({
    latestRevisionId: revision.id,
    updatedAt: new Date(),
  }).where(eq(documents.id, document.id)).returning();

  return updated;
}
```

Use existing helper types/imports in `documents.ts` rather than duplicating table imports if they already exist.

- [ ] **Step 3: Run document tests**

Run:

```sh
pnpm -C server test -- src/__tests__/documents-service.test.ts
```

Expected: PASS.

---

## Task 6: Implement Campaign Plan Review And Approval Side Effects

**Files:**
- Modify: `server/src/services/campaigns.ts`
- Modify: `server/src/routes/approvals.ts`
- Test: `server/src/__tests__/campaigns-service.test.ts`
- Test: `server/src/__tests__/approval-routes-idempotency.test.ts`

- [ ] **Step 1: Add failing approval tests**

Add tests to `campaigns-service.test.ts`:

```ts
it("submits a phase plan for review with a campaign_phase_plan approval", async () => {
  const submission = await svc.submitPlanForReview(phaseId, { decisionNote: "Ready for board review." }, actor);

  expect(submission.phase.status).toBe("in_review");
  expect(submission.approval.type).toBe("campaign_phase_plan");
  expect(submission.approval.payload).toMatchObject({
    kind: "campaign_phase_plan",
    campaignId,
    phaseId,
    planDocumentId: submission.phase.planDocumentId,
  });
});

it("approving a phase plan creates exactly one execution issue", async () => {
  const submission = await svc.submitPlanForReview(phaseId, {}, actor);

  const first = await svc.handleApprovalApproved(submission.approval.id, {
    decisionNote: "Approved",
    issuePriority: "high",
  }, { userId: "board" });
  const second = await svc.handleApprovalApproved(submission.approval.id, {
    decisionNote: "Approved again",
    issuePriority: "high",
  }, { userId: "board" });

  expect(first.executionIssueId).toBeTruthy();
  expect(second.executionIssueId).toBe(first.executionIssueId);
});

it("requesting revision moves the phase back to revision_requested without creating an issue", async () => {
  const submission = await svc.submitPlanForReview(phaseId, {}, actor);

  const phase = await svc.handleApprovalRevisionRequested(submission.approval.id, {
    decisionNote: "Explain how the mage jobs affect economy.",
  }, { userId: "board" });

  expect(phase.status).toBe("revision_requested");
  expect(phase.executionIssueId).toBeNull();
});
```

- [ ] **Step 2: Implement plan document update**

Add to campaign service:

```ts
async upsertPhasePlan(phaseId: string, data: UpsertCampaignPhasePlan, actor: ActorInput) {
  const phase = await getPhase(phaseId);
  if (!phase) throw notFound("Campaign phase not found");
  if (["approved", "executing", "completed", "cancelled"].includes(phase.status)) {
    throw conflict("Approved, executing, completed, or cancelled phase plans cannot be edited");
  }
  const documentId = phase.planDocumentId;
  if (!documentId) throw conflict("Campaign phase is missing its plan document");
  const updated = await documentsSvc.updateDocument(documentId, {
    body: data.body,
    changeSummary: data.changeSummary ?? "Updated campaign phase plan",
    updatedByAgentId: actor.agentId ?? null,
    updatedByUserId: actor.userId ?? null,
  });
  await db.update(campaignPhases).set({
    status: phase.status === "in_review" ? "planning" : phase.status,
    updatedByAgentId: actor.agentId ?? null,
    updatedByUserId: actor.userId ?? null,
    updatedAt: new Date(),
  }).where(eq(campaignPhases.id, phaseId));
  return updated;
}
```

Adjust to the actual document service update API.

- [ ] **Step 3: Implement submit for review**

Add:

```ts
async submitPlanForReview(phaseId: string, data: SubmitCampaignPhasePlanForReview, actor: ActorInput) {
  const phase = await getPhase(phaseId);
  if (!phase) throw notFound("Campaign phase not found");
  if (!phase.planDocumentId) throw conflict("Campaign phase is missing a plan document");
  if (phase.status === "in_review") throw conflict("Campaign phase plan is already in review");
  if (["approved", "executing", "completed", "cancelled"].includes(phase.status)) {
    throw conflict("Campaign phase cannot be submitted from its current status");
  }

  const campaign = await get(phase.campaignId);
  if (!campaign) throw notFound("Campaign not found");
  const [planDocument] = await db.select().from(documents).where(eq(documents.id, phase.planDocumentId)).limit(1);
  if (!planDocument?.latestRevisionId) throw conflict("Plan document has no revision to approve");
  const projectRows = await db.select({ projectId: campaignProjects.projectId })
    .from(campaignProjects)
    .where(eq(campaignProjects.campaignId, campaign.id));

  const [approval] = await db.transaction(async (tx) => {
    const [createdApproval] = await tx.insert(approvals).values({
      companyId: campaign.companyId,
      type: "campaign_phase_plan",
      requestedByAgentId: actor.agentId ?? null,
      requestedByUserId: actor.userId ?? null,
      status: "pending",
      payload: {
        kind: "campaign_phase_plan",
        campaignId: campaign.id,
        campaignTitle: campaign.title,
        phaseId: phase.id,
        phaseTitle: phase.title,
        planDocumentId: planDocument.id,
        planRevisionId: planDocument.latestRevisionId,
        assigneeAgentId: phase.assigneeAgentId,
        projectIds: projectRows.map((row) => row.projectId),
      },
    }).returning();
    await tx.update(campaignPhases).set({
      status: "in_review",
      approvalId: createdApproval.id,
      updatedByAgentId: actor.agentId ?? null,
      updatedByUserId: actor.userId ?? null,
      updatedAt: new Date(),
    }).where(eq(campaignPhases.id, phase.id));
    return [createdApproval];
  });

  return {
    phase: await this.hydratePhase({ ...phase, status: "in_review", approvalId: approval.id }),
    approval,
    planRevision: await this.getDocumentRevision(planDocument.latestRevisionId),
  };
}
```

- [ ] **Step 4: Implement approval approved handler**

Add:

```ts
async handleApprovalApproved(approvalId: string, data: ApproveCampaignPhasePlan, actor: ActorInput) {
  const [phase] = await db.select().from(campaignPhases).where(eq(campaignPhases.approvalId, approvalId)).limit(1);
  if (!phase) return null;
  if (phase.executionIssueId) return phase;
  const campaign = await get(phase.campaignId);
  if (!campaign) throw notFound("Campaign not found");
  const [approval] = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1);
  const payload = approval?.payload as { planRevisionId?: string; projectIds?: string[] } | null;
  const projectId = payload?.projectIds?.length === 1 ? payload.projectIds[0] : null;
  const [planDocument] = phase.planDocumentId
    ? await db.select().from(documents).where(eq(documents.id, phase.planDocumentId)).limit(1)
    : [null];
  if (!planDocument) throw conflict("Campaign phase is missing its plan document");

  const issueDescription = [
    `Campaign: ${campaign.title}`,
    `Phase: ${phase.title}`,
    "",
    "Approved plan:",
    "",
    planDocument.latestBody,
  ].join("\n");

  const [updatedPhase] = await db.transaction(async (tx) => {
    const [issue] = await tx.insert(issues).values({
      companyId: campaign.companyId,
      projectId,
      goalId: campaign.goalId,
      title: data.issueTitle ?? `${campaign.title}: ${phase.title}`,
      description: issueDescription,
      priority: data.issuePriority ?? "medium",
      status: phase.assigneeAgentId ? "todo" : "backlog",
      assigneeAgentId: phase.assigneeAgentId,
      createdByAgentId: actor.agentId ?? null,
      createdByUserId: actor.userId ?? null,
      originKind: "campaign_phase",
      originId: phase.id,
    }).returning();

    const [nextPhase] = await tx.update(campaignPhases).set({
      status: phase.assigneeAgentId ? "executing" : "approved",
      approvedPlanRevisionId: payload?.planRevisionId ?? planDocument.latestRevisionId,
      executionIssueId: issue.id,
      startedAt: phase.assigneeAgentId ? new Date() : null,
      updatedByAgentId: actor.agentId ?? null,
      updatedByUserId: actor.userId ?? null,
      updatedAt: new Date(),
    }).where(eq(campaignPhases.id, phase.id)).returning();

    await tx.update(campaigns).set({
      status: campaign.status === "draft" ? "active" : campaign.status,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, campaign.id));

    return [nextPhase];
  });

  return updatedPhase;
}
```

If `issues.originKind` is constrained by shared constants, add `"campaign_phase"` to the origin constants in Task 1 before this code is compiled.

- [ ] **Step 5: Implement revision/reject handlers**

Add:

```ts
async handleApprovalRevisionRequested(approvalId: string, _data: { decisionNote?: string | null }, actor: ActorInput) {
  const [phase] = await db.update(campaignPhases).set({
    status: "revision_requested",
    updatedByAgentId: actor.agentId ?? null,
    updatedByUserId: actor.userId ?? null,
    updatedAt: new Date(),
  }).where(eq(campaignPhases.approvalId, approvalId)).returning();
  return phase ?? null;
}

async handleApprovalRejected(approvalId: string, actor: ActorInput) {
  const [phase] = await db.update(campaignPhases).set({
    status: "planning",
    updatedByAgentId: actor.agentId ?? null,
    updatedByUserId: actor.userId ?? null,
    updatedAt: new Date(),
  }).where(eq(campaignPhases.approvalId, approvalId)).returning();
  return phase ?? null;
}
```

- [ ] **Step 6: Wire approval routes**

In `server/src/routes/approvals.ts`, after the existing approval status update succeeds:

```ts
const campaigns = campaignService(db);
if (approval.type === "campaign_phase_plan") {
  await campaigns.handleApprovalApproved(approval.id, {
    decisionNote: req.body.decisionNote ?? null,
    issuePriority: "medium",
  }, {
    userId: req.actor.type === "board" ? req.actor.userId ?? "board" : null,
    agentId: req.actor.type === "agent" ? req.actor.agentId : null,
    runId: req.actor.runId ?? null,
  });
}
```

For request revision:

```ts
if (approval.type === "campaign_phase_plan") {
  await campaigns.handleApprovalRevisionRequested(approval.id, {
    decisionNote: req.body.decisionNote ?? null,
  }, actor);
}
```

For reject:

```ts
if (approval.type === "campaign_phase_plan") {
  await campaigns.handleApprovalRejected(approval.id, actor);
}
```

Keep the handler idempotent: approval retries must not create duplicate execution issues.

- [ ] **Step 7: Run service and approval tests**

Run:

```sh
pnpm -C server test -- src/__tests__/campaigns-service.test.ts src/__tests__/approval-routes-idempotency.test.ts
```

Expected: PASS.

---

## Task 7: Add Campaign REST Routes

**Files:**
- Create: `server/src/routes/campaigns.ts`
- Modify: `server/src/app.ts`
- Test: `server/src/__tests__/campaigns-routes.test.ts`

- [ ] **Step 1: Write route tests**

Create `server/src/__tests__/campaigns-routes.test.ts` using the app setup pattern from `server/src/__tests__/routines-routes.test.ts`. Test:

```ts
it("lists campaigns for the current company only", async () => {
  const res = await request(app).get(`/api/companies/${companyId}/campaigns`);
  expect(res.status).toBe(200);
  expect(res.body.every((campaign) => campaign.companyId === companyId)).toBe(true);
});

it("creates a campaign with linked projects", async () => {
  const res = await request(app)
    .post(`/api/companies/${companyId}/campaigns`)
    .send({
      title: "Readerbase fantasy world",
      objective: "Build a deeply intertwined fantasy world.",
      projectIds: [productionProjectId],
    });

  expect(res.status).toBe(201);
  expect(res.body.projects).toHaveLength(1);
});

it("submits and approves a phase plan through the API", async () => {
  const submit = await request(app).post(`/api/campaign-phases/${phaseId}/submit-plan`).send({});
  expect(submit.status).toBe(201);

  const approve = await request(app).post(`/api/approvals/${submit.body.approval.id}/approve`).send({});
  expect(approve.status).toBe(200);

  const detail = await request(app).get(`/api/campaigns/${campaignId}`);
  expect(detail.body.phases[0].executionIssueId).toBeTruthy();
});
```

- [ ] **Step 2: Implement routes**

Create `server/src/routes/campaigns.ts`:

```ts
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  approveCampaignPhasePlanSchema,
  completeCampaignPhaseSchema,
  createCampaignPhaseSchema,
  createCampaignSchema,
  replaceCampaignProjectsSchema,
  submitCampaignPhasePlanForReviewSchema,
  updateCampaignPhaseSchema,
  updateCampaignSchema,
  upsertCampaignPhasePlanSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { campaignService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function campaignRoutes(db: Db) {
  const router = Router();
  const svc = campaignService(db);

  function actorFromReq(req) {
    return {
      agentId: req.actor.type === "agent" ? req.actor.agentId : null,
      userId: req.actor.type === "board" ? req.actor.userId ?? "board" : null,
      runId: req.actor.runId ?? null,
    };
  }

  router.get("/companies/:companyId/campaigns", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.list(companyId));
  });

  router.post("/companies/:companyId/campaigns", validate(createCampaignSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const campaign = await svc.create(companyId, req.body, actorFromReq(req));
    const detail = await svc.getDetail(campaign.id);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "campaign.created",
      entityType: "campaign",
      entityId: campaign.id,
      details: { title: campaign.title, projectIds: req.body.projectIds ?? [] },
    });
    res.status(201).json(detail);
  });

  router.get("/campaigns/:campaignId", async (req, res) => {
    const detail = await svc.getDetail(req.params.campaignId as string);
    if (!detail) return res.status(404).json({ error: "Campaign not found" });
    assertCompanyAccess(req, detail.companyId);
    res.json(detail);
  });

  router.patch("/campaigns/:campaignId", validate(updateCampaignSchema), async (req, res) => {
    const existing = await svc.get(req.params.campaignId as string);
    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    assertCompanyAccess(req, existing.companyId);
    const updated = await svc.update(existing.id, req.body, actorFromReq(req));
    res.json(updated);
  });

  router.put("/campaigns/:campaignId/projects", validate(replaceCampaignProjectsSchema), async (req, res) => {
    const existing = await svc.get(req.params.campaignId as string);
    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    assertCompanyAccess(req, existing.companyId);
    res.json(await svc.replaceProjects(existing.id, req.body.projectIds));
  });

  router.post("/campaigns/:campaignId/phases", validate(createCampaignPhaseSchema), async (req, res) => {
    const existing = await svc.get(req.params.campaignId as string);
    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    assertCompanyAccess(req, existing.companyId);
    const phase = await svc.createPhase(existing.id, req.body, actorFromReq(req));
    res.status(201).json(phase);
  });

  router.patch("/campaign-phases/:phaseId", validate(updateCampaignPhaseSchema), async (req, res) => {
    const phase = await svc.getPhase(req.params.phaseId as string);
    if (!phase) return res.status(404).json({ error: "Campaign phase not found" });
    assertCompanyAccess(req, phase.companyId);
    res.json(await svc.updatePhase(phase.id, req.body, actorFromReq(req)));
  });

  router.put("/campaign-phases/:phaseId/plan", validate(upsertCampaignPhasePlanSchema), async (req, res) => {
    const phase = await svc.getPhase(req.params.phaseId as string);
    if (!phase) return res.status(404).json({ error: "Campaign phase not found" });
    assertCompanyAccess(req, phase.companyId);
    res.json(await svc.upsertPhasePlan(phase.id, req.body, actorFromReq(req)));
  });

  router.post("/campaign-phases/:phaseId/submit-plan", validate(submitCampaignPhasePlanForReviewSchema), async (req, res) => {
    const phase = await svc.getPhase(req.params.phaseId as string);
    if (!phase) return res.status(404).json({ error: "Campaign phase not found" });
    assertCompanyAccess(req, phase.companyId);
    res.status(201).json(await svc.submitPlanForReview(phase.id, req.body, actorFromReq(req)));
  });

  router.post("/campaign-phases/:phaseId/complete", validate(completeCampaignPhaseSchema), async (req, res) => {
    const phase = await svc.getPhase(req.params.phaseId as string);
    if (!phase) return res.status(404).json({ error: "Campaign phase not found" });
    assertCompanyAccess(req, phase.companyId);
    res.json(await svc.completePhase(phase.id, req.body, actorFromReq(req)));
  });

  return router;
}
```

Implement `updatePhase` and `completePhase` in the service before this compiles.

- [ ] **Step 3: Implement updatePhase and completePhase**

In `campaignService`:

```ts
async updatePhase(phaseId: string, data: UpdateCampaignPhase, actor: ActorInput) {
  const phase = await getPhase(phaseId);
  if (!phase) throw notFound("Campaign phase not found");
  const [updated] = await db.update(campaignPhases).set({
    ...(data.title !== undefined ? { title: data.title } : {}),
    ...(data.objective !== undefined ? { objective: data.objective } : {}),
    ...(data.sequenceNumber !== undefined ? { sequenceNumber: data.sequenceNumber } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.assigneeAgentId !== undefined ? { assigneeAgentId: data.assigneeAgentId } : {}),
    updatedByAgentId: actor.agentId ?? null,
    updatedByUserId: actor.userId ?? null,
    updatedAt: new Date(),
  }).where(eq(campaignPhases.id, phaseId)).returning();
  return this.hydratePhase(updated);
}

async completePhase(phaseId: string, data: CompleteCampaignPhase, actor: ActorInput) {
  const phase = await getPhase(phaseId);
  if (!phase) throw notFound("Campaign phase not found");
  if (!["approved", "executing"].includes(phase.status)) {
    throw conflict("Only approved or executing phases can be completed");
  }
  let resultDocumentId = phase.resultDocumentId;
  if (data.resultBody?.trim()) {
    const [document] = await documentsSvc.upsertStandaloneDocument(db, {
      companyId: phase.companyId,
      title: data.resultTitle ?? `${phase.title} result`,
      body: data.resultBody,
      createdByAgentId: actor.agentId ?? null,
      createdByUserId: actor.userId ?? null,
      updatedByAgentId: actor.agentId ?? null,
      updatedByUserId: actor.userId ?? null,
      changeSummary: "Completed campaign phase",
    });
    resultDocumentId = document.id;
  }
  const [updated] = await db.update(campaignPhases).set({
    status: "completed",
    resultDocumentId,
    completedAt: new Date(),
    updatedByAgentId: actor.agentId ?? null,
    updatedByUserId: actor.userId ?? null,
    updatedAt: new Date(),
  }).where(eq(campaignPhases.id, phaseId)).returning();
  return this.hydratePhase(updated);
}
```

- [ ] **Step 4: Mount routes**

In `server/src/app.ts`, import and mount:

```ts
import { campaignRoutes } from "./routes/campaigns.js";
```

Add to the API router setup near other domain routes:

```ts
api.use(campaignRoutes(db));
```

- [ ] **Step 5: Run route tests**

Run:

```sh
pnpm -C server test -- src/__tests__/campaigns-routes.test.ts
```

Expected: PASS.

---

## Task 8: Add UI API Client And Query Keys

**Files:**
- Create: `ui/src/api/campaigns.ts`
- Modify: `ui/src/api/index.ts`
- Modify: `ui/src/lib/queryKeys.ts`

- [ ] **Step 1: Create campaigns API client**

Create `ui/src/api/campaigns.ts`:

```ts
import type {
  CampaignDetail,
  CampaignListItem,
  CampaignPhaseDetail,
  CampaignPhasePlanSubmission,
  CreateCampaign,
  CreateCampaignPhase,
  ReplaceCampaignProjects,
  UpdateCampaign,
  UpdateCampaignPhase,
  UpsertCampaignPhasePlan,
} from "@paperclipai/shared";
import { api } from "./client";

export const campaignsApi = {
  list: (companyId: string) => api.get<CampaignListItem[]>(`/companies/${companyId}/campaigns`),
  create: (companyId: string, data: CreateCampaign) =>
    api.post<CampaignDetail>(`/companies/${companyId}/campaigns`, data),
  get: (campaignId: string) => api.get<CampaignDetail>(`/campaigns/${campaignId}`),
  update: (campaignId: string, data: UpdateCampaign) =>
    api.patch<CampaignDetail>(`/campaigns/${campaignId}`, data),
  replaceProjects: (campaignId: string, data: ReplaceCampaignProjects) =>
    api.put<CampaignDetail>(`/campaigns/${campaignId}/projects`, data),
  createPhase: (campaignId: string, data: CreateCampaignPhase) =>
    api.post<CampaignPhaseDetail>(`/campaigns/${campaignId}/phases`, data),
  updatePhase: (phaseId: string, data: UpdateCampaignPhase) =>
    api.patch<CampaignPhaseDetail>(`/campaign-phases/${phaseId}`, data),
  upsertPlan: (phaseId: string, data: UpsertCampaignPhasePlan) =>
    api.put(`/campaign-phases/${phaseId}/plan`, data),
  submitPlan: (phaseId: string, decisionNote?: string | null) =>
    api.post<CampaignPhasePlanSubmission>(`/campaign-phases/${phaseId}/submit-plan`, { decisionNote }),
  completePhase: (phaseId: string, data: { resultBody?: string | null; resultTitle?: string | null }) =>
    api.post<CampaignPhaseDetail>(`/campaign-phases/${phaseId}/complete`, data),
};
```

- [ ] **Step 2: Export API client**

Add to `ui/src/api/index.ts`:

```ts
export { campaignsApi } from "./campaigns";
```

- [ ] **Step 3: Add query keys**

Add to `ui/src/lib/queryKeys.ts`:

```ts
campaigns: {
  list: (companyId: string) => ["campaigns", companyId] as const,
  detail: (campaignId: string) => ["campaigns", "detail", campaignId] as const,
},
```

- [ ] **Step 4: Type check UI**

Run:

```sh
pnpm -C ui exec tsc --noEmit --pretty false
```

Expected: compile errors only for missing route pages until Task 9.

---

## Task 9: Add Campaigns Work List Page

**Files:**
- Create: `ui/src/pages/Campaigns.tsx`
- Create: `ui/src/components/NewCampaignDialog.tsx`
- Test: `ui/src/pages/Campaigns.test.tsx`

- [ ] **Step 1: Write failing page test**

Create `ui/src/pages/Campaigns.test.tsx`:

```tsx
it("renders campaigns as Work items with linked project chips", async () => {
  render(<Campaigns />);

  expect(await screen.findByText("Readerbase fantasy world")).toBeInTheDocument();
  expect(screen.getByText("Production")).toBeInTheDocument();
  expect(screen.getByText("Social Media")).toBeInTheDocument();
  expect(screen.getByText("Awaiting plan review")).toBeInTheDocument();
});

it("opens the new campaign dialog", async () => {
  render(<Campaigns />);

  await userEvent.click(screen.getByRole("button", { name: /create campaign/i }));

  expect(screen.getByPlaceholderText("Campaign title")).toBeInTheDocument();
});
```

Mock `campaignsApi`, `projectsApi`, `agentsApi`, `useCompany`, and `useBreadcrumbs` using patterns from `ui/src/pages/Routines.test.tsx` or `ui/src/components/NewIssueDialog.test.tsx`.

- [ ] **Step 2: Create dialog**

Create `ui/src/components/NewCampaignDialog.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Agent, Project } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { InlineEntitySelector, type InlineEntityOption } from "./InlineEntitySelector";
import { MarkdownEditor } from "./MarkdownEditor";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: Agent[];
  projects: Project[];
  isPending: boolean;
  error?: Error | null;
  onSubmit: (data: {
    title: string;
    objective: string | null;
    leadAgentId: string | null;
    projectIds: string[];
  }) => void;
};

export function NewCampaignDialog({ open, onOpenChange, agents, projects, isPending, error, onSubmit }: Props) {
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [leadAgentId, setLeadAgentId] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);

  const agentOptions = useMemo<InlineEntityOption[]>(() => agents.map((agent) => ({
    id: agent.id,
    label: agent.name,
    searchText: `${agent.name} ${agent.role} ${agent.title ?? ""}`,
  })), [agents]);

  const projectOptions = useMemo<InlineEntityOption[]>(() => projects.map((project) => ({
    id: project.id,
    label: project.name,
    searchText: project.description ?? "",
  })), [projects]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <div className="border-b border-border/60 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">New campaign</p>
          <input
            className="mt-3 w-full bg-transparent text-xl font-semibold outline-none placeholder:text-muted-foreground/50"
            placeholder="Campaign title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Lead</span>
            <InlineEntitySelector
              value={leadAgentId}
              options={agentOptions}
              placeholder="Agent"
              noneLabel="No lead"
              searchPlaceholder="Search agents..."
              emptyMessage="No agents found."
              onChange={setLeadAgentId}
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Projects</p>
            <div className="flex flex-wrap gap-2">
              {projectOptions.map((project) => {
                const selected = projectIds.includes(project.id);
                return (
                  <Button
                    key={project.id}
                    type="button"
                    size="sm"
                    variant={selected ? "default" : "outline"}
                    onClick={() => {
                      setProjectIds((current) =>
                        selected ? current.filter((id) => id !== project.id) : [...current, project.id],
                      );
                    }}
                  >
                    {project.label}
                  </Button>
                );
              })}
            </div>
          </div>
          <MarkdownEditor
            value={objective}
            onChange={setObjective}
            placeholder="Objective, constraints, and review expectations..."
            contentClassName="min-h-[180px]"
          />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
          <div className="flex flex-col items-end gap-2">
            <Button
              onClick={() => onSubmit({
                title: title.trim(),
                objective: objective.trim() || null,
                leadAgentId: leadAgentId || null,
                projectIds,
              })}
              disabled={isPending || !title.trim()}
            >
              <Plus className="mr-2 h-4 w-4" />
              {isPending ? "Creating..." : "Create campaign"}
            </Button>
            {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Create list page**

Create `ui/src/pages/Campaigns.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { Flag, Plus } from "lucide-react";
import { agentsApi } from "../api/agents";
import { campaignsApi } from "../api/campaigns";
import { projectsApi } from "../api/projects";
import { EmptyState } from "../components/EmptyState";
import { NewCampaignDialog } from "../components/NewCampaignDialog";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { Button } from "@/components/ui/button";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";

function phaseLabel(status?: string | null) {
  if (status === "in_review") return "Awaiting plan review";
  if (status === "revision_requested") return "Revision requested";
  if (status === "executing") return "Executing approved phase";
  if (status === "completed") return "Phase completed";
  return "Planning";
}

export function Campaigns() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Campaigns" }]);
  }, [setBreadcrumbs]);

  const campaignsQuery = useQuery({
    queryKey: queryKeys.campaigns.list(selectedCompanyId!),
    queryFn: () => campaignsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const createCampaign = useMutation({
    mutationFn: (data: { title: string; objective: string | null; leadAgentId: string | null; projectIds: string[] }) =>
      campaignsApi.create(selectedCompanyId!, data),
    onSuccess: async () => {
      setDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list(selectedCompanyId!) });
      pushToast({ title: "Campaign created", tone: "success" });
    },
  });

  if (!selectedCompanyId) return <EmptyState icon={Flag} message="Select a company to view campaigns." />;
  if (campaignsQuery.isLoading) return <PageSkeleton variant="issues-list" />;

  const campaigns = campaignsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Reviewable multi-phase work streams that can coordinate across projects.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create campaign
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <div className="py-12">
          <EmptyState icon={Flag} message="No campaigns yet. Create one for the next reviewable work stream." />
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          {campaigns.map((campaign) => (
            <Link
              key={campaign.id}
              to={`/campaigns/${campaign.id}`}
              className="block border-b border-border px-4 py-3 last:border-b-0 hover:bg-accent/40"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-semibold">{campaign.title}</h2>
                    <StatusBadge status={campaign.status} />
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{campaign.objective}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {campaign.projects.map((project) => (
                      <span key={project.id} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
                        <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: project.color ?? "#64748b" }} />
                        {project.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="shrink-0 text-left md:text-right">
                  <p className="text-sm font-medium">{phaseLabel(campaign.activePhase?.status)}</p>
                  <p className="text-xs text-muted-foreground">
                    {campaign.phaseCount} phase{campaign.phaseCount === 1 ? "" : "s"}
                    {campaign.pendingReviewCount > 0 ? ` · ${campaign.pendingReviewCount} pending review` : ""}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <NewCampaignDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agents={agentsQuery.data ?? []}
        projects={(projectsQuery.data ?? []).filter((project) => !project.archivedAt)}
        isPending={createCampaign.isPending}
        error={createCampaign.error instanceof Error ? createCampaign.error : null}
        onSubmit={(data) => createCampaign.mutate(data)}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run page test**

Run:

```sh
pnpm -C ui test -- src/pages/Campaigns.test.tsx
```

Expected: PASS.

---

## Task 10: Add Campaign Detail And Phase Review UI

**Files:**
- Create: `ui/src/pages/CampaignDetail.tsx`
- Create: `ui/src/components/CampaignPhaseTimeline.tsx`
- Create: `ui/src/components/CampaignPhaseComposer.tsx`
- Test: `ui/src/pages/CampaignDetail.test.tsx`

- [ ] **Step 1: Write failing detail tests**

Create `ui/src/pages/CampaignDetail.test.tsx`:

```tsx
it("shows phase plan review controls for a planning phase", async () => {
  render(<CampaignDetail />);

  expect(await screen.findByText("Magical jobs")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /submit plan/i })).toBeInTheDocument();
});

it("shows approval state and execution issue link for an executing phase", async () => {
  render(<CampaignDetail fixture="executing" />);

  expect(await screen.findByText("Executing approved phase")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /open execution issue/i })).toHaveAttribute("href", "/issues/PAP-123");
});
```

- [ ] **Step 2: Create phase timeline**

Create `ui/src/components/CampaignPhaseTimeline.tsx`:

```tsx
import { CheckCircle2, CircleDashed, FileCheck2, PlayCircle } from "lucide-react";
import type { CampaignPhaseDetail } from "@paperclipai/shared";
import { cn } from "../lib/utils";

type Props = {
  phases: CampaignPhaseDetail[];
  selectedPhaseId: string | null;
  onSelectPhase: (phaseId: string) => void;
};

function phaseIcon(status: string) {
  if (status === "completed") return CheckCircle2;
  if (status === "executing" || status === "approved") return PlayCircle;
  if (status === "in_review") return FileCheck2;
  return CircleDashed;
}

export function CampaignPhaseTimeline({ phases, selectedPhaseId, onSelectPhase }: Props) {
  return (
    <div className="rounded-lg border border-border">
      {phases.map((phase) => {
        const Icon = phaseIcon(phase.status);
        const selected = phase.id === selectedPhaseId;
        return (
          <button
            key={phase.id}
            className={cn(
              "flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left last:border-b-0 hover:bg-accent/40",
              selected && "bg-accent/50",
            )}
            onClick={() => onSelectPhase(phase.id)}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{phase.sequenceNumber}. {phase.title}</p>
              <p className="text-xs text-muted-foreground">{phase.status.replaceAll("_", " ")}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Create phase composer/review panel**

Create `ui/src/components/CampaignPhaseComposer.tsx`:

```tsx
import { useState } from "react";
import { FileCheck2, Send } from "lucide-react";
import type { CampaignPhaseDetail } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { MarkdownBody } from "./MarkdownBody";
import { MarkdownEditor } from "./MarkdownEditor";

type Props = {
  phase: CampaignPhaseDetail;
  isSaving: boolean;
  isSubmitting: boolean;
  onSavePlan: (body: string) => void;
  onSubmitPlan: () => void;
};

export function CampaignPhaseComposer({ phase, isSaving, isSubmitting, onSavePlan, onSubmitPlan }: Props) {
  const [editing, setEditing] = useState(!phase.planDocument?.latestBody);
  const [body, setBody] = useState(phase.planDocument?.latestBody ?? "");
  const locked = ["approved", "executing", "completed", "cancelled"].includes(phase.status);

  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{phase.title}</h2>
          <p className="text-xs text-muted-foreground">{phase.status.replaceAll("_", " ")}</p>
        </div>
        <div className="flex gap-2">
          {!locked ? (
            <Button variant="outline" size="sm" onClick={() => setEditing((current) => !current)}>
              {editing ? "Preview" : "Edit"}
            </Button>
          ) : null}
          {!locked ? (
            <Button size="sm" onClick={() => onSavePlan(body)} disabled={isSaving || !body.trim()}>
              <FileCheck2 className="mr-2 h-4 w-4" />
              {isSaving ? "Saving..." : "Save plan"}
            </Button>
          ) : null}
          {["planning", "revision_requested"].includes(phase.status) ? (
            <Button size="sm" onClick={onSubmitPlan} disabled={isSubmitting || !body.trim()}>
              <Send className="mr-2 h-4 w-4" />
              {isSubmitting ? "Submitting..." : "Submit plan"}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="p-4">
        {editing && !locked ? (
          <MarkdownEditor value={body} onChange={setBody} contentClassName="min-h-[360px]" />
        ) : (
          <MarkdownBody content={body || "No plan written yet."} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create detail page**

Create `ui/src/pages/CampaignDetail.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@/lib/router";
import { Plus } from "lucide-react";
import { campaignsApi } from "../api/campaigns";
import { CampaignPhaseComposer } from "../components/CampaignPhaseComposer";
import { CampaignPhaseTimeline } from "../components/CampaignPhaseTimeline";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";

export function CampaignDetail() {
  const { campaignId } = useParams();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: queryKeys.campaigns.detail(campaignId!),
    queryFn: () => campaignsApi.get(campaignId!),
    enabled: !!campaignId,
  });

  const campaign = detailQuery.data;
  const selectedPhase = useMemo(
    () => campaign?.phases.find((phase) => phase.id === selectedPhaseId) ?? campaign?.phases[0] ?? null,
    [campaign?.phases, selectedPhaseId],
  );

  useEffect(() => {
    if (campaign) setBreadcrumbs([{ label: "Campaigns", href: "/campaigns" }, { label: campaign.title }]);
  }, [campaign, setBreadcrumbs]);

  useEffect(() => {
    if (!selectedPhaseId && campaign?.phases[0]) setSelectedPhaseId(campaign.phases[0].id);
  }, [campaign?.phases, selectedPhaseId]);

  const invalidate = async () => {
    if (campaignId) await queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(campaignId) });
  };

  const savePlan = useMutation({
    mutationFn: ({ phaseId, body }: { phaseId: string; body: string }) =>
      campaignsApi.upsertPlan(phaseId, { body, changeSummary: "Updated phase plan from board" }),
    onSuccess: async () => {
      await invalidate();
      pushToast({ title: "Plan saved", tone: "success" });
    },
  });

  const submitPlan = useMutation({
    mutationFn: (phaseId: string) => campaignsApi.submitPlan(phaseId),
    onSuccess: async () => {
      await invalidate();
      pushToast({ title: "Plan submitted for review", tone: "success" });
    },
  });

  const createPhase = useMutation({
    mutationFn: () => campaignsApi.createPhase(campaignId!, {
      title: `Phase ${(campaign?.phases.length ?? 0) + 1}`,
      objective: null,
      planBody: "## Plan\n\n",
    }),
    onSuccess: async (phase) => {
      setSelectedPhaseId(phase.id);
      await invalidate();
    },
  });

  if (detailQuery.isLoading) return <PageSkeleton variant="issues-list" />;
  if (!campaign) return <EmptyState message="Campaign not found." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{campaign.title}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{campaign.objective}</p>
          <div className="flex flex-wrap gap-1.5">
            {campaign.projects.map((project) => (
              <span key={project.id} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: project.color ?? "#64748b" }} />
                {project.name}
              </span>
            ))}
          </div>
        </div>
        <Button onClick={() => createPhase.mutate()} disabled={createPhase.isPending}>
          <Plus className="mr-2 h-4 w-4" />
          Add phase
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <CampaignPhaseTimeline
          phases={campaign.phases}
          selectedPhaseId={selectedPhase?.id ?? null}
          onSelectPhase={setSelectedPhaseId}
        />
        <div className="space-y-4">
          {selectedPhase ? (
            <>
              {selectedPhase.executionIssue ? (
                <Link
                  to={`/issues/${selectedPhase.executionIssue.identifier ?? selectedPhase.executionIssue.id}`}
                  className="inline-flex text-sm font-medium text-primary hover:underline"
                >
                  Open execution issue
                </Link>
              ) : null}
              <CampaignPhaseComposer
                phase={selectedPhase}
                isSaving={savePlan.isPending}
                isSubmitting={submitPlan.isPending}
                onSavePlan={(body) => savePlan.mutate({ phaseId: selectedPhase.id, body })}
                onSubmitPlan={() => submitPlan.mutate(selectedPhase.id)}
              />
            </>
          ) : (
            <EmptyState message="Add the first phase to start campaign planning." />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run detail tests**

Run:

```sh
pnpm -C ui test -- src/pages/CampaignDetail.test.tsx
```

Expected: PASS.

---

## Task 11: Add Navigation And Approval Rendering

**Files:**
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/components/Sidebar.tsx`
- Modify: `ui/src/components/ActivityRow.tsx`
- Modify: `ui/src/components/ApprovalPayload.tsx`
- Test: `ui/src/components/Sidebar.test.tsx`
- Test: `ui/src/components/ApprovalPayload.test.tsx`

- [ ] **Step 1: Add route imports and routes**

In `ui/src/App.tsx`:

```tsx
import { Campaigns } from "./pages/Campaigns";
import { CampaignDetail } from "./pages/CampaignDetail";
```

Add routes inside the board routes:

```tsx
<Route path="campaigns" element={<Campaigns />} />
<Route path="campaigns/:campaignId" element={<CampaignDetail />} />
```

Add unprefixed redirect entries if this app mirrors unprefixed routes.

- [ ] **Step 2: Add Work sidebar item**

In `ui/src/components/Sidebar.tsx`, import `Flag` from `lucide-react` and add Campaigns under Work:

```tsx
<SidebarNavItem to="/campaigns" label="Campaigns" icon={Flag} />
```

Place it near Issues/Meetings/Routines/Goals. Do not add it to the Projects section.

- [ ] **Step 3: Add activity routing**

In `ui/src/components/ActivityRow.tsx`, extend entity routing:

```ts
case "campaign":
  return `/campaigns/${entityId}`;
case "campaign_phase":
  return details?.campaignId ? `/campaigns/${details.campaignId}` : `/campaigns`;
```

Use the existing details parsing style in that file.

- [ ] **Step 4: Render campaign approval payloads**

In `ui/src/components/ApprovalPayload.tsx`, detect:

```ts
payload?.kind === "campaign_phase_plan"
```

Render:

- campaign title
- phase title
- linked project count or names if present in payload
- plan revision id shortened
- a link to `/campaigns/${payload.campaignId}`

Use the existing generic approval styling and avoid a separate visual system.

- [ ] **Step 5: Add tests**

In `Sidebar.test.tsx`, assert:

```tsx
expect(screen.getByRole("link", { name: /campaigns/i })).toHaveAttribute("href", "/campaigns");
```

In `ApprovalPayload.test.tsx`, assert:

```tsx
expect(screen.getByText("Readerbase fantasy world")).toBeInTheDocument();
expect(screen.getByText("Magical jobs")).toBeInTheDocument();
expect(screen.getByRole("link", { name: /open campaign/i })).toHaveAttribute("href", "/campaigns/campaign-1");
```

- [ ] **Step 6: Run tests**

Run:

```sh
pnpm -C ui test -- src/components/Sidebar.test.tsx src/components/ApprovalPayload.test.tsx
```

Expected: PASS.

---

## Task 12: Add Search, Inbox, And Badge Follow-Up Integration

**Files:**
- Modify: `server/src/services/sidebar-badges.ts`
- Modify: `ui/src/hooks/useInboxBadge.ts`
- Optional Modify: `server/src/services/company-search-service.ts`
- Optional Modify: `ui/src/pages/Search.tsx`

- [ ] **Step 1: Surface pending campaign plan approvals through existing approval badge**

No new badge category is needed if campaign plan approvals use the existing `approvals` table. Confirm `server/src/services/sidebar-badges.ts` counts all actionable approvals without filtering type. If it filters type, include `"campaign_phase_plan"`.

- [ ] **Step 2: Confirm inbox behavior**

Confirm `ui/src/hooks/useInboxBadge.ts` and `ui/src/lib/inbox.ts` include all approval types. If they filter known types, include `"campaign_phase_plan"`.

- [ ] **Step 3: Optional search integration**

If company search has a generic documents scope, campaign phase plan documents are searchable already. If search only joins through issues, add a campaign document source:

```ts
{
  type: "campaign_phase_document",
  title: campaign.title,
  subtitle: phase.title,
  href: `/campaigns/${campaign.id}`,
}
```

Do this only if current search omits standalone documents.

- [ ] **Step 4: Run focused tests**

Run:

```sh
pnpm -C server test -- src/__tests__/sidebar-badges.test.ts
pnpm -C ui test -- src/lib/inbox.test.ts
```

If either file does not exist under those names, run the closest existing badge/inbox tests found by `rg "sidebar-badges|inbox" server/src ui/src`.

---

## Task 13: Documentation Update

**Files:**
- Modify: `doc/SPEC-implementation.md`
- Modify: `doc/PRODUCT.md`

- [ ] **Step 1: Update V1 current implementation addenda**

In `doc/SPEC-implementation.md`, add a short addendum under current implementation features:

```md
- Campaigns: company-scoped Work section objects for reviewable, multi-phase work streams. Campaigns can span multiple projects, store phase plans/results as documents, use board approvals for phase plans, and create execution issues automatically when a phase plan is approved.
```

- [ ] **Step 2: Update product definition**

In `doc/PRODUCT.md`, add to task/work management:

```md
Campaigns are a Work section surface for large efforts that need board oversight before execution. A campaign can span one or more projects and advances through phase plans: an agent proposes a plan, the board approves or requests revision, and approval creates the execution issue for that phase without a second start gate.
```

- [ ] **Step 3: Run markdown check if available**

Run:

```sh
pnpm test -- doc
```

If no doc test target exists, skip and report that docs were reviewed manually.

---

## Task 14: Final Verification

**Files:**
- No new files unless fixing failures.

- [ ] **Step 1: Run targeted backend tests**

Run:

```sh
pnpm -C server test -- src/__tests__/campaigns-service.test.ts src/__tests__/campaigns-routes.test.ts src/__tests__/approval-routes-idempotency.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run targeted UI tests**

Run:

```sh
pnpm -C ui test -- src/pages/Campaigns.test.tsx src/pages/CampaignDetail.test.tsx src/components/Sidebar.test.tsx src/components/ApprovalPayload.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typechecks**

Run:

```sh
pnpm -r typecheck
```

Expected: PASS.

- [ ] **Step 4: Run default test suite**

Run:

```sh
pnpm test
```

Expected: PASS.

- [ ] **Step 5: Build**

Run:

```sh
pnpm build
```

Expected: PASS.

- [ ] **Step 6: Manual browser smoke**

Start the dev server:

```sh
pnpm dev
```

Open the board and verify:

- Campaigns appears under Work, not Projects.
- Creating a campaign allows selecting Production, Remotion, Social Media, or multiple projects.
- Campaign detail allows adding a phase and writing a plan.
- Submitting a plan creates a pending approval.
- Approving the plan creates one execution issue.
- Refreshing approval does not create a duplicate issue.
- The phase shows the execution issue link.

---

## Implementation Notes

- Keep every new entity company-scoped.
- Do not create a second approval system. Campaign phase review must use `approvals`.
- Do not turn campaigns into chat. Plans and results are markdown documents; discussion remains comments/approvals/issues.
- Do not add a second execution concept. Approved phases execute through normal issues.
- If a campaign has exactly one linked project, the generated execution issue should use that project. If it has zero or multiple projects, the issue should have `projectId = null` unless the UI later asks the board to select a target project per phase.
- Agents may create and update their own campaign phases when they have company access, but board access remains the authority for approvals.
- All mutating routes must write activity log entries. The route skeleton above logs campaign creation; implementation should also log project replacement, phase creation, plan submission, phase approval side effects, and phase completion.

## Self-Review

Spec coverage:

- Work section placement is covered by Task 11.
- Campaigns spanning projects are covered by Tasks 3, 4, 7, and 9.
- Reviewable phase plans are covered by Tasks 4, 6, 7, and 10.
- Board approve/request revision flow is covered by Task 6 and existing approvals UI integration.
- No second start gate is covered by Task 6: approving the plan creates the execution issue immediately and idempotently.
- Existing issues remain the execution unit, covered by Task 6.
- Company boundaries, activity logging, and docs are covered by Tasks 4, 7, 11, and 13.

Placeholder scan:

- No unresolved placeholder instructions are intentionally left in the plan.
- The only conditional areas are explicit integration checks where the current code may already support the behavior.

Type consistency:

- The plan uses `campaigns`, `campaignProjects`, `campaignPhases`, `CampaignDetail`, `CampaignListItem`, `CampaignPhaseDetail`, `campaign_phase_plan`, and `campaign_phase` consistently.
- Service method names used by routes and UI are defined in the service tasks.
