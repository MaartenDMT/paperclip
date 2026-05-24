// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildNewAgentHirePayload } from "./new-agent-hire-payload";
import { defaultCreateValues } from "../components/agent-config-defaults";

describe("buildNewAgentHirePayload", () => {
  it("persists the selected default environment id", () => {
    expect(
      buildNewAgentHirePayload({
        name: "Linux Claude",
        effectiveRole: "general",
        configValues: {
          ...defaultCreateValues,
          adapterType: "claude_local",
          defaultEnvironmentId: "11111111-1111-4111-8111-111111111111",
        },
        adapterConfig: { foo: "bar" },
      }),
    ).toMatchObject({
      name: "Linux Claude",
      role: "general",
      adapterType: "claude_local",
      defaultEnvironmentId: "11111111-1111-4111-8111-111111111111",
      adapterConfig: { foo: "bar" },
      budgetMonthlyCents: 0,
    });
  });

  it("sends null when no default environment is selected", () => {
    expect(
      buildNewAgentHirePayload({
        name: "Local Claude",
        effectiveRole: "general",
        configValues: {
          ...defaultCreateValues,
          adapterType: "claude_local",
        },
        adapterConfig: {},
      }),
    ).toMatchObject({
      defaultEnvironmentId: null,
    });
  });

  it("adds role-based Codex fallback model profile when a Codex agent has no explicit cheap fallback", () => {
    expect(
      buildNewAgentHirePayload({
        name: "CEO",
        effectiveRole: "ceo",
        configValues: {
          ...defaultCreateValues,
          adapterType: "codex_local",
          model: "gpt-5.4",
        },
        adapterConfig: { model: "gpt-5.4" },
      }),
    ).toMatchObject({
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      runtimeConfig: {
        modelProfiles: {
          cheap: {
            enabled: true,
            adapterConfig: {
              provider: "openai",
              model: "gpt-5.3-codex",
              modelReasoningEffort: "high",
            },
          },
        },
      },
    });
  });
});
