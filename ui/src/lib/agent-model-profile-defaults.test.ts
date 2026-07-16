import { describe, expect, it } from "vitest";
import {
  agentModelProfileDefaultsForRole,
  minimaxCurrentAdapterFallbackDefaults,
  shouldDefaultNewAgentToMiniMax,
} from "./agent-model-profile-defaults";

describe("agent model profile defaults", () => {
  it("uses MiniMax for lower-cost non-intensive roles", () => {
    expect(shouldDefaultNewAgentToMiniMax({ role: "general" })).toBe(true);
    expect(shouldDefaultNewAgentToMiniMax({ role: "researcher" })).toBe(true);
    expect(agentModelProfileDefaultsForRole("general").cheap).toMatchObject({
      adapterType: "minimax_local",
      command: "opencode",
      model: "minimax/MiniMax-M2.1",
    });
    expect(agentModelProfileDefaultsForRole("general").fallback).toMatchObject({
      adapterType: "codex_local",
      command: "codex",
      model: "gpt-5.4-mini",
    });
  });

  it("uses MiniMax for content-writer style titles even when role is custom", () => {
    expect(shouldDefaultNewAgentToMiniMax({
      role: "custom",
      name: "Launch Writer",
      title: "Content Writer",
    })).toBe(true);
  });

  it("keeps first agent, coding, and senior control roles off MiniMax defaults", () => {
    expect(shouldDefaultNewAgentToMiniMax({ role: "general", isFirstAgent: true })).toBe(false);
    expect(shouldDefaultNewAgentToMiniMax({ role: "ceo" })).toBe(false);
    expect(shouldDefaultNewAgentToMiniMax({ role: "cto", title: "Content CTO" })).toBe(false);
    expect(shouldDefaultNewAgentToMiniMax({ role: "engineer", title: "Content Engineer" })).toBe(false);
    expect(shouldDefaultNewAgentToMiniMax({ role: "qa", title: "Quality Analyst" })).toBe(false);
    expect(agentModelProfileDefaultsForRole("cto").fallback.adapterType).toBe("codex_local");
    expect(agentModelProfileDefaultsForRole("engineer").fallback.adapterType).toBe("codex_local");
    expect(agentModelProfileDefaultsForRole("qa").fallback.adapterType).toBe("codex_local");
  });

  it("uses Codex as the fallback when MiniMax is the selected adapter", () => {
    expect(minimaxCurrentAdapterFallbackDefaults()).toMatchObject({
      cheapModel: "minimax/MiniMax-M2.1",
      cheapModelAdapterType: "",
      fallbackModel: "gpt-5.4-mini",
      fallbackModelAdapterType: "codex_local",
      fallbackModelCommand: "codex",
      fallbackModelProvider: "openai",
      fallbackModelReasoningEffort: "low",
    });
  });
});
