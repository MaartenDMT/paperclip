import { index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { approvals } from "./approvals.js";
import { companies } from "./companies.js";
import { documentRevisions } from "./document_revisions.js";
import { documents } from "./documents.js";
import { goals } from "./goals.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

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
    approvedPlanRevisionId: uuid("approved_plan_revision_id").references(() => documentRevisions.id, {
      onDelete: "set null",
    }),
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
    campaignSequenceUq: uniqueIndex("campaign_phases_campaign_sequence_uq").on(
      table.campaignId,
      table.sequenceNumber,
    ),
    companyStatusIdx: index("campaign_phases_company_status_idx").on(table.companyId, table.status),
    campaignIdx: index("campaign_phases_campaign_idx").on(table.campaignId),
    approvalIdx: index("campaign_phases_approval_idx").on(table.approvalId),
    executionIssueIdx: index("campaign_phases_execution_issue_idx").on(table.executionIssueId),
  }),
);
