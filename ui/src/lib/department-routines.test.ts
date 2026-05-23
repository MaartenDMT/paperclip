import { describe, expect, it } from "vitest";
import { buildMissingDepartmentRoutinePlans } from "./department-routines";

describe("buildMissingDepartmentRoutinePlans", () => {
  it("builds a production cycle plus dedicated routines for active department heads", () => {
    const plans = buildMissingDepartmentRoutinePlans({
      agents: [
        { id: "ceo-1", name: "CEO", role: "ceo", status: "active" },
        { id: "cto-1", name: "CTO", role: "cto", status: "idle" },
        { id: "cmo-1", name: "CMO", role: "cmo", status: "running" },
        { id: "old-cfo", name: "Old CFO", role: "cfo", status: "terminated" },
      ],
      existingRoutines: [],
      projectId: "project-1",
      goalId: "goal-1",
    });

    expect(plans.map((plan) => plan.title)).toEqual([
      "Production cycle: daily operating review",
      "Engineering: delivery and blocker review",
      "Growth: pipeline and distribution review",
    ]);
    expect(plans[0]).toMatchObject({
      assigneeAgentId: "ceo-1",
      projectId: "project-1",
      goalId: "goal-1",
      trigger: { cronExpression: "30 8 * * 1-5" },
    });
  });

  it("skips department routines that already exist by normalized title", () => {
    const plans = buildMissingDepartmentRoutinePlans({
      agents: [
        { id: "ceo-1", name: "CEO", role: "ceo", status: "active" },
        { id: "cto-1", name: "CTO", role: "cto", status: "active" },
      ],
      existingRoutines: [
        { title: "production cycle: daily operating review" },
      ],
      projectId: null,
      goalId: null,
    });

    expect(plans.map((plan) => plan.title)).toEqual(["Engineering: delivery and blocker review"]);
    expect(plans[0]).toMatchObject({
      projectId: null,
      goalId: null,
      assigneeAgentId: "cto-1",
    });
  });
});
