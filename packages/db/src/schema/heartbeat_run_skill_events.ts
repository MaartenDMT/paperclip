import { bigserial, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const heartbeatRunSkillEvents = pgTable(
  "heartbeat_run_skill_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    runId: uuid("run_id").notNull().references(() => heartbeatRuns.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    skillKey: text("skill_key").notNull(),
    skillName: text("skill_name").notNull(),
    source: text("source").notNull().default("adapter"),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runActivatedIdx: index("heartbeat_run_skill_events_run_activated_idx").on(table.runId, table.activatedAt),
    companySkillIdx: index("heartbeat_run_skill_events_company_skill_idx").on(
      table.companyId,
      table.skillKey,
      table.activatedAt,
    ),
  }),
);
