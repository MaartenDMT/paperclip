import {
  executeSimpleCliAdapter,
  testSimpleCliEnvironment,
  type SimpleCliAdapterDefinition,
} from "@paperclipai/adapter-utils/simple-cli-server";
import { detectSimpleCliModel } from "@paperclipai/adapter-utils/simple-cli-model-detection";
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
  buildArgs({ prompt, model, extraArgs, config }) {
    const args = ["--print", "--output-format", "stream-json"];
    if (model && model !== DEFAULT_KIMI_LOCAL_MODEL) args.push("--model", model);
    if (config.dangerouslySkipPermissions === true) args.push("--yolo");
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

export function detectModel() {
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
  });
}
