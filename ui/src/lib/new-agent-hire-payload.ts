import type { CreateConfigValues } from "../components/AgentConfigForm";
import { agentModelProfileDefaultsForRole } from "./agent-model-profile-defaults";
import { buildNewAgentRuntimeConfig } from "./new-agent-runtime-config";

export function buildNewAgentHirePayload(input: {
  name: string;
  effectiveRole: string;
  title?: string;
  reportsTo?: string | null;
  selectedSkillKeys?: string[];
  configValues: CreateConfigValues;
  adapterConfig: Record<string, unknown>;
}) {
  const {
    name,
    effectiveRole,
    title,
    reportsTo,
    selectedSkillKeys = [],
    configValues,
    adapterConfig,
  } = input;
  const profileDefaults = agentModelProfileDefaultsForRole(effectiveRole);
  const explicitCheapModel =
    typeof configValues.cheapModel === "string" && configValues.cheapModel.trim().length > 0;
  const explicitFallbackModel =
    typeof configValues.fallbackModel === "string" && configValues.fallbackModel.trim().length > 0;
  const cheapModel = explicitCheapModel
    ? configValues.cheapModel
    : profileDefaults.cheap.model;
  const cheapModelEnabled =
    configValues.cheapModelEnabled
      ?? true;
  const fallbackModel = explicitFallbackModel
    ? configValues.fallbackModel
    : profileDefaults.fallback.model;
  const fallbackModelEnabled =
    configValues.fallbackModelEnabled
      ?? true;

  return {
    name: name.trim(),
    role: effectiveRole,
    ...(title?.trim() ? { title: title.trim() } : {}),
    ...(reportsTo ? { reportsTo } : {}),
    desiredSkills: selectedSkillKeys,
    adapterType: configValues.adapterType,
    defaultEnvironmentId: configValues.defaultEnvironmentId ?? null,
    adapterConfig,
    runtimeConfig: buildNewAgentRuntimeConfig({
      heartbeatEnabled: configValues.heartbeatEnabled,
      intervalSec: configValues.intervalSec,
      cheapModel,
      cheapModelEnabled,
      cheapModelAdapterType: explicitCheapModel
        ? configValues.cheapModelAdapterType
        : configValues.cheapModelAdapterType ?? profileDefaults.cheap.adapterType,
      cheapModelCommand: explicitCheapModel
        ? configValues.cheapModelCommand
        : configValues.cheapModelCommand ?? profileDefaults.cheap.command,
      cheapModelProvider: explicitCheapModel
        ? configValues.cheapModelProvider
        : configValues.cheapModelProvider ?? profileDefaults.cheap.provider,
      cheapModelReasoningEffort:
        explicitCheapModel
          ? configValues.cheapModelReasoningEffort
          : configValues.cheapModelReasoningEffort ?? profileDefaults.cheap.reasoningEffort,
      fallbackModel,
      fallbackModelEnabled,
      fallbackModelAdapterType: explicitFallbackModel
        ? configValues.fallbackModelAdapterType
        : configValues.fallbackModelAdapterType ?? profileDefaults.fallback.adapterType,
      fallbackModelCommand: explicitFallbackModel
        ? configValues.fallbackModelCommand
        : configValues.fallbackModelCommand ?? profileDefaults.fallback.command,
      fallbackModelProvider: explicitFallbackModel
        ? configValues.fallbackModelProvider
        : configValues.fallbackModelProvider ?? profileDefaults.fallback.provider,
      fallbackModelReasoningEffort:
        explicitFallbackModel
          ? configValues.fallbackModelReasoningEffort
          : configValues.fallbackModelReasoningEffort ?? profileDefaults.fallback.reasoningEffort,
    }),
    budgetMonthlyCents: 0,
  };
}
