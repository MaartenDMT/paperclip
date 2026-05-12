import { describe, expect, it } from "vitest";
import {
  type AgentSnapshot,
  agentsInTeam,
  pickAgentForTeam,
} from "./department-router.js";

function agent(partial: Partial<AgentSnapshot> & { id: string }): AgentSnapshot {
  return {
    reportsTo: null,
    name: null,
    role: null,
    status: "idle",
    inflightCount: 0,
    lastHeartbeatAt: new Date("2026-05-11T08:00:00Z"),
    ...partial,
  };
}

/**
 * Test fixture mirrors the real production tree (compact subset):
 *   ceo
 *   ├─ cto
 *   │  ├─ engA
 *   │  └─ engB
 *   └─ cmo
 *      └─ mktA
 */
function fixture(overrides: Record<string, Partial<AgentSnapshot>> = {}): AgentSnapshot[] {
  const ids = ["ceo", "cto", "engA", "engB", "cmo", "mktA"] as const;
  const parents: Record<typeof ids[number], string | null> = {
    ceo: null, cto: "ceo", engA: "cto", engB: "cto", cmo: "ceo", mktA: "cmo",
  };
  return ids.map((id) => agent({ id, reportsTo: parents[id], ...overrides[id] }));
}

describe("agentsInTeam", () => {
  it("returns the lead and all descendants", () => {
    const ids = agentsInTeam(fixture(), "cto").map((a) => a.id).sort();
    expect(ids).toEqual(["cto", "engA", "engB"]);
  });

  it("returns just the lead when no descendants", () => {
    const ids = agentsInTeam(fixture(), "mktA").map((a) => a.id);
    expect(ids).toEqual(["mktA"]);
  });

  it("returns [] for unknown leadId", () => {
    expect(agentsInTeam(fixture(), "ghost")).toEqual([]);
  });

  it("traverses the whole company when called on the root (CEO)", () => {
    expect(agentsInTeam(fixture(), "ceo")).toHaveLength(6);
  });

  it("survives a reports_to cycle without infinite-looping", () => {
    const broken = fixture();
    // Inject a cycle: cto.reports_to = engA, engA.reports_to = cto
    broken.find((a) => a.id === "cto")!.reportsTo = "engA";
    broken.find((a) => a.id === "engA")!.reportsTo = "cto";
    // Calling on either side should terminate; result content here is
    // best-effort but the test we care about is "does not hang".
    const result = agentsInTeam(broken, "cto");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("pickAgentForTeam (policy A: strict + wait)", () => {
  it("returns null when nobody is idle in the team", () => {
    const agents = fixture({
      cto: { status: "running" },
      engA: { status: "running" },
      engB: { status: "error" },
    });
    expect(pickAgentForTeam(agents, "cto")).toBeNull();
  });

  it("picks the only idle agent in the team", () => {
    const agents = fixture({
      cto: { status: "running" },
      engA: { status: "idle" },
      engB: { status: "error" },
    });
    expect(pickAgentForTeam(agents, "cto")?.id).toBe("engA");
  });

  it("prefers least-loaded subordinate", () => {
    const agents = fixture({
      cto: { status: "idle", inflightCount: 0 },
      engA: { status: "idle", inflightCount: 3 },
      engB: { status: "idle", inflightCount: 1 },
    });
    // CTO has 0 inflight, but tie-break aside this just verifies the
    // least-loaded rule. CTO wins because lowest inflight.
    expect(pickAgentForTeam(agents, "cto")?.id).toBe("cto");
  });

  it("tie-breaks on most-recent heartbeat", () => {
    const older = new Date("2026-05-11T06:00:00Z");
    const newer = new Date("2026-05-11T07:59:00Z");
    const agents = fixture({
      engA: { lastHeartbeatAt: older },
      engB: { lastHeartbeatAt: newer },
      cto: { status: "running" }, // remove the lead from contention
    });
    expect(pickAgentForTeam(agents, "cto")?.id).toBe("engB");
  });

  it("never spills out of the team — won't return a marketing agent for engineering", () => {
    const agents = fixture({
      cto: { status: "error" },
      engA: { status: "error" },
      engB: { status: "error" },
      // mktA is idle but in a different team
      mktA: { status: "idle" },
    });
    expect(pickAgentForTeam(agents, "cto")).toBeNull();
  });

  it("treats the whole company as the team when called on the CEO", () => {
    const agents = fixture({
      // everybody under CTO is busy
      cto: { status: "running" },
      engA: { status: "running" },
      engB: { status: "running" },
      // marketing is free
      cmo: { status: "idle", inflightCount: 0 },
      mktA: { status: "idle", inflightCount: 0 },
    });
    const pick = pickAgentForTeam(agents, "ceo");
    expect(pick).not.toBeNull();
    // CEO is part of its own team and idle by default → it can be picked too.
    expect(["ceo", "cmo", "mktA"]).toContain(pick!.id);
  });

  it("returns null for unknown teamLeadId", () => {
    expect(pickAgentForTeam(fixture(), "ghost")).toBeNull();
  });
});
