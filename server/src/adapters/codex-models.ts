import { spawn } from "node:child_process";
import { models as codexFallbackModels } from "@paperclipai/adapter-codex-local";
import type { AdapterModel } from "./types.js";

const CODEX_MODELS_CACHE_TTL_MS = 60_000;

let cached: { expiresAt: number; models: AdapterModel[] } | null = null;

interface CodexModelListEntry {
  id?: unknown;
  model?: unknown;
  displayName?: unknown;
  hidden?: unknown;
}

interface CodexModelListResult {
  data?: unknown;
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

function mergedWithFallback(models: AdapterModel[]): AdapterModel[] {
  return dedupeModels([
    ...models,
    ...codexFallbackModels,
  ]).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }));
}

function parseCodexModelListResult(payload: Record<string, unknown> | null | undefined): AdapterModel[] {
  const result =
    payload && typeof payload.result === "object" && payload.result !== null
      ? (payload.result as CodexModelListResult)
      : null;
  const data = Array.isArray(result?.data) ? result.data : [];
  const models: AdapterModel[] = [];

  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as CodexModelListEntry;
    if (record.hidden === true) continue;
    const id = typeof record.id === "string" && record.id.trim().length > 0
      ? record.id.trim()
      : (typeof record.model === "string" && record.model.trim().length > 0 ? record.model.trim() : "");
    if (!id) continue;
    const label = typeof record.displayName === "string" && record.displayName.trim().length > 0
      ? record.displayName.trim()
      : id;
    models.push({ id, label });
  }

  return dedupeModels(models);
}

type CodexRpcMessage = Record<string, unknown>;

async function requestCodexRpc(method: string, params: Record<string, unknown> = {}): Promise<CodexRpcMessage | null> {
  const proc = spawn("codex", ["-s", "read-only", "-a", "untrusted", "app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let nextId = 1;
  let buffer = "";
  let settled = false;
  const pending = new Map<number, { resolve: (value: CodexRpcMessage) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  const cleanup = () => {
    if (!proc.killed) {
      proc.kill("SIGTERM");
    }
  };

  const finishPending = (error: Error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };

  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) break;
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let parsed: CodexRpcMessage;
      try {
        parsed = JSON.parse(line) as CodexRpcMessage;
      } catch {
        continue;
      }
      const id = typeof parsed.id === "number" ? parsed.id : null;
      if (id == null) continue;
      const request = pending.get(id);
      if (!request) continue;
      pending.delete(id);
      clearTimeout(request.timer);
      request.resolve(parsed);
    }
  });

  const request = (requestMethod: string, requestParams: Record<string, unknown>, timeoutMs: number): Promise<CodexRpcMessage> => {
    const id = nextId++;
    const payload = JSON.stringify({ id, method: requestMethod, params: requestParams }) + "\n";
    return new Promise<CodexRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`codex app-server timed out on ${requestMethod}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      proc.stdin.write(payload);
    });
  };

  try {
    const initialize = await request("initialize", {
      clientInfo: { name: "paperclip", version: "0.0.0" },
    }, 6_000);
    if ("error" in initialize) return null;
    proc.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    const result = await request(method, params, 20_000);
    settled = true;
    return "error" in result ? null : result;
  } catch {
    return null;
  } finally {
    finishPending(new Error("codex app-server request canceled"));
    cleanup();
    if (!settled) {
      proc.stdin.end();
    }
  }
}

async function defaultCodexModelsFetcher(): Promise<AdapterModel[]> {
  const response = await requestCodexRpc("model/list");
  if (!response) return [];
  return parseCodexModelListResult(response);
}

let codexModelsFetcher: () => Promise<AdapterModel[]> = defaultCodexModelsFetcher;

async function loadCodexModels(options?: { forceRefresh?: boolean }): Promise<AdapterModel[]> {
  const forceRefresh = options?.forceRefresh === true;
  const fallback = dedupeModels(codexFallbackModels);
  const now = Date.now();

  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.models;
  }

  const fetched = await codexModelsFetcher();
  if (fetched.length > 0) {
    const merged = mergedWithFallback(fetched);
    cached = {
      expiresAt: now + CODEX_MODELS_CACHE_TTL_MS,
      models: merged,
    };
    return merged;
  }

  if (cached && cached.models.length > 0) {
    return cached.models;
  }

  return fallback;
}

export async function listCodexModels(): Promise<AdapterModel[]> {
  return loadCodexModels();
}

export async function refreshCodexModels(): Promise<AdapterModel[]> {
  return loadCodexModels({ forceRefresh: true });
}

export function resetCodexModelsCacheForTests() {
  cached = null;
}

export function setCodexModelsFetcherForTests(fetcher: (() => Promise<AdapterModel[]>) | null) {
  codexModelsFetcher = fetcher ?? defaultCodexModelsFetcher;
}
