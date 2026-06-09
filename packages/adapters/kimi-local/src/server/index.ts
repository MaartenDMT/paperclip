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
  buildArgs({ prompt, model, extraArgs }) {
    // Kimi's non-interactive `--prompt` mode is mutually exclusive with every
    // permission flag (`--yolo`, `--auto`, `--plan`) — passing one fails with
    // "Cannot combine --prompt with --yolo." and aborts the run (adapter_failed).
    // Prompt mode already runs fully non-interactively and auto-approves tool
    // actions, so `dangerouslySkipPermissions` needs no flag here. To force a
    // different posture, set `default_permission_mode` in the user's kimi
    // config.toml rather than on the command line.
    const args = ["--output-format", "stream-json"];
    if (model && model !== DEFAULT_KIMI_LOCAL_MODEL) args.push("--model", model);
    args.push(...extraArgs);
    args.push("--prompt", prompt);
    return args;
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
