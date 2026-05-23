import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, routineTriggers, routines } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import { routineService } from "./routines.js";

export const MEMORY_MAINTENANCE_ROUTINE_TITLE = "Memory files cleanup and optimization";
export const MEMORY_MAINTENANCE_ROUTINE_MARKER = "paperclip:builtin-memory-maintenance:v1";
const MEMORY_MAINTENANCE_TRIGGER_LABEL = "Weekly memory maintenance";
const MEMORY_MAINTENANCE_CRON = "0 8 * * 1";
const MEMORY_MAINTENANCE_TIMEZONE = "Europe/Brussels";
const INVOKABLE_AGENT_STATUSES = ["active", "idle", "running", "error"] as const;

type AgentCandidate = Pick<typeof agents.$inferSelect, "id" | "name" | "role" | "title" | "status" | "createdAt">;

function memoryMaintenanceRoutineDescription() {
  return [
    `<!-- ${MEMORY_MAINTENANCE_ROUTINE_MARKER} -->`,
    "",
    "Run the Paperclip memory-file maintenance routine for this company.",
    "",
    "Scope:",
    "- Karpathy Obsidian memory vault: `A:\\Programming\\paperclip\\memory\\obsidian`.",
    "- PARA agent memory files under `$AGENT_HOME/life`, `$AGENT_HOME/memory`, and `$AGENT_HOME/MEMORY.md`.",
    "- Recent issue meetings, especially `memoryCorrections`, `workflowCorrections`, and `ideas` recorded in agent meeting outcomes.",
    "",
    "Required routine:",
    "- Use `karpathy-obsidian-memory` before editing shared Obsidian issue, decision, agent, or project notes.",
    "- Use `para-memory-files` before editing PARA summaries, daily notes, tacit memory, or atomic YAML facts.",
    "- Treat Paperclip API state as authoritative. Memory files preserve durable context, rationale, decisions, and handoff notes.",
    "- Correct wrong memory by appending or superseding facts; do not silently delete historical facts.",
    "- Merge obvious duplicates, archive inactive PARA entities, refresh stale summaries from active facts, and fix broken wikilinks or stale references when the correction is clear.",
    "- Do not write secrets, tokens, cookies, private keys, or raw confidential payloads into memory.",
    "- Create follow-up issues for risky cleanups, ambiguous contradictions, missing owners, large reorganizations, or memory corrections that need another agent's domain review.",
    "",
    "Expected handoff:",
    "- Files inspected and files changed.",
    "- Incorrect or stale memories corrected, including the evidence used.",
    "- Duplicates merged or archived, with paths.",
    "- Meeting-derived memory corrections applied or converted into follow-up issues.",
    "- New issues or tasks created for unresolved memory, workflow, or idea-sharing follow-ups.",
  ].join("\n");
}

function statusScore(status: string) {
  if (status === "idle") return 0;
  if (status === "active") return 1;
  if (status === "error") return 2;
  return 3;
}

function stewardScore(agent: AgentCandidate) {
  const role = agent.role.toLowerCase();
  const name = agent.name.toLowerCase();
  const title = (agent.title ?? "").toLowerCase();
  const haystack = `${role} ${name} ${title}`;

  if (role === "worktree_steward") return 0;
  if (name === "worktree steward") return 1;
  if (role.includes("steward")) return 2;
  if (name.includes("steward") || title.includes("steward")) return 3;
  if (role.includes("engineering_operations") || role.includes("engineering_ops")) return 4;
  if (role.includes("operations") || role === "ops") return 5;
  if (name.includes("engineering operations") || title.includes("engineering operations")) return 6;
  if (haystack.includes("memory steward")) return 7;
  return null;
}

function chooseStewardAgent(candidates: AgentCandidate[]) {
  return candidates
    .map((agent) => ({ agent, score: stewardScore(agent) }))
    .filter((entry): entry is { agent: AgentCandidate; score: number } => entry.score !== null)
    .sort((left, right) =>
      left.score - right.score ||
      statusScore(left.agent.status) - statusScore(right.agent.status) ||
      left.agent.createdAt.getTime() - right.agent.createdAt.getTime() ||
      left.agent.id.localeCompare(right.agent.id)
    )[0]?.agent ?? null;
}

export function memoryMaintenanceRoutineService(db: Db) {
  const routinesSvc = routineService(db);

  async function findStewardAgent(companyId: string) {
    const candidates = await db
      .select({
        id: agents.id,
        name: agents.name,
        role: agents.role,
        title: agents.title,
        status: agents.status,
        createdAt: agents.createdAt,
      })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), inArray(agents.status, [...INVOKABLE_AGENT_STATUSES])))
      .orderBy(asc(agents.createdAt), asc(agents.id));
    return chooseStewardAgent(candidates);
  }

  async function findExistingRoutine(companyId: string) {
    const markerPattern = `%${MEMORY_MAINTENANCE_ROUTINE_MARKER}%`;
    return db
      .select()
      .from(routines)
      .where(
        and(
          eq(routines.companyId, companyId),
          sql`(${routines.description} like ${markerPattern} or ${routines.title} = ${MEMORY_MAINTENANCE_ROUTINE_TITLE})`,
        ),
      )
      .orderBy(asc(routines.createdAt), asc(routines.id))
      .then((rows) => rows[0] ?? null);
  }

  async function ensureDefaultTrigger(routineId: string) {
    const existingTrigger = await db
      .select({ id: routineTriggers.id })
      .from(routineTriggers)
      .where(and(eq(routineTriggers.routineId, routineId), eq(routineTriggers.label, MEMORY_MAINTENANCE_TRIGGER_LABEL)))
      .then((rows) => rows[0] ?? null);
    if (existingTrigger) return { created: false };

    await routinesSvc.createTrigger(routineId, {
      kind: "schedule",
      label: MEMORY_MAINTENANCE_TRIGGER_LABEL,
      enabled: true,
      cronExpression: MEMORY_MAINTENANCE_CRON,
      timezone: MEMORY_MAINTENANCE_TIMEZONE,
    }, { userId: null, agentId: null });
    return { created: true };
  }

  async function ensureForCompany(companyId: string) {
    const steward = await findStewardAgent(companyId);
    const existing = await findExistingRoutine(companyId);
    if (!existing) {
      const routine = await routinesSvc.create(companyId, {
        title: MEMORY_MAINTENANCE_ROUTINE_TITLE,
        description: memoryMaintenanceRoutineDescription(),
        assigneeAgentId: steward?.id ?? null,
        priority: "low",
        status: steward ? "active" : "paused",
        concurrencyPolicy: "coalesce_if_active",
        catchUpPolicy: "skip_missed",
        variables: [],
      }, { userId: null, agentId: null });
      const trigger = await ensureDefaultTrigger(routine.id);
      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "memory-maintenance-routine",
        action: "runtime.memory_maintenance_routine.created",
        entityType: "routine",
        entityId: routine.id,
        details: {
          assigneeAgentId: steward?.id ?? null,
          triggerCreated: trigger.created,
        },
      });
      return { status: "created" as const, routineId: routine.id, assigneeAgentId: routine.assigneeAgentId };
    }

    let routine = existing;
    let updated = false;
    if (routine.status === "archived") {
      return { status: "unchanged" as const, routineId: routine.id, assigneeAgentId: routine.assigneeAgentId };
    }
    if (!routine.assigneeAgentId && steward) {
      const next = await routinesSvc.update(routine.id, {
        assigneeAgentId: steward.id,
        status: "active",
      }, { userId: null, agentId: null });
      if (next) {
        routine = next;
        updated = true;
        await logActivity(db, {
          companyId,
          actorType: "system",
          actorId: "memory-maintenance-routine",
          action: "runtime.memory_maintenance_routine.assigned",
          entityType: "routine",
          entityId: routine.id,
          details: { assigneeAgentId: steward.id },
        });
      }
    }
    const trigger = await ensureDefaultTrigger(routine.id);
    if (trigger.created) {
      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "memory-maintenance-routine",
        action: "runtime.memory_maintenance_routine.trigger_created",
        entityType: "routine",
        entityId: routine.id,
        details: { triggerLabel: MEMORY_MAINTENANCE_TRIGGER_LABEL },
      });
    }
    return {
      status: updated || trigger.created ? "updated" as const : "unchanged" as const,
      routineId: routine.id,
      assigneeAgentId: routine.assigneeAgentId,
    };
  }

  async function ensureForCompanies(companyIds: string[]) {
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const companyId of companyIds) {
      try {
        const result = await ensureForCompany(companyId);
        if (result.status === "created") created += 1;
        else if (result.status === "updated") updated += 1;
        else unchanged += 1;
      } catch (err) {
        logger.warn({ err, companyId }, "failed to reconcile memory maintenance routine");
      }
    }
    return { companies: companyIds.length, created, updated, unchanged };
  }

  return {
    ensureForCompany,
    ensureForCompanies,
  };
}
