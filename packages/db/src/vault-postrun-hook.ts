/**
 * Vault post-run hook.
 *
 * Polls heartbeat_runs that finished since the last cursor, and for each
 * successful run:
 *  - ensures `<vault>/agents/<slug>.md` exists with the schema skeleton
 *  - appends a one-line log entry to `<vault>/log.md`
 *
 * Intended to run on a cron / Task Scheduler / pm2 watcher every 1–5 min.
 * Idempotent: re-running is safe; cursor advances only on success.
 *
 * Usage:
 *   tsx src/vault-postrun-hook.ts              # one-shot pass
 *   tsx src/vault-postrun-hook.ts --watch 60   # loop every 60s
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

const VAULT =
  process.env.PAPERCLIP_MEMORY_VAULT ||
  "A:/Programming/paperclip/memory/obsidian";
const CURSOR_FILE = path.join(VAULT, ".vault-hook-cursor.json");
const TZ = "Europe/Brussels";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readCursor(): string {
  try {
    const j = JSON.parse(fs.readFileSync(CURSOR_FILE, "utf8"));
    return j.lastFinishedAt ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();
  } catch {
    return new Date(Date.now() - 60 * 60 * 1000).toISOString();
  }
}
function writeCursor(iso: string): void {
  fs.mkdirSync(path.dirname(CURSOR_FILE), { recursive: true });
  fs.writeFileSync(CURSOR_FILE, JSON.stringify({ lastFinishedAt: iso }, null, 2));
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

- Page scaffolded by vault-postrun-hook on ${today}.

## Related Issues

- TODO: link active \`[[REA-####]]\` pages once the agent has touched them.
`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return true;
}

function fmtStamp(d: Date): string {
  // YYYY-MM-DD HH:mm Europe/Brussels  (local clock, naive)
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${TZ}`;
}

function appendLogEntry(run: {
  id: string;
  agentName: string;
  agentSlug: string;
  status: string;
  finishedAt: Date;
  touchedIssues: string[];
  missedIssues: string[];
}): void {
  const file = path.join(VAULT, "log.md");
  const stamp = fmtStamp(run.finishedAt);
  const action = run.missedIssues.length > 0 ? "noncompliant" : "run";
  const touched = run.touchedIssues.length
    ? run.touchedIssues.map((i) => `[[${i}]]`).join(", ")
    : "no issue touched";
  const lines: string[] = [];
  lines.push(`\n## [${stamp}] ${action} | [[${run.agentSlug}]] heartbeat`);
  lines.push(
    `- Changed: ${run.agentName} completed run ${run.id.slice(0, 8)} (\`${run.status}\`); touched ${touched}.`,
  );
  lines.push(`- Evidence: heartbeat_run ${run.id}.`);
  if (run.missedIssues.length > 0) {
    lines.push(
      `- Next: [[${run.agentSlug}]] missed durable writes on ${run.missedIssues.map((i) => `[[${i}]]`).join(", ")} — update those pages or justify in comment.`,
    );
  } else {
    lines.push(`- Next: review surfaced facts for [[${run.agentSlug}]] role page if material.`);
  }
  fs.appendFileSync(file, lines.join("\n") + "\n");
}

const ISSUE_RE = /\bREA-\d{2,5}\b/g;
function extractIssueIds(text: string): string[] {
  const set = new Set<string>();
  for (const m of text.matchAll(ISSUE_RE)) set.add(m[0]);
  return [...set];
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

TODO: scaffolded by vault-postrun-hook. The owning agent should fill this in next wake.

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

async function runOnce(): Promise<{ processed: number; scaffolded: number; cursor: string }> {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  let processed = 0;
  let scaffolded = 0;
  let newCursor = readCursor();
  try {
    const since = readCursor();
    const rows = await sql<
      Array<{
        id: string;
        agent_id: string;
        status: string;
        started_at: Date | null;
        finished_at: Date;
        name: string;
        role: string;
        result_text: string | null;
        stdout: string | null;
      }>
    >`
      SELECT h.id, h.agent_id, h.status, h.started_at, h.finished_at, a.name, a.role,
             h.result_json::text AS result_text, h.stdout_excerpt AS stdout
        FROM heartbeat_runs h
        JOIN agents a ON a.id = h.agent_id
       WHERE h.finished_at IS NOT NULL
         AND h.finished_at > ${since}
         AND h.status IN ('completed','success','done')
       ORDER BY h.finished_at ASC
       LIMIT 500`;

    let noncompliant = 0;
    for (const row of rows) {
      const slug = slugify(row.name);
      if (ensureAgentPage(slug, row.name, row.role)) scaffolded++;
      const blob = `${row.result_text ?? ""}\n${row.stdout ?? ""}`;
      const touchedIssues = extractIssueIds(blob);
      const runStart = row.started_at ?? new Date(row.finished_at.getTime() - 30 * 60 * 1000);
      const missedIssues: string[] = [];
      for (const issueId of touchedIssues) {
        ensureIssuePage(issueId);
        if (!issuePageUpdatedSince(issueId, runStart)) missedIssues.push(issueId);
      }
      if (missedIssues.length > 0) noncompliant++;
      appendLogEntry({
        id: row.id,
        agentName: row.name,
        agentSlug: slug,
        status: row.status,
        finishedAt: row.finished_at,
        touchedIssues,
        missedIssues,
      });
      processed++;
      const iso = row.finished_at.toISOString();
      if (iso > newCursor) newCursor = iso;
    }
    if (processed > 0) writeCursor(newCursor);
    console.log(`[vault-hook] processed=${processed} scaffolded=${scaffolded} noncompliant=${noncompliant}`);
    return { processed, scaffolded, cursor: newCursor };
  } finally {
    await sql.end();
    await r.stop();
  }
}

async function main(): Promise<void> {
  const watchArgIdx = process.argv.indexOf("--watch");
  const intervalSec = watchArgIdx >= 0 ? Number(process.argv[watchArgIdx + 1] || 60) : 0;

  do {
    const { processed, scaffolded, cursor } = await runOnce();
    console.log(`[vault-hook] processed=${processed} scaffolded=${scaffolded} cursor=${cursor}`);
    if (intervalSec > 0) await new Promise((res) => setTimeout(res, intervalSec * 1000));
  } while (intervalSec > 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
