import { describe, expect, it } from "vitest";
import {
  loadDefaultAgentInstructionsBundle,
  resolveDefaultAgentInstructionsBundleRole,
} from "./default-agent-instructions.js";

describe("resolveDefaultAgentInstructionsBundleRole", () => {
  it("uses the CEO bundle for the CEO role", () => {
    expect(resolveDefaultAgentInstructionsBundleRole("ceo")).toBe("ceo");
  });

  it.each(["cto", "cmo", "cfo", "pm"])("uses the manager bundle for %s", (role) => {
    expect(resolveDefaultAgentInstructionsBundleRole(role)).toBe("manager");
  });

  it.each(["engineer", "designer", "qa", "general"])("uses the default bundle for %s", (role) => {
    expect(resolveDefaultAgentInstructionsBundleRole(role)).toBe("default");
  });

  it("uses the manager bundle for director-style QA agents", () => {
    expect(resolveDefaultAgentInstructionsBundleRole("qa", { title: "Director of Quality Assurance" })).toBe("manager");
  });

  it("uses the manager bundle for agents with direct reports", () => {
    expect(resolveDefaultAgentInstructionsBundleRole("qa", { title: "QA Analyst", hasDirectReports: true })).toBe(
      "manager",
    );
  });

  it("keeps non-manager QA specialists on the default bundle", () => {
    expect(resolveDefaultAgentInstructionsBundleRole("qa", { title: "QA Analyst", hasDirectReports: false })).toBe(
      "default",
    );
  });
});

describe("loadDefaultAgentInstructionsBundle", () => {
  it("loads the manager instruction bundle", async () => {
    const bundle = await loadDefaultAgentInstructionsBundle("manager");

    expect(Object.keys(bundle).sort()).toEqual(["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"]);
    expect(bundle["AGENTS.md"]).toContain("department manager");
  });
});
