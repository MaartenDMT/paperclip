import type { ModelProfileKey } from "@paperclipai/shared";

export function withRecoveryModelProfileHint<T extends Record<string, unknown>>(
  input: T,
  modelProfile: ModelProfileKey = "cheap",
): T & { modelProfile: ModelProfileKey } {
  return {
    ...input,
    modelProfile,
  };
}

export function recoveryAssigneeAdapterOverrides(modelProfile: ModelProfileKey = "cheap") {
  return { modelProfile };
}
