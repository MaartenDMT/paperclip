import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface SimpleCliModelDetectionDefinition {
  provider: string;
  envKeys: string[];
  configPaths: string[];
  modelKeys?: string[];
  defaultModel?: string;
}

export interface SimpleCliModelDetectionOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  readFile?: (filePath: string) => Promise<string>;
}

export interface SimpleCliDetectedModel {
  model: string;
  provider: string;
  source: string;
  candidates?: string[];
}

const DEFAULT_MODEL_KEYS = [
  "model",
  "modelName",
  "model_name",
  "defaultModel",
  "default_model",
  "currentModel",
  "current_model",
  "selectedModel",
  "selected_model",
] as const;

function normalizeModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  if (!model || /^(auto|default)$/i.test(model)) return null;
  return model;
}

function pushCandidate(candidates: string[], value: unknown) {
  const model = normalizeModel(value);
  if (model && !candidates.includes(model)) candidates.push(model);
}

function collectJsonCandidates(value: unknown, keys: Set<string>, candidates: string[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) collectJsonCandidates(entry, keys, candidates);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (keys.has(key)) pushCandidate(candidates, entry);
    collectJsonCandidates(entry, keys, candidates);
  }
}

function collectTextCandidates(text: string, keys: string[], candidates: string[]) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[\\s,{])${escaped}\\s*[:=]\\s*["']?([^"',}\\]\\s#]+)`, "gim");
    for (const match of text.matchAll(pattern)) {
      pushCandidate(candidates, match[1]);
    }
  }
}

function expandConfigPath(filePath: string, env: NodeJS.ProcessEnv, homeDir: string): string {
  let expanded = filePath.replace(/^~(?=$|[/\\])/, homeDir);
  expanded = expanded.replace(/\{APPDATA\}/g, env.APPDATA ?? path.join(homeDir, "AppData", "Roaming"));
  expanded = expanded.replace(/\{LOCALAPPDATA\}/g, env.LOCALAPPDATA ?? path.join(homeDir, "AppData", "Local"));
  expanded = expanded.replace(/\{XDG_CONFIG_HOME\}/g, env.XDG_CONFIG_HOME ?? path.join(homeDir, ".config"));
  return path.resolve(expanded);
}

export async function detectSimpleCliModel(
  def: SimpleCliModelDetectionDefinition,
  opts: SimpleCliModelDetectionOptions = {},
): Promise<SimpleCliDetectedModel | null> {
  const env = opts.env ?? process.env;
  const homeDir = opts.homeDir ?? os.homedir();
  const readFile = opts.readFile ?? ((filePath: string) => fs.readFile(filePath, "utf8"));
  const modelKeys = [...new Set([...(def.modelKeys ?? []), ...DEFAULT_MODEL_KEYS])];

  for (const key of def.envKeys) {
    const model = normalizeModel(env[key]);
    if (model) {
      return { model, provider: def.provider, source: `env:${key}`, candidates: [model] };
    }
  }

  for (const rawPath of def.configPaths) {
    const filePath = expandConfigPath(rawPath, env, homeDir);
    let text: string;
    try {
      text = await readFile(filePath);
    } catch {
      continue;
    }

    const candidates: string[] = [];
    try {
      collectJsonCandidates(JSON.parse(text), new Set(modelKeys), candidates);
    } catch {
      collectTextCandidates(text, modelKeys, candidates);
    }
    if (candidates.length > 0) {
      return {
        model: candidates[0],
        provider: def.provider,
        source: filePath,
        candidates,
      };
    }
  }

  const defaultModel = typeof def.defaultModel === "string" ? def.defaultModel.trim() : "";
  if (defaultModel) {
    return {
      model: defaultModel,
      provider: def.provider,
      source: "adapter_default",
      candidates: [defaultModel],
    };
  }

  return null;
}
