import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { asBoolean } from "@paperclipai/adapter-utils/server-utils";

type PreparedOpenCodeRuntimeConfig = {
  env: Record<string, string>;
  notes: string[];
  cleanup: () => Promise<void>;
};

const OPENCODE_PACKAGE_MANAGED_CONFIG_FILES = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const;

function resolveXdgConfigHome(env: Record<string, string>): string {
  return (
    (typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()) ||
    (typeof process.env.XDG_CONFIG_HOME === "string" && process.env.XDG_CONFIG_HOME.trim()) ||
    path.join(os.homedir(), ".config")
  );
}

function resolveXdgDataHome(env: Record<string, string>): string {
  return (
    (typeof env.XDG_DATA_HOME === "string" && env.XDG_DATA_HOME.trim()) ||
    (typeof process.env.XDG_DATA_HOME === "string" && process.env.XDG_DATA_HOME.trim()) ||
    path.join(os.homedir(), ".local", "share")
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(filepath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filepath, "utf8");
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function copyConfigFileIfPresent(sourceConfigDir: string, runtimeConfigDir: string, filename: string) {
  try {
    const sourcePath = path.join(sourceConfigDir, filename);
    const stat = await fs.stat(sourcePath);
    if (!stat.isFile()) return;
    await fs.copyFile(sourcePath, path.join(runtimeConfigDir, filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

async function linkNodeModulesIfPresent(sourceConfigDir: string, runtimeConfigDir: string) {
  const sourceNodeModules = path.join(sourceConfigDir, "node_modules");
  const runtimeNodeModules = path.join(runtimeConfigDir, "node_modules");
  try {
    const stat = await fs.stat(sourceNodeModules);
    if (!stat.isDirectory()) return;
    await fs.symlink(sourceNodeModules, runtimeNodeModules, process.platform === "win32" ? "junction" : "dir");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    // Dependency linking is an optimization. If symlinks are unavailable,
    // OpenCode can still initialize the temp config directory itself.
  }
}

async function linkPackageManagedConfigDependencies(sourceConfigDir: string, runtimeConfigDir: string) {
  await Promise.all(
    OPENCODE_PACKAGE_MANAGED_CONFIG_FILES.map((filename) =>
      copyConfigFileIfPresent(sourceConfigDir, runtimeConfigDir, filename),
    ),
  );
  await linkNodeModulesIfPresent(sourceConfigDir, runtimeConfigDir);
}

async function copyAuthFileIfPresent(sourceDataDir: string, runtimeDataDir: string) {
  try {
    const sourcePath = path.join(sourceDataDir, "auth.json");
    const stat = await fs.stat(sourcePath);
    if (!stat.isFile()) return;
    await fs.copyFile(sourcePath, path.join(runtimeDataDir, "auth.json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

function resolveRuntimeDataHome(env: Record<string, string>) {
  const agentHome =
    (typeof env.AGENT_HOME === "string" && env.AGENT_HOME.trim()) ||
    (typeof env.PAPERCLIP_AGENT_ID === "string" && env.PAPERCLIP_AGENT_ID.trim()
      ? path.join(os.tmpdir(), "paperclip-opencode-agents", env.PAPERCLIP_AGENT_ID.trim())
      : "");
  if (agentHome) return path.join(agentHome, ".opencode-data");
  return "";
}

export async function prepareOpenCodeRuntimeConfig(input: {
  env: Record<string, string>;
  config: Record<string, unknown>;
  targetIsRemote?: boolean;
}): Promise<PreparedOpenCodeRuntimeConfig> {
  const skipPermissions = asBoolean(input.config.dangerouslySkipPermissions, true);
  if (!skipPermissions) {
    return {
      env: input.env,
      notes: [],
      cleanup: async () => {},
    };
  }

  // For remote execution targets the host XDG_CONFIG_HOME path is meaningless
  // (and actively harmful — it leaks a macOS-only path into the remote Linux
  // env). Callers that need to ship a runtime opencode config to the remote
  // box do that via prepareAdapterExecutionTargetRuntime in execute.ts; this
  // host-fs helper is local-only.
  if (input.targetIsRemote) {
    return {
      env: input.env,
      notes: [],
      cleanup: async () => {},
    };
  }

  const sourceConfigDir = path.join(resolveXdgConfigHome(input.env), "opencode");
  const sourceDataDir = path.join(resolveXdgDataHome(input.env), "opencode");
  const runtimeConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-config-"));
  const runtimeConfigDir = path.join(runtimeConfigHome, "opencode");
  const runtimeConfigPath = path.join(runtimeConfigDir, "opencode.json");
  const runtimeDataHome = resolveRuntimeDataHome(input.env) || await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-data-"));
  const runtimeDataDir = path.join(runtimeDataHome, "opencode");
  const cleanupRuntimeDataHome = !resolveRuntimeDataHome(input.env);

  try {
    await fs.mkdir(runtimeConfigDir, { recursive: true });
    await fs.mkdir(runtimeDataDir, { recursive: true });
    const existingConfig = await readJsonObject(path.join(sourceConfigDir, "opencode.json"));
    const existingPermission = isPlainObject(existingConfig.permission)
      ? existingConfig.permission
      : {};
    const nextConfig = {
      ...existingConfig,
      permission: {
        ...existingPermission,
        external_directory: "allow",
      },
    };
    await fs.writeFile(runtimeConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
    await linkPackageManagedConfigDependencies(sourceConfigDir, runtimeConfigDir);
    try {
      await fs.access(path.join(runtimeDataDir, "auth.json"));
    } catch {
      await copyAuthFileIfPresent(sourceDataDir, runtimeDataDir);
    }
  } catch (err) {
    await Promise.all([
      fs.rm(runtimeConfigHome, { recursive: true, force: true }).catch(() => undefined),
      cleanupRuntimeDataHome
        ? fs.rm(runtimeDataHome, { recursive: true, force: true }).catch(() => undefined)
        : Promise.resolve(),
    ]);
    throw err;
  }

  return {
    env: {
      ...input.env,
      XDG_CONFIG_HOME: runtimeConfigHome,
      XDG_DATA_HOME: runtimeDataHome,
    },
    notes: [
      "Injected isolated OpenCode config/data homes with permission.external_directory=allow to avoid headless approval prompts and shared opencode.db contention while copying provider auth state.",
    ],
    cleanup: async () => {
      await Promise.all([
        fs.rm(runtimeConfigHome, { recursive: true, force: true }),
        cleanupRuntimeDataHome
          ? fs.rm(runtimeDataHome, { recursive: true, force: true })
          : Promise.resolve(),
      ]);
    },
  };
}
