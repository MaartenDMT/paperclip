// Execution-run adapter-config resolution extracted from heartbeat.ts.
//
// Resolves the adapter config for a run by materializing secret references and
// merging project-level env bindings, returning the resolved config plus the set
// of secret keys and a manifest for auditing. Side-effects only through the
// passed-in secrets service.

import type { secretService } from "../secrets.js";
import { parseObject } from "../../adapters/utils.js";

type RuntimeConfigSecretResolver = Pick<
  ReturnType<typeof secretService>,
  "resolveAdapterConfigForRuntime" | "resolveEnvBindings"
>;

export async function resolveExecutionRunAdapterConfig(input: {
  companyId: string;
  agentId?: string | null;
  issueId?: string | null;
  heartbeatRunId?: string | null;
  projectId?: string | null;
  executionRunConfig: Record<string, unknown>;
  projectEnv: unknown;
  secretsSvc: RuntimeConfigSecretResolver;
}) {
  const { config: resolvedConfig, secretKeys, manifest } = await input.secretsSvc.resolveAdapterConfigForRuntime(
    input.companyId,
    input.executionRunConfig,
    input.agentId
      ? {
          consumerType: "agent",
          consumerId: input.agentId,
          actorType: "agent",
          actorId: input.agentId,
          issueId: input.issueId ?? null,
          heartbeatRunId: input.heartbeatRunId ?? null,
        }
      : undefined,
  );
  const projectEnvResolution = input.projectEnv
    ? await input.secretsSvc.resolveEnvBindings(
        input.companyId,
        input.projectEnv,
        input.projectId
          ? {
              consumerType: "project",
              consumerId: input.projectId,
              actorType: "agent",
              actorId: input.agentId ?? null,
              issueId: input.issueId ?? null,
              heartbeatRunId: input.heartbeatRunId ?? null,
            }
          : undefined,
      )
    : { env: {}, secretKeys: new Set<string>(), manifest: [] };
  if (Object.keys(projectEnvResolution.env).length > 0) {
    resolvedConfig.env = {
      ...parseObject(resolvedConfig.env),
      ...projectEnvResolution.env,
    };
    for (const key of projectEnvResolution.secretKeys) {
      secretKeys.add(key);
    }
  }
  return {
    resolvedConfig,
    secretKeys,
    secretManifest: [...(manifest ?? []), ...(projectEnvResolution.manifest ?? [])],
  };
}
