import type { Agent } from "@paperclipai/shared";

export interface AgentModelProfileOverlay {
  enabled?: boolean;
  adapterConfig?: Record<string, unknown>;
  /**
   * Mark the profile for clearing. When true, the patch removes
   * `runtimeConfig.modelProfiles.<key>` instead of merging into it.
   */
  cleared?: boolean;
}

export interface AgentConfigOverlay {
  identity: Record<string, unknown>;
  adapterType?: string;
  adapterConfig: Record<string, unknown>;
  heartbeat: Record<string, unknown>;
  runtime: Record<string, unknown>;
  modelProfiles?: { cheap?: AgentModelProfileOverlay; fallback?: AgentModelProfileOverlay };
}

const ADAPTER_AGNOSTIC_KEYS = [
  "env",
  "promptTemplate",
  "instructionsFilePath",
  "cwd",
  "timeoutSec",
  "graceSec",
  "bootstrapPromptTemplate",
] as const;

function omitUndefinedEntries(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

export function buildAgentUpdatePatch(agent: Agent, overlay: AgentConfigOverlay) {
  const patch: Record<string, unknown> = {};

  if (Object.keys(overlay.identity).length > 0) {
    Object.assign(patch, overlay.identity);
  }

  if (overlay.adapterType !== undefined) {
    patch.adapterType = overlay.adapterType;
  }

  if (overlay.adapterType !== undefined || Object.keys(overlay.adapterConfig).length > 0) {
    const existing = (agent.adapterConfig ?? {}) as Record<string, unknown>;
    const nextAdapterConfig =
      overlay.adapterType !== undefined
        ? {
            ...Object.fromEntries(
              ADAPTER_AGNOSTIC_KEYS
                .filter((key) => existing[key] !== undefined)
                .map((key) => [key, existing[key]]),
            ),
            ...overlay.adapterConfig,
          }
        : {
            ...existing,
            ...overlay.adapterConfig,
          };

    patch.adapterConfig = omitUndefinedEntries(nextAdapterConfig);
    patch.replaceAdapterConfig = true;
  }

  const modelProfileOverlays = overlay.modelProfiles ?? {};
  const hasModelProfileChange = Object.values(modelProfileOverlays).some((value) => value !== undefined);

  if (Object.keys(overlay.heartbeat).length > 0 || hasModelProfileChange) {
    const existingRc = (agent.runtimeConfig ?? {}) as Record<string, unknown>;
    const nextRuntimeConfig: Record<string, unknown> = (patch.runtimeConfig as Record<string, unknown> | undefined)
      ?? { ...existingRc };

    if (Object.keys(overlay.heartbeat).length > 0) {
      const existingHb = (existingRc.heartbeat ?? {}) as Record<string, unknown>;
      nextRuntimeConfig.heartbeat = { ...existingHb, ...overlay.heartbeat };
    }

    if (hasModelProfileChange) {
      const existingProfiles = ((existingRc.modelProfiles ?? {}) as Record<string, unknown>);
      const nextProfiles = { ...existingProfiles };
      for (const [profileKey, profileOverlay] of Object.entries(modelProfileOverlays)) {
        if (!profileOverlay) continue;
        const existingProfile = ((existingProfiles[profileKey] ?? {}) as Record<string, unknown>);
        if (profileOverlay.cleared) {
          delete nextProfiles[profileKey];
          continue;
        }
        const mergedAdapterConfig = {
          ...((existingProfile.adapterConfig ?? {}) as Record<string, unknown>),
          ...(profileOverlay.adapterConfig ?? {}),
        };
        const enabled = profileOverlay.enabled ?? (existingProfile.enabled !== false);
        nextProfiles[profileKey] = {
          ...existingProfile,
          enabled,
          adapterConfig: mergedAdapterConfig,
        };
      }

      if (Object.keys(nextProfiles).length === 0) {
        delete nextRuntimeConfig.modelProfiles;
      } else {
        nextRuntimeConfig.modelProfiles = nextProfiles;
      }
    }

    patch.runtimeConfig = nextRuntimeConfig;
  }

  if (Object.keys(overlay.runtime).length > 0) {
    Object.assign(patch, overlay.runtime);
  }

  return patch;
}
