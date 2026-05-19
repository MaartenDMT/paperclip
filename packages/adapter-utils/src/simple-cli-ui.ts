import type { CreateConfigValues, TranscriptEntry } from "./types.js";

function textFromRecord(rec: Record<string, unknown>): string {
  return typeof rec.content === "string"
    ? rec.content
    : typeof rec.text === "string"
      ? rec.text
      : typeof rec.message === "string"
        ? rec.message
        : typeof rec.deltaContent === "string"
          ? rec.deltaContent
          : typeof rec.thinking === "string"
            ? rec.thinking
            : typeof rec.think === "string"
              ? rec.think
              : "";
}

function entriesFromContentArray(content: unknown, ts: string): TranscriptEntry[] {
  if (!Array.isArray(content)) return [];
  const entries: TranscriptEntry[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) entries.push({ kind: "assistant", ts, text });
      continue;
    }
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const text = textFromRecord(rec).trim();
    if (!text) continue;
    const type = typeof rec.type === "string" ? rec.type : "";
    entries.push({ kind: /think|reason/i.test(type) || "think" in rec || "thinking" in rec ? "thinking" : "assistant", ts, text });
  }
  return entries;
}

export function parseSimpleCliStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const text = line.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      const type = typeof rec.type === "string" ? rec.type : "";
      const nestedData = typeof rec.data === "object" && rec.data !== null && !Array.isArray(rec.data)
        ? rec.data as Record<string, unknown>
        : null;
      if (type === "result") {
        const usage = typeof rec.usage === "object" && rec.usage !== null && !Array.isArray(rec.usage)
          ? rec.usage as Record<string, unknown>
          : {};
        return [{
          kind: "result",
          ts,
          text: textFromRecord(nestedData ?? rec) || "Run completed",
          subtype: "success",
          inputTokens: Number(usage.input_tokens ?? usage.inputTokens ?? 0) || 0,
          outputTokens: Number(usage.output_tokens ?? usage.outputTokens ?? 0) || 0,
          cachedTokens: Number(usage.cached_tokens ?? usage.cachedTokens ?? 0) || 0,
          costUsd: Number(usage.cost_usd ?? usage.costUsd ?? 0) || 0,
          isError: false,
          errors: [],
        }];
      }
      const contentEntries = entriesFromContentArray(rec.content, ts);
      if (contentEntries.length > 0) return contentEntries;
      const nestedEntries = nestedData ? entriesFromContentArray(nestedData.content, ts) : [];
      if (nestedEntries.length > 0) return nestedEntries;
      const content = textFromRecord(nestedData ?? rec);
      if (content) {
        if (/thinking|reasoning/i.test(type)) return [{ kind: "thinking", ts, text: content }];
        if (/error/i.test(type)) return [{ kind: "stderr", ts, text: content }];
        return [{ kind: "assistant", ts, text: content }];
      }
    }
  } catch {
    // Plain text output is expected for most CLIs.
  }
  return [{ kind: "stdout", ts, text }];
}

export function parseCommaArgs(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseEnvVars(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = value;
  }
  return env;
}

export function parseEnvBindings(bindings: unknown): Record<string, unknown> {
  if (typeof bindings !== "object" || bindings === null || Array.isArray(bindings)) return {};
  const env: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(bindings)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (typeof raw === "string") {
      env[key] = { type: "plain", value: raw };
      continue;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    if (rec.type === "plain" && typeof rec.value === "string") {
      env[key] = { type: "plain", value: rec.value };
      continue;
    }
    if (rec.type === "secret_ref" && typeof rec.secretId === "string") {
      env[key] = {
        type: "secret_ref",
        secretId: rec.secretId,
        ...(typeof rec.version === "number" || rec.version === "latest" ? { version: rec.version } : {}),
      };
    }
  }
  return env;
}

export function buildSimpleCliConfig(
  v: CreateConfigValues,
  defaults: { model?: string; timeoutSec?: number; graceSec?: number },
): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.cwd) ac.cwd = v.cwd;
  if (v.instructionsFilePath) ac.instructionsFilePath = v.instructionsFilePath;
  if (v.model || defaults.model) ac.model = v.model || defaults.model;
  if (v.promptTemplate) ac.promptTemplate = v.promptTemplate;
  ac.timeoutSec = defaults.timeoutSec ?? 0;
  ac.graceSec = defaults.graceSec ?? 20;
  ac.dangerouslySkipPermissions = v.dangerouslySkipPermissions;
  ac.dangerouslyBypassSandbox = v.dangerouslyBypassSandbox;

  const env = parseEnvBindings(v.envBindings);
  const legacy = parseEnvVars(v.envVars);
  for (const [key, value] of Object.entries(legacy)) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) {
      env[key] = { type: "plain", value };
    }
  }
  if (Object.keys(env).length > 0) ac.env = env;
  if (v.command) ac.command = v.command;
  if (v.extraArgs) ac.extraArgs = parseCommaArgs(v.extraArgs);
  return ac;
}
