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
  const codexDefaults =
    configValues.adapterType === "codex_local"
      ? codexModelDefaultsForRole(effectiveRole)
      : null;
  const cheapModel =
    configValues.cheapModel
      ?? codexDefaults?.fallbackModel
      ?? "";
  const cheapModelEnabled =
    configValues.cheapModelEnabled
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
      cheapModelProvider: configValues.cheapModelProvider ?? codexDefaults?.fallbackProvider,
      cheapModelReasoningEffort:
        configValues.cheapModelReasoningEffort ?? codexDefaults?.fallbackReasoningEffort,
    }),
    budgetMonthlyCents: 0,
  };
}
