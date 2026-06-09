import { describe, expect, it } from "vitest";
import {
  buildReadersbaseFictionAgentPlan,
  READERSBASE_CURRENT_FICTION_PRIORITY_NOTE,
} from "./readersbase-fiction-runtime-audit.js";

describe("readersbase fiction runtime audit", () => {
  it("prioritizes novels, fantasy, genre-mix, sci-fi, and series while pausing short story and novella agents", () => {
    const agents = [
      {
        id: "novelist",
        name: "Novelist",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        recentFailures: 0,
      },
      {
        id: "interactive",
        name: "Interactive Fiction Designer",
        status: "paused",
        adapterType: "codex_local",
        adapterConfig: {},
        recentFailures: 0,
      },
      {
        id: "short",
        name: "Short Fiction Writer",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        recentFailures: 0,
      },
      {
        id: "novella",
        name: "Novella Writer",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        recentFailures: 0,
      },
    ];

    const plan = buildReadersbaseFictionAgentPlan(agents);

    expect(plan.upgrades.map((upgrade) => upgrade.agent.name)).toEqual([
      "Novelist",
      "Interactive Fiction Designer",
    ]);
    expect(plan.pauses.map((pause) => pause.agent.name)).toEqual([
      "Short Fiction Writer",
      "Novella Writer",
    ]);
    expect(plan.resumes.map((resume) => resume.agent.name)).toEqual([
      "Interactive Fiction Designer",
    ]);
    expect(
      plan.upgrades.every(
        (upgrade) =>
          typeof upgrade.nextConfig.promptTemplate === "string" &&
          upgrade.nextConfig.promptTemplate.includes(READERSBASE_CURRENT_FICTION_PRIORITY_NOTE) &&
          upgrade.nextConfig.promptTemplate.includes("fantasy") &&
          upgrade.nextConfig.promptTemplate.includes("genre-mix") &&
          upgrade.nextConfig.promptTemplate.includes("sci-fi"),
      ),
    ).toBe(true);
    expect(plan.pauses.every((pause) => pause.reason.includes("short stories and novellas"))).toBe(true);
  });
});
