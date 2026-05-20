import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  execute as executeOpenCode,
  testEnvironment as testOpenCodeEnvironment,
} from "@paperclipai/adapter-opencode-local/server";
import { detectSimpleCliModel } from "@paperclipai/adapter-utils/simple-cli-model-detection";
import type {
  AdapterExecutionContext,
  AdapterEnvironmentTestContext,
  ProviderQuotaResult,
  QuotaWindow,
} from "@paperclipai/adapter-utils";
import { DEFAULT_MINIMAX_LOCAL_MODEL, type } from "../index.js";

const execFileAsync = promisify(execFile);

const LEGACY_MINIMAX_MODEL_RE = /^MiniMax-/i;

function normalizeMiniMaxModelId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return DEFAULT_MINIMAX_LOCAL_MODEL;
  }
  const trimmed = value.trim();
  if (trimmed === "auto") return DEFAULT_MINIMAX_LOCAL_MODEL;
  if (trimmed.includes("/")) return trimmed;
  if (LEGACY_MINIMAX_MODEL_RE.test(trimmed)) return `minimax/${trimmed}`;
  return trimmed;
}

export function normalizeMiniMaxOpenCodeConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const command =
    typeof config.command === "string" && config.command.trim().length > 0 && config.command.trim() !== "mmx"
      ? config.command.trim()
      : "opencode";
  return {
    ...config,
    command,
    model: normalizeMiniMaxModelId(config.model),
    dangerouslySkipPermissions: config.dangerouslySkipPermissions === false
      ? true
      : config.dangerouslySkipPermissions ?? true,
  };
}

export function execute(ctx: AdapterExecutionContext) {
  return executeOpenCode({
    ...ctx,
    config: normalizeMiniMaxOpenCodeConfig(ctx.config),
  });
}

export async function testEnvironment(ctx: AdapterEnvironmentTestContext) {
  const result = await testOpenCodeEnvironment({
    ...ctx,
    adapterType: "opencode_local",
    config: normalizeMiniMaxOpenCodeConfig(
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
    provider: "minimax",
    defaultModel: DEFAULT_MINIMAX_LOCAL_MODEL,
    envKeys: ["MINIMAX_MODEL", "MMX_MODEL"],
    configPaths: [
      "~/.mmx/config.json",
      "~/.mmx/config.toml",
      "~/.minimax/config.json",
      "~/.minimax/config.toml",
      "{XDG_CONFIG_HOME}/mmx/config.json",
      "{XDG_CONFIG_HOME}/mmx/config.toml",
      "{XDG_CONFIG_HOME}/minimax/config.json",
      "{XDG_CONFIG_HOME}/minimax/config.toml",
      "{APPDATA}/mmx/config.json",
      "{APPDATA}/mmx/config.toml",
      "{APPDATA}/minimax/config.json",
      "{APPDATA}/minimax/config.toml",
    ],
    modelKeys: ["model", "modelId", "model_id", "defaultModel", "default_model"],
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function epochMsToIso(value: unknown): string | null {
  const ms = asNumber(value);
  if (ms == null || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildQuotaWindow(
  label: string,
  total: number | null,
  used: number | null,
  resetsAt: string | null,
  detailLabel: string,
): QuotaWindow | null {
  if (total == null || total <= 0 || used == null || used < 0) return null;
  const remaining = Math.max(0, total - used);
  return {
    label,
    usedPercent: Math.max(0, Math.min(100, Math.round((used / total) * 100))),
    resetsAt,
    valueLabel: `${remaining} / ${total} remaining`,
    detail: `${used} used in ${detailLabel}`,
  };
}

export function mapMiniMaxQuotaShowOutput(stdout: string): ProviderQuotaResult {
  const parsed = JSON.parse(stdout) as unknown;
  const root = asRecord(parsed);
  const rows = Array.isArray(root?.model_remains) ? root.model_remains : [];
  const windows: QuotaWindow[] = [];

  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) continue;
    const modelName = asString(row.model_name);
    if (!modelName) continue;

    const intervalWindow = buildQuotaWindow(
      `${modelName} · current window`,
      asNumber(row.current_interval_total_count),
      asNumber(row.current_interval_usage_count),
      epochMsToIso(row.end_time),
      "current quota window",
    );
    if (intervalWindow) windows.push(intervalWindow);

    const weeklyWindow = buildQuotaWindow(
      `${modelName} · weekly`,
      asNumber(row.current_weekly_total_count),
      asNumber(row.current_weekly_usage_count),
      epochMsToIso(row.weekly_end_time),
      "weekly quota window",
    );
    if (weeklyWindow) windows.push(weeklyWindow);
  }

  return {
    provider: "minimax",
    source: "mmx-cli",
    ok: true,
    windows,
  };
}

export async function getQuotaWindows(): Promise<ProviderQuotaResult> {
  try {
    const command = process.platform === "win32" ? "cmd.exe" : "mmx";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "mmx quota show --output json"]
      : ["quota", "show", "--output", "json"];
    const { stdout } = await execFileAsync(command, args, {
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    return mapMiniMaxQuotaShowOutput(stdout);
  } catch (error) {
    return {
      provider: "minimax",
      source: "mmx-cli",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      windows: [],
    };
  }
}
