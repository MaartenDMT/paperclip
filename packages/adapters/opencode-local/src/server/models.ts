import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterModel } from "@paperclipai/adapter-utils";
import {
  asString,
  ensurePathInEnv,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import { isValidOpenCodeModelId } from "../index.js";

const MODELS_CACHE_TTL_MS = 60_000;
const MODELS_DISK_CACHE_TTL_MS = 60 * 60 * 1000;
const MODELS_DISCOVERY_TIMEOUT_MS = 60_000;
const DISK_CACHE_SCHEMA_VERSION = 1;

type DiskCacheEntry = { expiresAt: number; models: AdapterModel[] };
type DiskCacheFile = { version: number; entries: Record<string, DiskCacheEntry> };

function resolveDiskCachePath(): string {
  const override = process.env.PAPERCLIP_OPENCODE_MODELS_CACHE_PATH;
  if (override && override.trim().length > 0) return override.trim();
  const baseDir =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
      : process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(baseDir, "paperclip", "opencode-models.json");
}

async function readDiskCache(): Promise<DiskCacheFile> {
  try {
    const raw = await readFile(resolveDiskCachePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DiskCacheFile>;
    if (parsed?.version !== DISK_CACHE_SCHEMA_VERSION || typeof parsed.entries !== "object" || parsed.entries === null) {
      return { version: DISK_CACHE_SCHEMA_VERSION, entries: {} };
    }
    return { version: DISK_CACHE_SCHEMA_VERSION, entries: parsed.entries as Record<string, DiskCacheEntry> };
  } catch {
    return { version: DISK_CACHE_SCHEMA_VERSION, entries: {} };
  }
}

async function writeDiskCache(file: DiskCacheFile): Promise<void> {
  const cachePath = resolveDiskCachePath();
  try {
    await mkdir(path.dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(file), "utf8");
    await rename(tmpPath, cachePath);
  } catch {
    // Cache write failures must never break discovery.
  }
}

function pruneExpiredDiskEntries(file: DiskCacheFile, now: number): DiskCacheFile {
  const entries: Record<string, DiskCacheEntry> = {};
  for (const [k, v] of Object.entries(file.entries)) {
    if (v && typeof v.expiresAt === "number" && v.expiresAt > now && Array.isArray(v.models)) {
      entries[k] = v;
    }
  }
  return { version: DISK_CACHE_SCHEMA_VERSION, entries };
}

function resolveOpenCodeCommand(input: unknown): string {
  const envOverride =
    typeof process.env.PAPERCLIP_OPENCODE_COMMAND === "string" &&
    process.env.PAPERCLIP_OPENCODE_COMMAND.trim().length > 0
      ? process.env.PAPERCLIP_OPENCODE_COMMAND.trim()
      : "opencode";
  return asString(input, envOverride);
}

const discoveryCache = new Map<string, { expiresAt: number; models: AdapterModel[] }>();
// In-flight de-dup: when multiple agents probe simultaneously, only the first
// kicks off the external `opencode models` invocation; the rest await the same
// promise. Prevents concurrent SQLite migrations against opencode.db (the root
// cause of discovery timeouts when many idle agents wake at once).
const inflightDiscovery = new Map<string, Promise<AdapterModel[]>>();
const VOLATILE_ENV_KEY_PREFIXES = ["PAPERCLIP_", "npm_", "NPM_"] as const;
const VOLATILE_ENV_KEY_EXACT = new Set(["PWD", "OLDPWD", "SHLVL", "_", "TERM_SESSION_ID", "HOME"]);

export function requireOpenCodeModelId(input: unknown): string {
  const model = asString(input, "").trim();
  if (!isValidOpenCodeModelId(model)) {
    throw new Error("OpenCode requires `adapterConfig.model` in provider/model format.");
  }
  return model;
}

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const deduped: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({ id, label: model.label.trim() || id });
  }
  return deduped;
}

function sortModels(models: AdapterModel[]): AdapterModel[] {
  return [...models].sort((a, b) =>
    a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }),
  );
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

export function parseOpenCodeModelsOutput(stdout: string): AdapterModel[] {
  const parsed: AdapterModel[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const firstToken = line.split(/\s+/)[0]?.trim() ?? "";
    if (!firstToken.includes("/")) continue;
    const provider = firstToken.slice(0, firstToken.indexOf("/")).trim();
    const model = firstToken.slice(firstToken.indexOf("/") + 1).trim();
    if (!provider || !model) continue;
    parsed.push({ id: `${provider}/${model}`, label: `${provider}/${model}` });
  }
  return dedupeModels(parsed);
}

function normalizeEnv(input: unknown): Record<string, string> {
  const envInput = typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envInput)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function isVolatileEnvKey(key: string): boolean {
  if (VOLATILE_ENV_KEY_EXACT.has(key)) return true;
  return VOLATILE_ENV_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function discoveryCacheKey(command: string, cwd: string, env: Record<string, string>) {
  const envKey = Object.entries(env)
    .filter(([key]) => !isVolatileEnvKey(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${hashValue(value)}`)
    .join("\n");
  return `${command}\n${cwd}\n${envKey}`;
}

function pruneExpiredDiscoveryCache(now: number) {
  for (const [key, value] of discoveryCache.entries()) {
    if (value.expiresAt <= now) discoveryCache.delete(key);
  }
}

export async function discoverOpenCodeModels(input: {
  command?: unknown;
  cwd?: unknown;
  env?: unknown;
} = {}): Promise<AdapterModel[]> {
  const command = resolveOpenCodeCommand(input.command);
  const cwd = asString(input.cwd, process.cwd());
  const env = normalizeEnv(input.env);
  // Ensure HOME points to the actual running user's home directory.
  // When the server is started via `runuser -u <user>`, HOME may still
  // reflect the parent process (e.g. /root), causing OpenCode to miss
  // provider auth credentials stored under the target user's home.
  let resolvedHome: string | undefined;
  try {
    resolvedHome = os.userInfo().homedir || undefined;
  } catch {
    // os.userInfo() throws a SystemError when the current UID has no
    // /etc/passwd entry (e.g. `docker run --user 1234` with a minimal
    // image). Fall back to process.env.HOME.
  }
  // Prevent OpenCode from writing an opencode.json into the working directory.
  const runtimeEnv = normalizeEnv(ensurePathInEnv({ ...process.env, ...env, ...(resolvedHome ? { HOME: resolvedHome } : {}), OPENCODE_DISABLE_PROJECT_CONFIG: "true" }));

  const result = await runChildProcess(
    `opencode-models-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    command,
    ["models"],
    {
      cwd,
      env: runtimeEnv,
      timeoutSec: MODELS_DISCOVERY_TIMEOUT_MS / 1000,
      graceSec: 3,
      onLog: async () => {},
    },
  );

  if (result.timedOut) {
    throw new Error(`\`opencode models\` timed out after ${MODELS_DISCOVERY_TIMEOUT_MS / 1000}s.`);
  }
  if ((result.exitCode ?? 1) !== 0) {
    const detail = firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout);
    throw new Error(detail ? `\`opencode models\` failed: ${detail}` : "`opencode models` failed.");
  }

  return sortModels(parseOpenCodeModelsOutput(result.stdout));
}

export async function discoverOpenCodeModelsCached(input: {
  command?: unknown;
  cwd?: unknown;
  env?: unknown;
} = {}): Promise<AdapterModel[]> {
  const command = resolveOpenCodeCommand(input.command);
  const cwd = asString(input.cwd, process.cwd());
  const env = normalizeEnv(input.env);
  const key = discoveryCacheKey(command, cwd, env);
  const now = Date.now();
  pruneExpiredDiscoveryCache(now);
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.models;

  // Single-flight: collapse concurrent callers onto one external invocation.
  const existing = inflightDiscovery.get(key);
  if (existing) return existing;

  // L2: cross-process disk cache. Hydrates L1 on hit so concurrent Paperclip
  // processes don't all race `opencode models` (which migrates opencode.db on
  // every invocation and produces SQLite lock crashes under contention).
  const diskHydration = (async () => {
    const file = await readDiskCache();
    const entry = file.entries[key];
    if (entry && entry.expiresAt > Date.now()) {
      discoveryCache.set(key, { expiresAt: Date.now() + MODELS_CACHE_TTL_MS, models: entry.models });
      return entry.models;
    }
    return null;
  })();

  const pending = diskHydration.then(async (hit) => {
    if (hit) return hit;
    const models = await discoverOpenCodeModels({ command, cwd, env });
    const nowAfter = Date.now();
    discoveryCache.set(key, { expiresAt: nowAfter + MODELS_CACHE_TTL_MS, models });
    const next = pruneExpiredDiskEntries(await readDiskCache(), nowAfter);
    next.entries[key] = { expiresAt: nowAfter + MODELS_DISK_CACHE_TTL_MS, models };
    await writeDiskCache(next);
    return models;
  }).finally(() => {
    inflightDiscovery.delete(key);
  });
  inflightDiscovery.set(key, pending);
  return pending;
}

export async function ensureOpenCodeModelConfiguredAndAvailable(input: {
  model?: unknown;
  command?: unknown;
  cwd?: unknown;
  env?: unknown;
}): Promise<AdapterModel[]> {
  const model = requireOpenCodeModelId(input.model);

  const models = await discoverOpenCodeModelsCached({
    command: input.command,
    cwd: input.cwd,
    env: input.env,
  });

  if (models.length === 0) {
    throw new Error("OpenCode returned no models. Run `opencode models` and verify provider auth.");
  }

  if (!models.some((entry) => entry.id === model)) {
    const sample = models.slice(0, 12).map((entry) => entry.id).join(", ");
    throw new Error(
      `Configured OpenCode model is unavailable: ${model}. Available models: ${sample}${models.length > 12 ? ", ..." : ""}`,
    );
  }

  return models;
}

export async function listOpenCodeModels(): Promise<AdapterModel[]> {
  try {
    return await discoverOpenCodeModelsCached();
  } catch {
    return [];
  }
}

export function resetOpenCodeModelsCacheForTests() {
  discoveryCache.clear();
  inflightDiscovery.clear();
}

export async function resetOpenCodeModelsDiskCacheForTests() {
  try {
    await writeFile(resolveDiskCachePath(), JSON.stringify({ version: DISK_CACHE_SCHEMA_VERSION, entries: {} }), "utf8");
  } catch {
    // ignore
  }
}
