import { describe, expect, it } from "vitest";
import type { AdapterModelProfileDefinition } from "../adapters/index.js";
import {
  consumeWakeContextModelProfile,
  mergeModelProfileAdapterConfig,
  normalizeModelProfileWakeContext,
  parseIssueAssigneeAdapterOverrides,
  resolveModelProfileApplication,
} from "../services/heartbeat.ts";

const cheapProfile: AdapterModelProfileDefinition = {
  key: "cheap",
  label: "Cheap",
  adapterConfig: {
    model: "adapter-cheap",
    modelReasoningEffort: "low",
  },
  source: "adapter_default",
};

const fallbackProfile: AdapterModelProfileDefinition = {
  key: "fallback",
  label: "Fallback",
  adapterConfig: {
    model: "adapter-fallback",
    modelReasoningEffort: "low",
  },
  source: "adapter_default",
};

describe("heartbeat model profile application", () => {
  it("applies cheap profile patches before explicit issue adapter config overrides", () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [cheapProfile],
      agentRuntimeConfig: {},
      issueModelProfile: "cheap",
      contextSnapshot: {},
    });

    const merged = mergeModelProfileAdapterConfig({
      baseConfig: {
        model: "primary",
        modelReasoningEffort: "high",
        approvalPolicy: "strict",
      },
      modelProfile,
      issueAdapterConfig: {
        model: "issue-explicit",
      },
    });

    expect(modelProfile).toMatchObject({
      requested: "cheap",
      requestedBy: "issue_override",
      applied: "cheap",
      configSource: "adapter_default",
      fallbackReason: null,
    });
    expect(merged).toEqual({
      model: "issue-explicit",
      modelReasoningEffort: "low",
      approvalPolicy: "strict",
    });
  });

  it("lets agent runtime profile config customize adapter defaults", () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [cheapProfile],
      agentRuntimeConfig: {
        modelProfiles: {
          cheap: {
            adapterConfig: {
              model: "agent-cheap",
            },
          },
        },
      },
      issueModelProfile: null,
      contextSnapshot: { modelProfile: "cheap" },
    });

    expect(modelProfile).toMatchObject({
      requested: "cheap",
      requestedBy: "wake_context",
      applied: "cheap",
      configSource: "agent_runtime",
      adapterConfig: {
        model: "agent-cheap",
        modelReasoningEffort: "low",
      },
    });
  });

  it("treats empty runtime profile stubs as adapter defaults", () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [cheapProfile],
      agentRuntimeConfig: {
        modelProfiles: {
          cheap: {
            adapterConfig: {},
          },
        },
      },
      issueModelProfile: null,
      contextSnapshot: { modelProfile: "cheap" },
    });

    expect(modelProfile).toMatchObject({
      requested: "cheap",
      requestedBy: "wake_context",
      applied: "cheap",
      configSource: "adapter_default",
      fallbackReason: null,
      adapterType: null,
      adapterConfig: {
        model: "adapter-cheap",
        modelReasoningEffort: "low",
      },
    });
  });

  it("falls back to the primary config when the adapter does not support the requested profile", () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [],
      agentRuntimeConfig: {
        modelProfiles: {
          cheap: {
            adapterConfig: {
              model: "agent-cheap",
            },
          },
        },
      },
      issueModelProfile: null,
      contextSnapshot: { modelProfile: "cheap" },
    });

    const merged = mergeModelProfileAdapterConfig({
      baseConfig: {
        model: "primary",
      },
      modelProfile,
      issueAdapterConfig: null,
    });

    expect(modelProfile).toMatchObject({
      requested: "cheap",
      applied: null,
      fallbackReason: "adapter_profile_not_supported",
      adapterConfig: null,
    });
    expect(merged).toEqual({ model: "primary" });
  });

  it("applies runtime profile config with an adapter override even when the primary adapter has no matching profile", () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [],
      agentRuntimeConfig: {
        modelProfiles: {
          cheap: {
            adapterConfig: {
              adapterType: "codex_local",
              command: "codex",
              provider: "openai",
              model: "gpt-5.3-codex",
              modelReasoningEffort: "high",
            },
          },
        },
      },
      issueModelProfile: null,
      contextSnapshot: { modelProfile: "cheap" },
    });

    const merged = mergeModelProfileAdapterConfig({
      baseConfig: {
        command: "claude",
        model: "claude-opus-4-7",
      },
      modelProfile,
      issueAdapterConfig: null,
    });

    expect(modelProfile).toMatchObject({
      requested: "cheap",
      applied: "cheap",
      configSource: "agent_runtime",
      adapterType: "codex_local",
      adapterConfig: {
        adapterType: "codex_local",
        command: "codex",
        provider: "openai",
        model: "gpt-5.3-codex",
        modelReasoningEffort: "high",
      },
    });
    expect(merged).toMatchObject({
      command: "codex",
      model: "gpt-5.3-codex",
      provider: "openai",
    });
  });

  it("normalizes a wake payload model profile into run context", () => {
    const contextSnapshot = normalizeModelProfileWakeContext({
      contextSnapshot: {},
      payload: { modelProfile: "cheap" },
    });

    expect(contextSnapshot).toMatchObject({ modelProfile: "cheap" });
  });

  it("applies the fallback profile key from wake context", () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [fallbackProfile],
      agentRuntimeConfig: {
        modelProfiles: {
          fallback: {
            adapterConfig: {
              adapterType: "codex_local",
              model: "gpt-5.4-mini",
            },
          },
        },
      },
      issueModelProfile: null,
      contextSnapshot: { modelProfile: "fallback" },
    });

    expect(modelProfile).toMatchObject({
      requested: "fallback",
      applied: "fallback",
      configSource: "agent_runtime",
      adapterType: "codex_local",
      adapterConfig: {
        adapterType: "codex_local",
        model: "gpt-5.4-mini",
      },
    });
  });

  it("consumes wake-context model profile hints after resolving application", () => {
    const contextSnapshot: Record<string, unknown> = {
      modelProfile: "fallback",
      wakeReason: "agent_meeting_requested",
    };
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [fallbackProfile],
      agentRuntimeConfig: {
        modelProfiles: {
          fallback: {
            adapterConfig: {
              model: "gpt-5.4-mini",
            },
          },
        },
      },
      issueModelProfile: null,
      contextSnapshot,
    });

    consumeWakeContextModelProfile(contextSnapshot, modelProfile.requestedBy);

    expect(contextSnapshot.modelProfile).toBeUndefined();
  });

  it("does not consume model profile when the request source is issue override", () => {
    const contextSnapshot: Record<string, unknown> = {
      modelProfile: "fallback",
    };
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [cheapProfile],
      agentRuntimeConfig: {},
      issueModelProfile: "cheap",
      contextSnapshot,
    });

    consumeWakeContextModelProfile(contextSnapshot, modelProfile.requestedBy);

    expect(contextSnapshot.modelProfile).toBe("fallback");
  });

  it("drops stale model and adapterType from assignee adapter overrides", () => {
    const parsed = parseIssueAssigneeAdapterOverrides({
      modelProfile: "cheap",
      adapterConfig: {
        model: "zai-coding-plan/glm-4.7",
        adapterType: "zai_local",
        workspaceStrategy: {
          type: "git_worktree",
        },
      },
    });

    expect(parsed).toMatchObject({
      modelProfile: "cheap",
      adapterConfig: {
        workspaceStrategy: {
          type: "git_worktree",
        },
      },
    });
    expect(parsed?.adapterConfig).not.toHaveProperty("model");
    expect(parsed?.adapterConfig).not.toHaveProperty("adapterType");
  });
});
