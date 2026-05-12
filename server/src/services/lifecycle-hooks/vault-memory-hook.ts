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

import fs from "node:fs";
import path from "node:path";
import type { LifecycleContext, PostHookHandler } from "../lifecycle-hooks.js";

const VAULT =
  process.env.PAPERCLIP_MEMORY_VAULT ||
  "A:/Programming/paperclip/memory/obsidian";
const TZ_LABEL = process.env.PAPERCLIP_MEMORY_VAULT_TZ || "Europe/Brussels";
const ISSUE_RE = /\bREA-\d{2,5}\b/g;

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

  const missed: string[] = [];
  for (const id of touched) {
    ensureIssuePage(id);
    if (!issuePageUpdatedSince(id, startedAt)) missed.push(id);
  }

  const stamp = fmtStamp(finishedAt);
  const action = missed.length > 0 ? "noncompliant" : "run";
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
};
