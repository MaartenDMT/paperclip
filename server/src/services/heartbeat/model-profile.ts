// Model-profile resolution helpers extracted from heartbeat.ts.
//
// Given an issue/wake-context model-profile request plus the agent's runtime
// config and the adapter's advertised profiles, these pure helpers decide which
// profile (if any) actually applies, what adapter config to merge, and how to
// record the decision in run metadata. They hold no heartbeat state.

import { MODEL_PROFILE_KEYS, type ModelProfileKey } from "@paperclipai/shared";
import type { AdapterModelProfileDefinition } from "../../adapters/index.js";
import { parseObject } from "../../adapters/utils.js";
import { readNonEmptyString } from "./shared.js";

type ModelProfileRequestSource = "issue_override" | "wake_context";
type AppliedModelProfileConfigSource = "agent_runtime" | "adapter_default";

export interface ModelProfileApplication {
  requested: ModelProfileKey | null;
  requestedBy: ModelProfileRequestSource | null;
  applied: ModelProfileKey | null;
  configSource: AppliedModelProfileConfigSource | null;
  fallbackReason: string | null;
  adapterType: string | null;
  adapterConfig: Record<string, unknown> | null;
}

function readModelProfileKey(value: unknown): ModelProfileKey | null {
  return MODEL_PROFILE_KEYS.includes(value as ModelProfileKey)
    ? (value as ModelProfileKey)
    : null;
}

function readContextModelProfile(
  contextSnapshot: Record<string, unknown> | null | undefined,
): ModelProfileKey | null {
  return readModelProfileKey(contextSnapshot?.modelProfile);
}

export function consumeWakeContextModelProfile(
  contextSnapshot: Record<string, unknown> | null | undefined,
  source: ModelProfileRequestSource | null,
) {
  if (!contextSnapshot || source !== "wake_context") return;
  delete contextSnapshot.modelProfile;
}

export function normalizeModelProfileWakeContext(input: {
  contextSnapshot: Record<string, unknown>;
  payload: Record<string, unknown> | null | undefined;
}): Record<string, unknown> {
  const modelProfileFromPayload = readModelProfileKey(input.payload?.modelProfile);
  if (!readContextModelProfile(input.contextSnapshot) && modelProfileFromPayload) {
    input.contextSnapshot.modelProfile = modelProfileFromPayload;
  }
  return input.contextSnapshot;
}

function readAgentRuntimeModelProfile(
  runtimeConfig: unknown,
  key: ModelProfileKey,
): { enabled: boolean; adapterConfig: Record<string, unknown>; configured: boolean } {
  const modelProfiles = parseObject(parseObject(runtimeConfig).modelProfiles);
  const profile = parseObject(modelProfiles[key]);
  if (Object.keys(profile).length === 0) {
    return { enabled: true, adapterConfig: {}, configured: false };
  }
  const adapterConfig = parseObject(profile.adapterConfig);

  return {
    enabled: profile.enabled !== false,
    adapterConfig,
    configured: Object.keys(adapterConfig).length > 0,
  };
}

export function resolveModelProfileApplication(input: {
  adapterModelProfiles: AdapterModelProfileDefinition[];
  agentRuntimeConfig: unknown;
  issueModelProfile: ModelProfileKey | null | undefined;
  contextSnapshot: Record<string, unknown> | null | undefined;
  profileResolutionFallbackReason?: string | null;
}): ModelProfileApplication {
  const issueModelProfile = input.issueModelProfile ?? null;
  const contextModelProfile = readContextModelProfile(input.contextSnapshot);
  const requested = issueModelProfile ?? contextModelProfile;
  const requestedBy: ModelProfileRequestSource | null = issueModelProfile
    ? "issue_override"
    : contextModelProfile
      ? "wake_context"
      : null;

  if (!requested) {
    return {
      requested: null,
      requestedBy: null,
      applied: null,
      configSource: null,
      fallbackReason: null,
      adapterType: null,
      adapterConfig: null,
    };
  }

  const adapterProfile = input.adapterModelProfiles.find((profile) => profile.key === requested) ?? null;
  const runtimeProfile = readAgentRuntimeModelProfile(input.agentRuntimeConfig, requested);
  const runtimeAdapterType = readNonEmptyString(runtimeProfile.adapterConfig.adapterType);
  if (!adapterProfile && !runtimeAdapterType) {
    return {
      requested,
      requestedBy,
      applied: null,
      configSource: null,
      fallbackReason: input.profileResolutionFallbackReason ?? "adapter_profile_not_supported",
      adapterType: null,
      adapterConfig: null,
    };
  }

  if (!runtimeProfile.enabled) {
    return {
      requested,
      requestedBy,
      applied: null,
      configSource: null,
      fallbackReason: "agent_runtime_profile_disabled",
      adapterType: null,
      adapterConfig: null,
    };
  }

  const adapterConfig = {
    ...parseObject(adapterProfile?.adapterConfig),
    ...runtimeProfile.adapterConfig,
  };
  const profileAdapterType = readNonEmptyString(adapterConfig.adapterType);

  return {
    requested,
    requestedBy,
    applied: requested,
    configSource: runtimeProfile.configured || runtimeAdapterType ? "agent_runtime" : "adapter_default",
    fallbackReason: null,
    adapterType: profileAdapterType,
    adapterConfig,
  };
}

export function mergeModelProfileAdapterConfig(input: {
  baseConfig: Record<string, unknown>;
  modelProfile: ModelProfileApplication;
  issueAdapterConfig: Record<string, unknown> | null | undefined;
}): Record<string, unknown> {
  return {
    ...input.baseConfig,
    ...(input.modelProfile.adapterConfig ?? {}),
    ...(input.issueAdapterConfig ?? {}),
  };
}

export function modelProfileRunMetadata(
  modelProfile: ModelProfileApplication,
): Record<string, unknown> | null {
  if (!modelProfile.requested) return null;
  return {
    requested: modelProfile.requested,
    requestedBy: modelProfile.requestedBy,
    applied: modelProfile.applied,
    configSource: modelProfile.configSource,
    fallbackReason: modelProfile.fallbackReason,
    adapterType: modelProfile.adapterType,
  };
}

export function mergeModelProfileRunMetadata(
  resultJson: Record<string, unknown> | null,
  modelProfile: ModelProfileApplication,
): Record<string, unknown> | null {
  const metadata = modelProfileRunMetadata(modelProfile);
  if (!metadata) return resultJson;
  return {
    ...(resultJson ?? {}),
    modelProfile: metadata,
  };
}

interface ParsedIssueAssigneeAdapterOverrides {
  modelProfile: ModelProfileKey | null;
  adapterConfig: Record<string, unknown> | null;
  useProjectWorkspace: boolean | null;
}

export function parseIssueAssigneeAdapterOverrides(
  raw: unknown,
): ParsedIssueAssigneeAdapterOverrides | null {
  const parsed = parseObject(raw);
  const modelProfile = MODEL_PROFILE_KEYS.includes(parsed.modelProfile as ModelProfileKey)
    ? parsed.modelProfile as ModelProfileKey
    : null;
  const parsedAdapterConfig = parseObject(parsed.adapterConfig);
  // Prevent stale issue-level adapter/model pins from overriding current agent config.
  delete parsedAdapterConfig.model;
  delete parsedAdapterConfig.adapterType;
  const adapterConfig =
    Object.keys(parsedAdapterConfig).length > 0 ? parsedAdapterConfig : null;
  const useProjectWorkspace =
    typeof parsed.useProjectWorkspace === "boolean"
      ? parsed.useProjectWorkspace
      : null;
  if (!modelProfile && !adapterConfig && useProjectWorkspace === null) return null;
  return {
    modelProfile,
    adapterConfig,
    useProjectWorkspace,
  };
}
