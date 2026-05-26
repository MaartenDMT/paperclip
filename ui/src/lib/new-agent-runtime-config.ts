import { AGENT_DEFAULT_MAX_CONCURRENT_RUNS } from "@paperclipai/shared";
import { defaultCreateValues } from "../components/agent-config-defaults";

export function buildNewAgentRuntimeConfig(input?: {
  heartbeatEnabled?: boolean;
  intervalSec?: number;
  cheapModel?: string;
  cheapModelEnabled?: boolean;
  cheapModelAdapterType?: string;
  cheapModelCommand?: string;
  cheapModelProvider?: string;
  cheapModelReasoningEffort?: string;
  fallbackModel?: string;
  fallbackModelEnabled?: boolean;
  fallbackModelAdapterType?: string;
  fallbackModelCommand?: string;
  fallbackModelProvider?: string;
  fallbackModelReasoningEffort?: string;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {
    heartbeat: {
      enabled: input?.heartbeatEnabled ?? defaultCreateValues.heartbeatEnabled,
      intervalSec: input?.intervalSec ?? defaultCreateValues.intervalSec,
      wakeOnDemand: true,
      cooldownSec: 10,
      maxConcurrentRuns: AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
    },
  };

  const modelProfiles: Record<string, unknown> = {};

  function buildProfileAdapterConfig(profileInput: {
    model?: string;
    adapterType?: string;
    command?: string;
    provider?: string;
    reasoningEffort?: string;
  }) {
    const model = profileInput.model?.trim() ?? "";
    if (!model) return null;
    const adapterConfig: Record<string, unknown> = { model };
    const adapterType = profileInput.adapterType?.trim() ?? "";
    if (adapterType) adapterConfig.adapterType = adapterType;
    const command = profileInput.command?.trim() ?? "";
    if (command) adapterConfig.command = command;
    const provider = profileInput.provider?.trim() ?? "";
    if (provider) adapterConfig.provider = provider;
    const reasoningEffort = profileInput.reasoningEffort?.trim() ?? "";
    if (reasoningEffort) adapterConfig.modelReasoningEffort = reasoningEffort;
    return adapterConfig;
  }

  const cheapEnabled = input?.cheapModelEnabled ?? false;
  const cheapAdapterConfig = cheapEnabled
    ? buildProfileAdapterConfig({
        model: input?.cheapModel,
        adapterType: input?.cheapModelAdapterType,
        command: input?.cheapModelCommand,
        provider: input?.cheapModelProvider,
        reasoningEffort: input?.cheapModelReasoningEffort,
      })
    : null;
  if (cheapAdapterConfig) {
    modelProfiles.cheap = {
      enabled: true,
      adapterConfig: cheapAdapterConfig,
    };
  }

  const fallbackEnabled = input?.fallbackModelEnabled ?? false;
  const fallbackAdapterConfig = fallbackEnabled
    ? buildProfileAdapterConfig({
        model: input?.fallbackModel,
        adapterType: input?.fallbackModelAdapterType,
        command: input?.fallbackModelCommand,
        provider: input?.fallbackModelProvider,
        reasoningEffort: input?.fallbackModelReasoningEffort,
      })
    : null;
  if (fallbackAdapterConfig) {
    modelProfiles.fallback = {
      enabled: true,
      adapterConfig: fallbackAdapterConfig,
    };
  }

  if (Object.keys(modelProfiles).length > 0) {
    config.modelProfiles = modelProfiles;
  }

  return config;
}
