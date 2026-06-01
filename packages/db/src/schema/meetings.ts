import type { AgentMeetingExpectedOutput, AgentMeetingResult } from "@paperclipai/shared";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { goals } from "./goals.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    sourceIssueId: uuid("source_issue_id").references(() => issues.id, { onDelete: "set null" }),
    meetingType: text("meeting_type").notNull().default("operating_review"),
    title: text("title"),
    purpose: text("purpose").notNull(),
    status: text("status").notNull().default("pending"),
    chairAgentId: uuid("chair_agent_id").references(() => agents.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key"),
    agenda: jsonb("agenda").$type<string[]>().notNull().default([]),
    expectedOutputs: jsonb("expected_outputs").$type<AgentMeetingExpectedOutput[]>().notNull().default([]),
    contextMarkdown: text("context_markdown"),
    result: jsonb("result").$type<AgentMeetingResult>(),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    resolvedByAgentId: uuid("resolved_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    resolvedByUserId: text("resolved_by_user_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusCreatedIdx: index("meetings_company_status_created_idx").on(table.companyId, table.status, table.createdAt),
    companyStatusUpdatedIdx: index("meetings_company_status_updated_idx").on(table.companyId, table.status, table.updatedAt),
    companySourceIssueIdx: index("meetings_company_source_issue_idx").on(table.companyId, table.sourceIssueId),
    companyIdempotencyUq: uniqueIndex("meetings_company_idempotency_uq")
      .on(table.companyId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  }),
);

export const meetingParticipants = pgTable(
  "meeting_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("participant"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    meetingAgentUq: uniqueIndex("meeting_participants_meeting_agent_uq").on(table.meetingId, table.agentId),
    companyAgentIdx: index("meeting_participants_company_agent_idx").on(table.companyId, table.agentId),
  }),
);

export const meetingIssueLinks = pgTable(
  "meeting_issue_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    linkKind: text("link_kind").notNull().default("mentioned"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    meetingIssueKindUq: uniqueIndex("meeting_issue_links_meeting_issue_kind_uq").on(
      table.meetingId,
      table.issueId,
      table.linkKind,
    ),
    companyIssueIdx: index("meeting_issue_links_company_issue_idx").on(table.companyId, table.issueId),
  }),
);
