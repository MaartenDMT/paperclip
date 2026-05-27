import type { CreateConfigValues } from "../components/AgentConfigForm";
import { codexModelDefaultsForRole } from "./codex-agent-model-defaults";
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
  const codexDefaults = codexModelDefaultsForRole(effectiveRole);
  const explicitCheapModel =
    typeof configValues.cheapModel === "string" && configValues.cheapModel.trim().length > 0;
  const explicitFallbackModel =
    typeof configValues.fallbackModel === "string" && configValues.fallbackModel.trim().length > 0;
  const cheapModel = explicitCheapModel
    ? configValues.cheapModel
    : codexDefaults?.fallbackModel ?? "";
  const cheapModelEnabled =
    configValues.cheapModelEnabled
      ?? Boolean(codexDefaults);
  const fallbackModel = explicitFallbackModel
    ? configValues.fallbackModel
    : codexDefaults?.fallbackModel ?? "";
  const fallbackModelEnabled =
    configValues.fallbackModelEnabled
      ?? Boolean(codexDefaults);

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
        : configValues.cheapModelAdapterType ?? codexDefaults.fallbackAdapterType,
      cheapModelCommand: explicitCheapModel
        ? configValues.cheapModelCommand
        : configValues.cheapModelCommand ?? codexDefaults.fallbackCommand,
      cheapModelProvider: explicitCheapModel
        ? configValues.cheapModelProvider
        : configValues.cheapModelProvider ?? codexDefaults?.fallbackProvider,
      cheapModelReasoningEffort:
        explicitCheapModel
          ? configValues.cheapModelReasoningEffort
          : configValues.cheapModelReasoningEffort ?? codexDefaults?.fallbackReasoningEffort,
      fallbackModel,
      fallbackModelEnabled,
      fallbackModelAdapterType: explicitFallbackModel
        ? configValues.fallbackModelAdapterType
        : configValues.fallbackModelAdapterType ?? codexDefaults.fallbackAdapterType,
      fallbackModelCommand: explicitFallbackModel
        ? configValues.fallbackModelCommand
        : configValues.fallbackModelCommand ?? codexDefaults.fallbackCommand,
      fallbackModelProvider: explicitFallbackModel
        ? configValues.fallbackModelProvider
        : configValues.fallbackModelProvider ?? codexDefaults?.fallbackProvider,
      fallbackModelReasoningEffort:
        explicitFallbackModel
          ? configValues.fallbackModelReasoningEffort
          : configValues.fallbackModelReasoningEffort ?? codexDefaults?.fallbackReasoningEffort,
    }),
    budgetMonthlyCents: 0,
  };
}
