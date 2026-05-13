/**
 * Vault Memory Hook — post-run hook that enforces the karpathy-obsidian-memory
 * contract by writing the audit trail directly to the Obsidian vault.
 *
 * Behaviour (on `run.after.success`):
 *  1. Scaffold `<vault>/agents/<slug>.md` if missing.
 *  2. Extract `REA-####` IDs from `result_json` + `stdout_excerpt`.
 *  3. For each issue ID: scaffold `<vault>/issues/<id>.md` if missing.
 *  4. Validate each touched issue page's mtime advanced during the run.
 *  5. Append a single entry to `<vault>/log.md` matching the schema, marking
 *     `noncompliant` if any touched issue was not updated.
 *
 * Safety:
 *  - Filesystem-only side effects; never modifies the DB.
 *  - Errors are swallowed (handler is wrapped by the registry).
 *  - Idempotent: re-running the same hook on the same run only adds another
 *    log line; pages are only scaffolded when missing.
 *
 * Configurable via env:
 *  - PAPERCLIP_MEMORY_VAULT (default A:/Programming/paperclip/memory/obsidian)
 *  - PAPERCLIP_MEMORY_VAULT_TZ (default Europe/Brussels — label only)
 */

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LifecycleContext, PostHookHandler } from "../lifecycle-hooks.js";

const VAULT =
  process.env.PAPERCLIP_MEMORY_VAULT ||
  "A:/Programming/paperclip/memory/obsidian";
const TZ_LABEL = process.env.PAPERCLIP_MEMORY_VAULT_TZ || "Europe/Brussels";
const ISSUE_RE = /\bREA-\d{2,5}\b/g;

// LLM backend for extraction. Default to local ollama so background rebuilds
// don't burn external API quota. Override with PAPERCLIP_GRAPHIFY_BACKEND.
const GRAPHIFY_BACKEND = process.env.PAPERCLIP_GRAPHIFY_BACKEND || "ollama";
const GRAPHIFY_MODEL = process.env.PAPERCLIP_GRAPHIFY_MODEL || "qwen3.5:9b";
// Periodic refresh: extract the vault into a fresh graph every N ms regardless
// of run activity. Predictable load, no per-run trigger means no shell spam.
const GRAPHIFY_INTERVAL_MS = Number(
  process.env.PAPERCLIP_GRAPHIFY_INTERVAL_MS || 15 * 60 * 1000,
);
// Set PAPERCLIP_GRAPHIFY_DISABLE=1 to turn off auto-refresh entirely.
const GRAPHIFY_DISABLED = process.env.PAPERCLIP_GRAPHIFY_DISABLE === "1";

/**
 * Resolve the graphify executable to an absolute path ONCE at module load.
 * On Windows the binary is a `.cmd` shim; Node's spawn() does not honour
 * PATHEXT without `shell: true`. Using `where graphify` (or `which graphify`)
 * gives us the absolute path so we can spawn it directly — no shell, no
 * lingering cmd.exe wrappers, reliable exit detection.
 */
function resolveGraphifyBin(): string | null {
  const override = process.env.PAPERCLIP_GRAPHIFY_BIN;
  if (override && fs.existsSync(override)) return override;
  const lookupCmd = process.platform === "win32" ? "where" : "which";
  try {
    const output = execFileSync(lookupCmd, ["graphify"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    // `where` may print multiple lines; prefer the `.cmd` shim on Windows.
    const candidates = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (candidates.length === 0) return null;
    const cmdShim = candidates.find((line) => line.toLowerCase().endsWith(".cmd"));
    return cmdShim ?? candidates[0];
  } catch {
    return null;
  }
}

const GRAPHIFY_BIN_RESOLVED = resolveGraphifyBin();
let graphifyInFlight = false;
let graphifyTimer: NodeJS.Timeout | null = null;

/**
 * Fire-and-forget `graphify extract <vault>` to refresh the agent-memory
 * knowledge graph. Driven by a periodic timer (not per-run) so server load is
 * predictable. Errors are swallowed; failures never block the heartbeat hook.
 * The resulting graph powers `graphify query "..."` for agents.
 */
function runGraphifyExtract(): void {
  if (GRAPHIFY_DISABLED) return;
  if (!GRAPHIFY_BIN_RESOLVED) return; // graphify not installed — silently skip
  if (graphifyInFlight) return;
  if (!fs.existsSync(VAULT)) return; // vault missing — nothing to index
  graphifyInFlight = true;
  try {
    // `extract` has built-in caching, so only new/changed files are re-processed.
    // `--no-cluster` keeps it fast; clustering can be re-run on demand later.
    // `--max-concurrency 1` is required for local LLMs (per graphify CLI docs).
    // No `shell: true` — we resolved the absolute path so cmd.exe is unnecessary.
    const child = spawn(
      GRAPHIFY_BIN_RESOLVED,
      [
        "extract",
        VAULT,
        "--backend",
        GRAPHIFY_BACKEND,
        "--model",
        GRAPHIFY_MODEL,
        "--max-concurrency",
        "1",
        "--no-cluster",
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    child.on("error", () => {
      graphifyInFlight = false;
    });
    child.on("exit", () => {
      graphifyInFlight = false;
    });
    child.unref();
  } catch {
    graphifyInFlight = false;
  }
}

/**
 * Idempotent: starts the periodic timer once. Called lazily from the hook so
 * we don't pay the cost in test environments that never invoke the hook.
 * Module-level `graphifyTimer` guards against duplicate timers.
 */
function ensureGraphifyTimer(): void {
  if (GRAPHIFY_DISABLED) return;
  if (!GRAPHIFY_BIN_RESOLVED) return;
  if (graphifyTimer) return;
  graphifyTimer = setInterval(runGraphifyExtract, GRAPHIFY_INTERVAL_MS);
  graphifyTimer.unref(); // don't keep the event loop alive just for this
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${TZ_LABEL}`;
}

function ensureAgentPage(slug: string, name: string, role: string): boolean {
  const file = path.join(VAULT, "agents", `${slug}.md`);
  if (fs.existsSync(file)) return false;
  const today = new Date().toISOString().slice(0, 10);
  const body = `---
title: ${name} agent
created: ${today}
updated: ${today}
type: agent
tags: [paperclip, agent]
status: active
sources: []
---

# ${name}

## Role

${role || "TODO: describe responsibility lane and primary deliverables."}

## Durable Health Note

TODO: capture recurring blockers, adapter quirks, or restart hazards as they accrue.

## Handling Rule

TODO: document the playbook the agent should follow on resume.

## Latest Evidence

- Page scaffolded by vault-memory-hook on ${today}.
`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return true;
}

function ensureIssuePage(issueId: string): void {
  const file = path.join(VAULT, "issues", `${issueId}.md`);
  if (fs.existsSync(file)) return;
  const today = new Date().toISOString().slice(0, 10);
  const body = `---
title: ${issueId}
created: ${today}
updated: ${today}
type: issue
tags: [paperclip, issue]
status: needs-update
sources: []
---

# ${issueId}

## Summary

TODO: scaffolded by vault-memory-hook. Owning agent should fill in next wake.

## Durable Facts

- TODO

## Next Action

- TODO
`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/**
 * Build a compact, append-only digest from the run record. This is a fallback
 * for when the agent itself failed to write durable memory — we'd rather have
 * a noisy auto-digest than an empty page that says "TODO".
 */
function buildFallbackDigest(opts: {
  stamp: string;
  agentName: string;
  agentSlug: string;
  runId: string;
  status: string;
  resultText: string;
  stdoutExcerpt: string | null | undefined;
  nextAction: string | null | undefined;
}): string {
  const clip = (s: string | null | undefined, n: number): string => {
    if (!s) return "";
    const trimmed = s.trim();
    if (trimmed.length <= n) return trimmed;
    return trimmed.slice(0, n) + "…";
  };

  // Try to surface a one-line summary from result_json if it's structured.
  let summary = "";
  try {
    const parsed = JSON.parse(opts.resultText || "null");
    if (parsed && typeof parsed === "object") {
      const candidate =
        (parsed as Record<string, unknown>).summary ??
        (parsed as Record<string, unknown>).message ??
        (parsed as Record<string, unknown>).result ??
        (parsed as Record<string, unknown>).output;
      if (typeof candidate === "string") summary = clip(candidate, 400);
    }
  } catch {
    summary = clip(opts.resultText, 400);
  }

  const lines = [
    "",
    `## [${opts.stamp}] auto-digest by [[${opts.agentSlug}]] (hook-written)`,
    `- Run: \`${opts.runId.slice(0, 8)}\` status=${opts.status}; agent did not write durable memory, hook captured this digest.`,
  ];
  if (summary) lines.push(`- Summary: ${summary}`);
  if (opts.nextAction) lines.push(`- Next action (from run): ${clip(opts.nextAction, 400)}`);
  const tail = clip(opts.stdoutExcerpt, 600);
  if (tail) {
    lines.push("- Stdout excerpt:");
    lines.push("");
    lines.push("```");
    lines.push(tail);
    lines.push("```");
  }
  return lines.join("\n") + "\n";
}

function appendFallbackDigest(
  issueId: string,
  digest: string,
): void {
  const file = path.join(VAULT, "issues", `${issueId}.md`);
  try {
    fs.appendFileSync(file, digest);
  } catch {
    // swallow — vault writes are best-effort
  }
}

function issuePageUpdatedSince(issueId: string, since: Date): boolean {
  const file = path.join(VAULT, "issues", `${issueId}.md`);
  try {
    const st = fs.statSync(file);
    return st.mtime.getTime() >= since.getTime();
  } catch {
    return false;
  }
}

function extractIssueIds(text: string): string[] {
  const set = new Set<string>();
  for (const m of text.matchAll(ISSUE_RE)) set.add(m[0]);
  return [...set];
}

/**
 * The actual hook. Registered under the name "vault-memory" against
 * `run.after.success`.
 */
export const vaultMemoryPostHook: PostHookHandler = async (ctx: LifecycleContext) => {
  const { agent, run } = ctx;
  if (!run.finishedAt) return;
  const finishedAt = run.finishedAt instanceof Date ? run.finishedAt : new Date(run.finishedAt);
  const startedAt = run.startedAt
    ? run.startedAt instanceof Date
      ? run.startedAt
      : new Date(run.startedAt)
    : new Date(finishedAt.getTime() - 30 * 60 * 1000);

  const slug = slugify(agent.name);
  ensureAgentPage(slug, agent.name, agent.role ?? "");

  // Extract issue mentions from result + stdout.
  const resultText =
    run.resultJson && typeof run.resultJson === "object"
      ? JSON.stringify(run.resultJson)
      : (run.resultJson as string | null) ?? "";
  const blob = `${resultText}\n${run.stdoutExcerpt ?? ""}\n${run.nextAction ?? ""}`;
  const touched = extractIssueIds(blob);

  const stamp = fmtStamp(finishedAt);
  const missed: string[] = [];
  for (const id of touched) {
    ensureIssuePage(id);
    if (!issuePageUpdatedSince(id, startedAt)) missed.push(id);
  }

  // Fallback: agent didn't update touched issue pages — write a hook-authored
  // digest so the page is no longer empty. Better noisy than blank.
  if (missed.length > 0) {
    const digest = buildFallbackDigest({
      stamp,
      agentName: agent.name,
      agentSlug: slug,
      runId: run.id,
      status: run.status,
      resultText,
      stdoutExcerpt: run.stdoutExcerpt,
      nextAction: run.nextAction,
    });
    for (const id of missed) appendFallbackDigest(id, digest);
  }

  const action = missed.length > 0 ? "noncompliant-autodigest" : "run";
  const touchedRef = touched.length
    ? touched.map((i) => `[[${i}]]`).join(", ")
    : "no issue touched";
  const lines = [
    `\n## [${stamp}] ${action} | [[${slug}]] heartbeat`,
    `- Changed: ${agent.name} completed run ${run.id.slice(0, 8)} (\`${run.status}\`); touched ${touchedRef}.`,
    `- Evidence: heartbeat_run ${run.id}.`,
    missed.length > 0
      ? `- Next: [[${slug}]] missed durable writes on ${missed.map((i) => `[[${i}]]`).join(", ")} — update those pages or justify in comment.`
      : `- Next: review surfaced facts for [[${slug}]] role page if material.`,
  ];
  fs.appendFileSync(path.join(VAULT, "log.md"), lines.join("\n") + "\n");

  // Make sure the periodic graphify-refresh timer is armed. Idempotent —
  // the first hook call after server start starts the timer; further calls
  // are no-ops. The timer fires every PAPERCLIP_GRAPHIFY_INTERVAL_MS (default
  // 15 min) regardless of how many runs happen, so server load is predictable
  // and there's no per-run shell spawn.
  ensureGraphifyTimer();
};
