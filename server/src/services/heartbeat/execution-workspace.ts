// Execution-workspace config helpers extracted from heartbeat.ts.
//
// These translate between persisted workspace config/metadata and the realized
// workspace a run executes in: applying persisted overrides onto a run config,
// snapshotting config for persistence, deriving a realized workspace from a
// stored one, and ensuring a managed project checkout exists on disk. Only
// ensureManagedProjectWorkspace touches the filesystem/git; the rest are pure.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutionWorkspace, ExecutionWorkspaceConfig } from "@paperclipai/shared";
import { parseObject } from "../../adapters/utils.js";
import { resolveManagedProjectWorkspaceDir } from "../../home-paths.js";
import { mergeExecutionWorkspaceConfig } from "../execution-workspaces.js";
import { resolveExecutionWorkspaceMode } from "../execution-workspace-policy.js";
import {
  sanitizeRuntimeServiceBaseEnv,
  type ExecutionWorkspaceInput,
  type RealizedExecutionWorkspace,
} from "../workspace-runtime.js";
import { readNonEmptyString } from "./shared.js";

const execFile = promisify(execFileCallback);
const MANAGED_WORKSPACE_GIT_CLONE_TIMEOUT_MS = 10 * 60 * 1000;

export function applyPersistedExecutionWorkspaceConfig(input: {
  config: Record<string, unknown>;
  workspaceConfig: ExecutionWorkspaceConfig | null;
  mode: ReturnType<typeof resolveExecutionWorkspaceMode>;
}) {
  const nextConfig = { ...input.config };

  if (input.mode !== "agent_default") {
    if (input.workspaceConfig?.workspaceRuntime === null) {
      delete nextConfig.workspaceRuntime;
    } else if (input.workspaceConfig?.workspaceRuntime) {
      nextConfig.workspaceRuntime = { ...input.workspaceConfig.workspaceRuntime };
    }
    if (input.workspaceConfig?.desiredState === null) {
      delete nextConfig.desiredState;
    } else if (input.workspaceConfig?.desiredState) {
      nextConfig.desiredState = input.workspaceConfig.desiredState;
    }
    if (input.workspaceConfig?.serviceStates === null) {
      delete nextConfig.serviceStates;
    } else if (input.workspaceConfig?.serviceStates) {
      nextConfig.serviceStates = { ...input.workspaceConfig.serviceStates };
    }
  }

  if (input.workspaceConfig && input.mode === "isolated_workspace") {
    const nextStrategy = parseObject(nextConfig.workspaceStrategy);
    if (input.workspaceConfig.provisionCommand === null) delete nextStrategy.provisionCommand;
    else nextStrategy.provisionCommand = input.workspaceConfig.provisionCommand;
    if (input.workspaceConfig.teardownCommand === null) delete nextStrategy.teardownCommand;
    else nextStrategy.teardownCommand = input.workspaceConfig.teardownCommand;
    nextConfig.workspaceStrategy = nextStrategy;
  }

  return nextConfig;
}

export function mergeExecutionWorkspaceMetadataForPersistence(input: {
  existingMetadata: Record<string, unknown> | null | undefined;
  source: string;
  createdByRuntime: boolean;
  configSnapshot: Record<string, unknown> | null;
  shouldReuseExisting: boolean;
}) {
  const base = {
    ...(input.existingMetadata ?? {}),
    source: input.source,
    createdByRuntime: input.createdByRuntime,
  } as Record<string, unknown>;

  if (input.shouldReuseExisting || !input.configSnapshot) {
    return base;
  }

  return mergeExecutionWorkspaceConfig(base, input.configSnapshot);
}

export function stripWorkspaceRuntimeFromExecutionRunConfig(config: Record<string, unknown>) {
  const nextConfig = { ...config };
  delete nextConfig.workspaceRuntime;
  return nextConfig;
}

export function buildRealizedExecutionWorkspaceFromPersisted(input: {
  base: ExecutionWorkspaceInput;
  workspace: ExecutionWorkspace;
}): RealizedExecutionWorkspace | null {
  const cwd = readNonEmptyString(input.workspace.cwd) ?? readNonEmptyString(input.workspace.providerRef);
  if (!cwd) {
    return null;
  }

  const strategy = input.workspace.strategyType === "git_worktree" ? "git_worktree" : "project_primary";
  return {
    baseCwd: input.base.baseCwd,
    source: input.workspace.mode === "shared_workspace" ? "project_primary" : "task_session",
    projectId: input.workspace.projectId ?? input.base.projectId,
    workspaceId: input.workspace.projectWorkspaceId ?? input.base.workspaceId,
    repoUrl: input.workspace.repoUrl ?? input.base.repoUrl,
    repoRef: input.workspace.baseRef ?? input.base.repoRef,
    strategy,
    cwd,
    branchName: input.workspace.branchName ?? null,
    worktreePath: strategy === "git_worktree" ? (readNonEmptyString(input.workspace.providerRef) ?? cwd) : null,
    warnings: [],
    created: false,
  };
}

export function buildExecutionWorkspaceConfigSnapshot(
  config: Record<string, unknown>,
  environmentId?: string | null,
): Partial<ExecutionWorkspaceConfig> | null {
  const strategy = parseObject(config.workspaceStrategy);
  const snapshot: Partial<ExecutionWorkspaceConfig> = {};
  // Persist the resolved environment onto the workspace so reused sessions stay on the
  // environment they were created against until the workspace itself is recreated/reset.
  const hasExplicitEnvironmentSelection = environmentId !== undefined;

  if (hasExplicitEnvironmentSelection) {
    snapshot.environmentId = environmentId ?? null;
  }

  if ("workspaceStrategy" in config) {
    snapshot.provisionCommand = typeof strategy.provisionCommand === "string" ? strategy.provisionCommand : null;
    snapshot.teardownCommand = typeof strategy.teardownCommand === "string" ? strategy.teardownCommand : null;
  }

  if ("workspaceRuntime" in config) {
    const workspaceRuntime = parseObject(config.workspaceRuntime);
    snapshot.workspaceRuntime = Object.keys(workspaceRuntime).length > 0 ? workspaceRuntime : null;
  }
  if ("desiredState" in config) {
    snapshot.desiredState =
      config.desiredState === "running" || config.desiredState === "stopped" || config.desiredState === "manual"
        ? config.desiredState
        : null;
  }
  if ("serviceStates" in config) {
    const serviceStates = parseObject(config.serviceStates);
    snapshot.serviceStates = Object.keys(serviceStates).length > 0
      ? Object.fromEntries(
          Object.entries(serviceStates).filter(([, state]) =>
            state === "running" || state === "stopped" || state === "manual"
          ),
        ) as ExecutionWorkspaceConfig["serviceStates"]
      : null;
  }

  const hasSnapshot = Object.values(snapshot).some((value) => {
    if (value === null) return false;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  }) || hasExplicitEnvironmentSelection;
  return hasSnapshot ? snapshot : null;
}

function deriveRepoNameFromRepoUrl(repoUrl: string | null): string | null {
  const trimmed = repoUrl?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const cleanedPath = parsed.pathname.replace(/\/+$/, "");
    const repoName = cleanedPath.split("/").filter(Boolean).pop()?.replace(/\.git$/i, "") ?? "";
    return repoName || null;
  } catch {
    return null;
  }
}

export async function ensureManagedProjectWorkspace(input: {
  companyId: string;
  projectId: string;
  repoUrl: string | null;
}): Promise<{ cwd: string; warning: string | null }> {
  const cwd = resolveManagedProjectWorkspaceDir({
    companyId: input.companyId,
    projectId: input.projectId,
    repoName: deriveRepoNameFromRepoUrl(input.repoUrl),
  });
  await fs.mkdir(path.dirname(cwd), { recursive: true });
  const stats = await fs.stat(cwd).catch(() => null);

  if (!input.repoUrl) {
    if (!stats) {
      await fs.mkdir(cwd, { recursive: true });
    }
    return { cwd, warning: null };
  }

  const gitDirExists = await fs
    .stat(path.resolve(cwd, ".git"))
    .then((entry) => entry.isDirectory())
    .catch(() => false);
  if (gitDirExists) {
    return { cwd, warning: null };
  }

  if (stats) {
    const entries = await fs.readdir(cwd).catch(() => []);
    if (entries.length > 0) {
      return {
        cwd,
        warning: `Managed workspace path "${cwd}" already exists but is not a git checkout. Using it as-is.`,
      };
    }
    await fs.rm(cwd, { recursive: true, force: true });
  }

  try {
    await execFile("git", ["clone", input.repoUrl, cwd], {
      env: sanitizeRuntimeServiceBaseEnv(process.env),
      timeout: MANAGED_WORKSPACE_GIT_CLONE_TIMEOUT_MS,
    });
    return { cwd, warning: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to prepare managed checkout for "${input.repoUrl}" at "${cwd}": ${reason}`);
  }
}
