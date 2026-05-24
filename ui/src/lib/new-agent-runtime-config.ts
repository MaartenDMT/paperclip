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

  const cheapModel = input?.cheapModel?.trim() ?? "";
  const cheapEnabled = input?.cheapModelEnabled ?? false;
  if (cheapModel && cheapEnabled) {
    const adapterConfig: Record<string, unknown> = { model: cheapModel };
    const adapterType = input?.cheapModelAdapterType?.trim() ?? "";
    if (adapterType) adapterConfig.adapterType = adapterType;
    const command = input?.cheapModelCommand?.trim() ?? "";
    if (command) adapterConfig.command = command;
    const provider = input?.cheapModelProvider?.trim() ?? "";
    if (provider) adapterConfig.provider = provider;
    const reasoningEffort = input?.cheapModelReasoningEffort?.trim() ?? "";
    if (reasoningEffort) adapterConfig.modelReasoningEffort = reasoningEffort;
    config.modelProfiles = {
      cheap: {
        enabled: true,
        adapterConfig,
      },
    };
  }

  return config;
}
