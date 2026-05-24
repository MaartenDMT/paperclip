// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CODEX_LOCAL_FALLBACK_PROVIDER,
  codexModelDefaultsForRole,
  codexModelDefaultsForUseCase,
} from "./codex-agent-model-defaults";

describe("codexModelDefaultsForRole", () => {
  it("uses strong Codex defaults for executive and infrastructure-sensitive roles", () => {
    expect(codexModelDefaultsForRole("ceo")).toEqual({
      useCase: "strong",
      primaryModel: "gpt-5.4",
      fallbackProvider: CODEX_LOCAL_FALLBACK_PROVIDER,
      fallbackModel: "gpt-5.3-codex",
      fallbackReasoningEffort: "high",
    });
    expect(codexModelDefaultsForRole("security").useCase).toBe("strong");
    expect(codexModelDefaultsForRole("devops").useCase).toBe("strong");
  });

  it("uses middle Codex defaults for build and research roles", () => {
    expect(codexModelDefaultsForRole("engineer")).toEqual({
      useCase: "middle",
      primaryModel: "gpt-5.3-codex",
      fallbackProvider: CODEX_LOCAL_FALLBACK_PROVIDER,
      fallbackModel: "gpt-5.2",
      fallbackReasoningEffort: "medium",
    });
    expect(codexModelDefaultsForRole("researcher").useCase).toBe("middle");
    expect(codexModelDefaultsForRole("pm").useCase).toBe("middle");
  });

  it("uses weaker Codex defaults for broad operational roles", () => {
    expect(codexModelDefaultsForRole("general")).toEqual({
      useCase: "weaker",
      primaryModel: "gpt-5.2",
      fallbackProvider: CODEX_LOCAL_FALLBACK_PROVIDER,
      fallbackModel: "gpt-5.4-mini",
      fallbackReasoningEffort: "low",
    });
    expect(codexModelDefaultsForRole("qa").useCase).toBe("weaker");
    expect(codexModelDefaultsForRole("designer").useCase).toBe("weaker");
  });
});

describe("codexModelDefaultsForUseCase", () => {
  it("falls back to middle defaults for unknown use cases", () => {
    expect(codexModelDefaultsForUseCase("")).toMatchObject({
      useCase: "middle",
      primaryModel: "gpt-5.3-codex",
      fallbackModel: "gpt-5.2",
    });
  });
});
