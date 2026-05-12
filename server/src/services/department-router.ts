/**
 * Department router — picks an agent for a task based on which "team" should
 * handle it. A team is defined by the `reports_to` org chart already populated
 * in the agents table: a team-lead's id identifies the team, and the team is
 * the transitive set of descendants under that lead (inclusive of the lead).
 *
 * Example, for the live data:
 *   CEO (root)
 *   ├─ CTO          → engineering team (14 agents incl. CTO)
 *   ├─ CMO          → marketing team (8 agents)
 *   ├─ Fiction Dir. → content team (11 agents)
 *   └─ UXDesigner   → design team (2 agents)
 *
 * Phase 1 (this file): pure picker. No DB writes, no side effects. Wires up
 * later via a wakeup-request `team_lead_id` hint column.
 */

export type AgentSnapshot = {
  id: string;
  reportsTo: string | null;
  name: string | null;
  role: string | null;
  status: string;               // 'idle' | 'running' | 'error' | 'paused' | 'terminated'
  inflightCount: number;
  lastHeartbeatAt: Date | null;
};

/** Build a parent->children map once per call. */
function childrenIndex(agents: AgentSnapshot[]): Map<string, AgentSnapshot[]> {
  const idx = new Map<string, AgentSnapshot[]>();
  for (const a of agents) {
    if (a.reportsTo == null) continue;
    const arr = idx.get(a.reportsTo) ?? [];
    arr.push(a);
    idx.set(a.reportsTo, arr);
  }
  return idx;
}

/**
 * All agents in the subtree rooted at `leadId`, including the lead itself.
 * Returns [] when leadId isn't found.
 *
 * Cycle-safe: tracks visited ids; a malformed reports_to cycle still
 * terminates rather than looping forever.
 */
export function agentsInTeam(agents: AgentSnapshot[], leadId: string): AgentSnapshot[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const lead = byId.get(leadId);
  if (!lead) return [];
  const children = childrenIndex(agents);
  const out: AgentSnapshot[] = [];
  const seen = new Set<string>();
  const stack: AgentSnapshot[] = [lead];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur.id)) continue;
    seen.add(cur.id);
    out.push(cur);
    for (const child of children.get(cur.id) ?? []) stack.push(child);
  }
  return out;
}

/**
 * Pick the best candidate agent for a task targeting the team led by
 * `teamLeadId`. Policy (A): strict — never spill out of the team. Return
 * null and let the wakeup-request stay queued if no one in the team is idle.
 *
 * Tie-break: lowest inflightCount, then most-recent heartbeat. The lead
 * itself is a valid candidate, but loses every tie-break against a busier
 * subordinate (managers absorb work last, which is what you want).
 */
export function pickAgentForTeam(
  agents: AgentSnapshot[],
  teamLeadId: string,
): AgentSnapshot | null {
  const team = agentsInTeam(agents, teamLeadId);
  const idle = team.filter((a) => a.status === "idle");
  if (idle.length === 0) return null;
  idle.sort((a, b) => {
    if (a.inflightCount !== b.inflightCount) return a.inflightCount - b.inflightCount;
    const aHb = a.lastHeartbeatAt?.getTime() ?? 0;
    const bHb = b.lastHeartbeatAt?.getTime() ?? 0;
    return bHb - aHb;
  });
  return idle[0] ?? null;
}

import { eq, sql } from "drizzle-orm";
import {
  type Db,
  agents as agentsTable,
  heartbeatRuns,
} from "@paperclipai/db";

/**
 * Load every agent in a company plus its in-flight run count, build snapshots,
 * and pick a concrete agent id from the team rooted at `teamLeadId`.
 *
 * Callers invoke this BEFORE inserting a wakeup-request so they can fill in a
 * concrete `agent_id`. Returns null if the team has no idle member — callers
 * should then either fall back to a default agent or defer the task.
 */
export async function resolveTeamLeadToAgentId(
  db: Db,
  companyId: string,
  teamLeadId: string,
): Promise<string | null> {
  const rows = await db
    .select({
      id: agentsTable.id,
      reportsTo: agentsTable.reportsTo,
      name: agentsTable.name,
      role: agentsTable.role,
      status: agentsTable.status,
      lastHeartbeatAt: agentsTable.lastHeartbeatAt,
      inflight: sql<number>`(
        SELECT COUNT(*)::int FROM ${heartbeatRuns}
        WHERE ${heartbeatRuns.agentId} = ${agentsTable.id}
          AND ${heartbeatRuns.status} IN ('queued','running','scheduled_retry')
      )`,
    })
    .from(agentsTable)
    .where(eq(agentsTable.companyId, companyId));

  const snapshots: AgentSnapshot[] = rows.map((r) => ({
    id: r.id,
    reportsTo: r.reportsTo,
    name: r.name,
    role: r.role,
    status: r.status,
    inflightCount: Number(r.inflight) || 0,
    lastHeartbeatAt: r.lastHeartbeatAt,
  }));

  return pickAgentForTeam(snapshots, teamLeadId)?.id ?? null;
}
