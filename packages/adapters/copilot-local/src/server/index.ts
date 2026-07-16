import {
  executeSimpleCliAdapter,
  testSimpleCliEnvironment,
  type SimpleCliAdapterDefinition,
} from "@paperclipai/adapter-utils/simple-cli-server";
import { detectSimpleCliModel } from "@paperclipai/adapter-utils/simple-cli-model-detection";
import type { AdapterExecutionContext, AdapterEnvironmentTestContext } from "@paperclipai/adapter-utils";
import { DEFAULT_COPILOT_SDK_MODEL, label, type } from "../index.js";

export const copilotLocalDefinition: SimpleCliAdapterDefinition = {
  type,
  label,
  defaultCommand: "copilot",
  defaultModel: DEFAULT_COPILOT_SDK_MODEL,
  defaultTimeoutSec: 0,
  defaultGraceSec: 20,
  authEnvKeys: ["GITHUB_TOKEN", "GH_TOKEN", "COPILOT_TOKEN"],
  biller: "github_copilot",
  buildArgs({ prompt, model, extraArgs, config }) {
    const args: string[] = [];
    args.push("--output-format", "json");
    if (model && model !== DEFAULT_COPILOT_SDK_MODEL) args.push("--model", model);
    if (config.dangerouslySkipPermissions === true) args.push("--allow-all-tools");
    args.push(...extraArgs);
    args.push("--prompt", prompt);
    return args;
  },
};

export async function execute(ctx: AdapterExecutionContext) {
  return executeSimpleCliAdapter(ctx, copilotLocalDefinition);
}

export function testEnvironment(ctx: AdapterEnvironmentTestContext) {
  return testSimpleCliEnvironment(ctx, copilotLocalDefinition);
}

export function detectModel() {
  return detectSimpleCliModel({
    provider: process.env.COPILOT_PROVIDER_TYPE?.trim() || "github_copilot",
    defaultModel: DEFAULT_COPILOT_SDK_MODEL,
    envKeys: ["COPILOT_MODEL", "GITHUB_COPILOT_MODEL"],
    configPaths: [
      "~/.copilot/config.json",
      "~/.copilot/settings.json",
      "{XDG_CONFIG_HOME}/copilot/config.json",
      "{XDG_CONFIG_HOME}/copilot/settings.json",
      "{APPDATA}/copilot/config.json",
      "{APPDATA}/copilot/settings.json",
      "{APPDATA}/GitHub Copilot/config.json",
      "{APPDATA}/GitHub Copilot/settings.json",
    ],
    modelKeys: ["model", "modelName", "model_name", "COPILOT_MODEL", "copilotModel"],
  });
}
