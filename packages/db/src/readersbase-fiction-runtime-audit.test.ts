import { describe, expect, it } from "vitest";
import {
  buildReadersbaseFictionAgentPlan,
  READERSBASE_CURRENT_FICTION_PRIORITY_NOTE,
  READERSBASE_WORLD_VAULT_DETAIL_NOTE,
} from "./readersbase-fiction-runtime-audit.js";

describe("readersbase fiction runtime audit", () => {
  it("keeps novel, interactive, short-story, and novella lanes active for World Vault work", () => {
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
      "Short Fiction Writer",
      "Novella Writer",
    ]);
    expect(plan.pauses).toEqual([]);
    expect(plan.resumes.map((resume) => resume.agent.name)).toEqual([
      "Interactive Fiction Designer",
    ]);
    expect(
      plan.upgrades.every(
        (upgrade) =>
          typeof upgrade.nextConfig.promptTemplate === "string" &&
          upgrade.nextConfig.promptTemplate.includes(READERSBASE_CURRENT_FICTION_PRIORITY_NOTE) &&
          upgrade.nextConfig.promptTemplate.includes(READERSBASE_WORLD_VAULT_DETAIL_NOTE) &&
          upgrade.nextConfig.promptTemplate.includes("fantasy") &&
          upgrade.nextConfig.promptTemplate.includes("genre-mix") &&
          upgrade.nextConfig.promptTemplate.includes("sci-fi") &&
          upgrade.nextConfig.promptTemplate.includes("novellas") &&
          upgrade.nextConfig.promptTemplate.includes("short stories"),
      ),
    ).toBe(true);
  });

  it("includes research/classification and source-of-truth guidance in fiction department upgrades", () => {
    const agents = [
      {
        id: "research",
        name: "Research & Classification Agent",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        recentFailures: 0,
      },
      {
        id: "character",
        name: "Character Architect",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        recentFailures: 0,
      },
      {
        id: "plot",
        name: "Plot Architect",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        recentFailures: 0,
      },
      {
        id: "world",
        name: "Worldbuilding Architect",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        recentFailures: 0,
      },
      {
        id: "catalog",
        name: "Catalog QA Analyst",
        status: "idle",
        adapterType: "opencode_local",
        adapterConfig: {},
        recentFailures: 0,
      },
      {
        id: "draft",
        name: "Novelist",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        recentFailures: 0,
      },
    ];

    const plan = buildReadersbaseFictionAgentPlan(agents);

    expect(plan.upgrades.map((upgrade) => upgrade.agent.name)).toEqual([
      "Research & Classification Agent",
      "Character Architect",
      "Plot Architect",
      "Worldbuilding Architect",
      "Catalog QA Analyst",
      "Novelist",
    ]);
    expect(
      plan.upgrades.every((upgrade) => {
        const promptTemplate = upgrade.nextConfig.promptTemplate;
        return typeof promptTemplate === "string" &&
          promptTemplate.includes("ReadersBase codebase and live website are the source of truth") &&
          promptTemplate.includes("Research & Classification Agent owns story research") &&
          promptTemplate.includes("story alignment meetings") &&
          promptTemplate.includes("left-panel Files, Phase, and Tree tabs") &&
          promptTemplate.includes("timeline/plotline/scene trackers") &&
          promptTemplate.includes("Never treat post-hoc build packs");
      }),
    ).toBe(true);
  });

  it("plans missing series, genre specialist, and research agents under the fiction director", () => {
    const agents = [
      {
        id: "fiction-director",
        name: "Fiction Director",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        recentFailures: 0,
      },
      {
        id: "existing-fantasy",
        name: "Fantasy Architect",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        recentFailures: 0,
      },
    ];

    const plan = buildReadersbaseFictionAgentPlan(agents);

    expect(plan.creates.map((create) => create.name)).toEqual([
      "Research & Classification Agent",
      "Series Architect",
      "Genre-Mix Architect",
      "Sci-Fi Architect",
    ]);
    expect(plan.creates.every((create) => create.reportsTo === "fiction-director")).toBe(true);
    expect(plan.creates.map((create) => create.role)).toEqual([
      "research_classification",
      "series_architect",
      "genre_mix_architect",
      "sci_fi_architect",
    ]);
    expect(
      plan.creates.every((create) =>
        create.capabilities.includes("ReadersBase codebase and live website are the source of truth") &&
        create.adapterType === "codex_local" &&
        create.adapterConfig.model === "gpt-5.3-codex" &&
        create.adapterConfig.modelReasoningEffort === "xhigh" &&
        typeof create.adapterConfig.promptTemplate === "string" &&
        create.adapterConfig.promptTemplate.includes("World Vault quality gate"),
      ),
    ).toBe(true);
  });
});
