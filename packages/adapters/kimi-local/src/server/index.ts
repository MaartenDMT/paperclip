import {
  executeSimpleCliAdapter,
  hasSimpleCliTerminalResult,
  testSimpleCliEnvironment,
  type SimpleCliAdapterDefinition,
} from "@paperclipai/adapter-utils/simple-cli-server";
import {
  detectSimpleCliModel,
  type SimpleCliModelDetectionOptions,
} from "@paperclipai/adapter-utils/simple-cli-model-detection";
import type { AdapterExecutionContext, AdapterEnvironmentTestContext } from "@paperclipai/adapter-utils";
import { DEFAULT_KIMI_LOCAL_MODEL, label, SANDBOX_INSTALL_COMMAND, type } from "../index.js";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractKimiSessionId(stdout: string): string | null {
  let sessionId: string | null = null;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line) as unknown;
      if (typeof event !== "object" || event === null || Array.isArray(event)) continue;
      const rec = event as Record<string, unknown>;
      if (rec.type === "session.resume_hint") {
        sessionId = readNonEmptyString(rec.session_id) ?? readNonEmptyString(rec.sessionId) ?? sessionId;
      }
      sessionId = readNonEmptyString(rec.session_id) ?? readNonEmptyString(rec.sessionId) ?? sessionId;
    } catch {
      // Non-JSON stdout is valid for some CLI messages; ignore it for session detection.
    }
  }
  return sessionId;
}

export const sessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const sessionId = readNonEmptyString(record.sessionId) ?? readNonEmptyString(record.session_id);
    if (!sessionId) return null;
    const cwd =
      readNonEmptyString(record.cwd) ??
      readNonEmptyString(record.workdir) ??
      readNonEmptyString(record.folder);
    const workspaceId = readNonEmptyString(record.workspaceId) ?? readNonEmptyString(record.workspace_id);
    const repoUrl = readNonEmptyString(record.repoUrl) ?? readNonEmptyString(record.repo_url);
    const repoRef = readNonEmptyString(record.repoRef) ?? readNonEmptyString(record.repo_ref);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
    };
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params) return null;
    const sessionId = readNonEmptyString(params.sessionId) ?? readNonEmptyString(params.session_id);
    if (!sessionId) return null;
    const cwd =
      readNonEmptyString(params.cwd) ??
      readNonEmptyString(params.workdir) ??
      readNonEmptyString(params.folder);
    const workspaceId = readNonEmptyString(params.workspaceId) ?? readNonEmptyString(params.workspace_id);
    const repoUrl = readNonEmptyString(params.repoUrl) ?? readNonEmptyString(params.repo_url);
    const repoRef = readNonEmptyString(params.repoRef) ?? readNonEmptyString(params.repo_ref);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
    };
  },
  getDisplayId(params: Record<string, unknown> | null) {
    if (!params) return null;
    return readNonEmptyString(params.sessionId) ?? readNonEmptyString(params.session_id);
  },
};

export const kimiDefinition: SimpleCliAdapterDefinition = {
  type,
  label,
  defaultCommand: "kimi",
  defaultModel: DEFAULT_KIMI_LOCAL_MODEL,
  sandboxInstallCommand: SANDBOX_INSTALL_COMMAND,
  defaultTimeoutSec: 0,
  defaultGraceSec: 20,
  authEnvKeys: ["KIMI_API_KEY", "MOONSHOT_API_KEY"],
  biller: "kimi",
  terminalResultCleanup: {
    graceMs: 5_000,
    hasTerminalResult: hasSimpleCliTerminalResult,
  },
  buildArgs({ prompt, model, extraArgs, runtime }) {
    // Kimi's non-interactive `--prompt` mode is mutually exclusive with every
    // permission flag (`--yolo`, `--auto`, `--plan`) — passing one fails with
    // "Cannot combine --prompt with --yolo." and aborts the run (adapter_failed).
    // Prompt mode already runs fully non-interactively and auto-approves tool
    // actions, so `dangerouslySkipPermissions` needs no flag here. To force a
    // different posture, set `default_permission_mode` in the user's kimi
    // config.toml rather than on the command line.
    const args = ["--output-format", "stream-json"];
    const sessionId =
      readNonEmptyString(runtime.sessionParams?.sessionId) ??
      readNonEmptyString(runtime.sessionId);
    if (sessionId) args.push("--session", sessionId);
    if (model && model !== DEFAULT_KIMI_LOCAL_MODEL) args.push("--model", model);
    args.push(...extraArgs);
    args.push("--prompt", prompt);
    return args;
  },
  extractSessionParams({ stdout, runtime, cwd }) {
    const sessionId =
      extractKimiSessionId(stdout) ??
      readNonEmptyString(runtime.sessionParams?.sessionId) ??
      readNonEmptyString(runtime.sessionId);
    if (!sessionId) return null;
    return {
      sessionId,
      cwd,
    };
  },
};

export function execute(ctx: AdapterExecutionContext) {
  return executeSimpleCliAdapter(ctx, kimiDefinition);
}

export function testEnvironment(ctx: AdapterEnvironmentTestContext) {
  return testSimpleCliEnvironment(ctx, kimiDefinition);
}

export function detectModel(opts: SimpleCliModelDetectionOptions = {}) {
  return detectSimpleCliModel({
    provider: "kimi",
    defaultModel: DEFAULT_KIMI_LOCAL_MODEL,
    envKeys: ["KIMI_MODEL", "KIMI_MODEL_NAME", "MOONSHOT_MODEL"],
    configPaths: [
      "~/.kimi/config.json",
      "~/.kimi/config.toml",
      "{XDG_CONFIG_HOME}/kimi/config.json",
      "{XDG_CONFIG_HOME}/kimi/config.toml",
      "{APPDATA}/kimi/config.json",
      "{APPDATA}/kimi/config.toml",
    ],
    modelKeys: ["default_model", "model", "modelName", "model_name"],
  }, opts);
}
