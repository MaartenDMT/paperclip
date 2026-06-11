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

  it("adds role-based Codex fallback model profile when an agent has no explicit cheap fallback", () => {
    expect(
      buildNewAgentHirePayload({
        name: "CEO",
        effectiveRole: "ceo",
        configValues: {
          ...defaultCreateValues,
          adapterType: "claude_local",
          model: "claude-opus-4-7",
        },
        adapterConfig: { model: "claude-opus-4-7" },
      }),
    ).toMatchObject({
      adapterType: "claude_local",
      adapterConfig: { model: "claude-opus-4-7" },
      runtimeConfig: {
        modelProfiles: {
          cheap: {
            enabled: true,
            adapterConfig: {
              adapterType: "codex_local",
              command: "codex",
              provider: "openai",
              model: "gpt-5.4",
              modelReasoningEffort: "medium",
            },
          },
          fallback: {
            enabled: true,
            adapterConfig: {
              adapterType: "codex_local",
              command: "codex",
              provider: "openai",
              model: "gpt-5.4",
              modelReasoningEffort: "medium",
            },
          },
        },
      },
    });
  });

  it("defaults lower-role agents to MiniMax cheap profile with Codex fallback", () => {
    expect(
      buildNewAgentHirePayload({
        name: "General Worker",
        effectiveRole: "general",
        configValues: {
          ...defaultCreateValues,
          adapterType: "claude_local",
          model: "claude-sonnet-4-6",
        },
        adapterConfig: { model: "claude-sonnet-4-6" },
      }),
    ).toMatchObject({
      adapterType: "claude_local",
      runtimeConfig: {
        modelProfiles: {
          cheap: {
            enabled: true,
            adapterConfig: {
              adapterType: "minimax_local",
              command: "opencode",
              model: "minimax/MiniMax-M2.1",
            },
          },
          fallback: {
            enabled: true,
            adapterConfig: {
              adapterType: "codex_local",
              command: "codex",
              provider: "openai",
              model: "gpt-5.4-mini",
              modelReasoningEffort: "low",
            },
          },
        },
      },
    });
  });

  it("keeps high-stakes agents on Codex fallback profiles", () => {
    expect(
      buildNewAgentHirePayload({
        name: "Security Lead",
        effectiveRole: "security",
        configValues: {
          ...defaultCreateValues,
          adapterType: "claude_local",
          model: "claude-opus-4-7",
        },
        adapterConfig: { model: "claude-opus-4-7" },
      }),
    ).toMatchObject({
      runtimeConfig: {
        modelProfiles: {
          fallback: {
            adapterConfig: {
              adapterType: "codex_local",
              model: "gpt-5.4",
            },
          },
        },
      },
    });
  });

  it("keeps coding and QA agents on Codex fallback profiles", () => {
    for (const effectiveRole of ["engineer", "qa"]) {
      expect(
        buildNewAgentHirePayload({
          name: `${effectiveRole} Agent`,
          effectiveRole,
          configValues: {
            ...defaultCreateValues,
            adapterType: "claude_local",
            model: "claude-sonnet-4-6",
          },
          adapterConfig: { model: "claude-sonnet-4-6" },
        }),
      ).toMatchObject({
        runtimeConfig: {
          modelProfiles: {
            fallback: {
              adapterConfig: {
                adapterType: "codex_local",
              },
            },
          },
        },
      });
    }
  });

  it("keeps explicit cheap models on the current adapter when no adapter override is supplied", () => {
    expect(
      buildNewAgentHirePayload({
        name: "MiniMax Worker",
        effectiveRole: "general",
        configValues: {
          ...defaultCreateValues,
          adapterType: "minimax_local",
          model: "minimax/MiniMax-M2.7",
          cheapModel: "minimax/MiniMax-M2.1",
          cheapModelEnabled: true,
          fallbackModel: "gpt-5.4-mini",
          fallbackModelEnabled: true,
          fallbackModelAdapterType: "codex_local",
          fallbackModelCommand: "codex",
          fallbackModelProvider: "openai",
          fallbackModelReasoningEffort: "low",
        },
        adapterConfig: { model: "minimax/MiniMax-M2.7" },
      }),
    ).toMatchObject({
      runtimeConfig: {
        modelProfiles: {
          cheap: {
            enabled: true,
            adapterConfig: {
              model: "minimax/MiniMax-M2.1",
            },
          },
          fallback: {
            enabled: true,
            adapterConfig: {
              adapterType: "codex_local",
              model: "gpt-5.4-mini",
            },
          },
        },
      },
    });
  });
});
