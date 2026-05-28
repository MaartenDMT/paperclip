import {
  execute as executeOpenCode,
  testEnvironment as testOpenCodeEnvironment,
} from "@paperclipai/adapter-opencode-local/server";
import { detectSimpleCliModel } from "@paperclipai/adapter-utils/simple-cli-model-detection";
import type { AdapterExecutionContext, AdapterEnvironmentTestContext } from "@paperclipai/adapter-utils";
import { DEFAULT_ZAI_LOCAL_CHEAP_MODEL, DEFAULT_ZAI_LOCAL_MODEL, type } from "../index.js";

const ALLOWED_ZAI_MODELS = new Set([
  "zai-coding-plan/glm-4.7",
  DEFAULT_ZAI_LOCAL_CHEAP_MODEL,
  "zai-coding-plan/glm-5-turbo",
  "zai-coding-plan/glm-5.1",
  "zai-coding-plan/glm-5v-turbo",
]);
const LEGACY_ZAI_MODEL_MAP: Record<string, string> = {
  "glm-4.7": "zai-coding-plan/glm-4.7",
  "glm-4.5-air": DEFAULT_ZAI_LOCAL_CHEAP_MODEL,
  "glm-4.5air": DEFAULT_ZAI_LOCAL_CHEAP_MODEL,
  "glm-5-turbo": "zai-coding-plan/glm-5-turbo",
  "glm-5.1": "zai-coding-plan/glm-5.1",
  "glm-5v-turbo": "zai-coding-plan/glm-5v-turbo",
  "4.7": "zai-coding-plan/glm-4.7",
  "4.5-air": DEFAULT_ZAI_LOCAL_CHEAP_MODEL,
  "4.5air": DEFAULT_ZAI_LOCAL_CHEAP_MODEL,
  "5-turbo": "zai-coding-plan/glm-5-turbo",
  "5.1": "zai-coding-plan/glm-5.1",
  "5v-turbo": "zai-coding-plan/glm-5v-turbo",
};

export function normalizeZaiModelId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return DEFAULT_ZAI_LOCAL_MODEL;
  }
  const trimmed = value.trim();
  if (trimmed === "auto") return DEFAULT_ZAI_LOCAL_MODEL;
  const normalized = LEGACY_ZAI_MODEL_MAP[trimmed.toLowerCase()] ?? trimmed;
  if (!ALLOWED_ZAI_MODELS.has(normalized)) {
    throw new Error(
      "Z.AI agents only support OpenCode Z.AI coding-plan models: zai-coding-plan/glm-4.5-air, zai-coding-plan/glm-4.7, zai-coding-plan/glm-5-turbo, zai-coding-plan/glm-5.1, or zai-coding-plan/glm-5v-turbo.",
    );
  }
  return normalized;
}

export function normalizeZaiOpenCodeConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const command =
    typeof config.command === "string" && config.command.trim().length > 0
      ? config.command.trim()
      : "opencode";
  return {
    ...config,
    command,
    model: normalizeZaiModelId(config.model),
    dangerouslySkipPermissions: config.dangerouslySkipPermissions === false
      ? true
      : config.dangerouslySkipPermissions ?? true,
  };
}

export function execute(ctx: AdapterExecutionContext) {
  return executeOpenCode({
    ...ctx,
    config: normalizeZaiOpenCodeConfig(ctx.config),
  });
}

export async function testEnvironment(ctx: AdapterEnvironmentTestContext) {
  const result = await testOpenCodeEnvironment({
    ...ctx,
    adapterType: "opencode_local",
    config: normalizeZaiOpenCodeConfig(
      ctx.config && typeof ctx.config === "object" && !Array.isArray(ctx.config)
        ? ctx.config as Record<string, unknown>
        : {},
    ),
  });
  return {
    ...result,
    adapterType: type,
  };
}

export function detectModel() {
  return detectSimpleCliModel({
    provider: "zai",
    defaultModel: DEFAULT_ZAI_LOCAL_MODEL,
    envKeys: ["ZAI_MODEL", "Z_AI_MODEL", "GLM_MODEL"],
    configPaths: [
      "~/.zai/config.json",
      "~/.zai/config.toml",
      "~/.z.ai/config.json",
      "~/.z.ai/config.toml",
      "{XDG_CONFIG_HOME}/zai/config.json",
      "{XDG_CONFIG_HOME}/zai/config.toml",
      "{APPDATA}/zai/config.json",
      "{APPDATA}/zai/config.toml",
    ],
    modelKeys: ["model", "modelId", "model_id", "defaultModel", "default_model"],
  });
}
