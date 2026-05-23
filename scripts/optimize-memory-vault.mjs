import fs from "node:fs";
import path from "node:path";

const vaultRoot = process.argv[2] || "A:/Programming/paperclip/memory/obsidian";
const paraRoot = path.dirname(vaultRoot);
const today = new Date().toISOString().slice(0, 10);

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function upsertFrontmatterUpdated(markdown, yyyyMmDd) {
  if (!markdown.startsWith("---\n")) return markdown;
  return markdown.replace(/^updated:\s.*$/m, `updated: ${yyyyMmDd}`);
}

function ensureVaultDaily(dateKey) {
  const file = path.join(vaultRoot, "daily", `${dateKey}.md`);
  if (!fs.existsSync(file)) {
    write(
      file,
      `---
title: ${dateKey}
created: ${dateKey}
updated: ${dateKey}
type: run
tags: [paperclip, daily]
status: active
sources: []
---

# ${dateKey}
`,
    );
    return file;
  }
  write(file, upsertFrontmatterUpdated(read(file), dateKey));
  return file;
}

function ensureParaDaily(dateKey) {
  const file = path.join(paraRoot, `${dateKey}.md`);
  if (!fs.existsSync(file)) write(file, `# ${dateKey}\n`);
  return file;
}

function appendIfMissing(file, marker, block) {
  const current = read(file);
  if (current.includes(marker)) return false;
  write(file, current + block);
  return true;
}

function stripStdoutExcerpts(markdown) {
  return markdown.replace(/\n- Stdout excerpt:\n\n```[\s\S]*?\n```\n?/g, "\n");
}

function normalizeScaffold(markdown) {
  if (!markdown.includes("TODO: scaffolded by vault-memory-hook.")) return markdown;
  if (!markdown.match(/^## \[\d{4}-\d{2}-\d{2} /m)) return markdown;
  return markdown
    .replace(
      /## Summary\n\nTODO: scaffolded by vault-memory-hook\. Owning agent should fill in next wake\.\n\n## Durable Facts\n\n- TODO\n\n## Next Action\n\n- TODO\n/m,
      [
        "## Summary",
        "",
        "Auto-maintained issue memory. Use the latest dated entries below as the durable source of truth until the owning agent writes a concise synthesis.",
        "",
        "## Durable Facts",
        "",
        "- Hook-written auto-digests are fallback memory, not canonical transcript storage.",
        "- Prefer concise dated entries that capture decisions, blockers, verification, and next action.",
        "",
        "## Next Action",
        "",
        "- On the next real wake, replace fallback-only drift with a short synthesized update.",
        "",
      ].join("\n"),
    );
}

function appendIssueResolution(issueId, lines) {
  const file = path.join(vaultRoot, "issues", `${issueId}.md`);
  if (!fs.existsSync(file)) return false;
  const marker = `## [${today} 22:19 Europe/Brussels] memory maintenance`;
  const block = ["", marker, ...lines, ""].join("\n");
  return appendIfMissing(file, marker, block);
}

const issuesDir = path.join(vaultRoot, "issues");
const issueFiles = fs.existsSync(issuesDir)
  ? fs.readdirSync(issuesDir).filter((name) => name.toLowerCase().endsWith(".md"))
  : [];

let cleanedIssueFiles = 0;
let strippedStdoutBlocks = 0;
let normalizedScaffolds = 0;

for (const name of issueFiles) {
  const file = path.join(issuesDir, name);
  const before = read(file);
  const stdoutCount = (before.match(/\n- Stdout excerpt:\n\n```/g) || []).length;
  const stripped = stripStdoutExcerpts(before);
  const normalized = normalizeScaffold(stripped);
  if (normalized !== before) {
    let next = upsertFrontmatterUpdated(normalized, today);
    if (!next.endsWith("\n")) next += "\n";
    write(file, next);
    cleanedIssueFiles += 1;
    strippedStdoutBlocks += stdoutCount;
    if (normalized !== stripped) normalizedScaffolds += 1;
  }
}

const rea1584Updated = appendIssueResolution("REA-1584", [
  "- Changed: Memory normalized after fresh production verification resolved the old showcase deploy/auth outage.",
  "- Evidence: `GET /api/showcase/assets` => `200`, `GET /api/analytics/showcase/performance?days=30` => `200`, synthetic `POST /api/showcase/track-event` => `200 accepted=true` on 2026-05-22.",
  "- Decisions: Keep the issue closed; future Railway CLI auth gaps should be tracked only on new concrete deploy tasks.",
  "- Next: No follow-up unless a new dated production regression appears.",
]);

const rea2511Updated = appendIssueResolution("REA-2511", [
  "- Changed: Memory normalized after closing this stale blocker artifact.",
  "- Evidence: Railway/Vercel non-interactive tokens are still missing locally, but no open issue remains blocked by that gap after REA-1584 resolved on 2026-05-22.",
  "- Decisions: Do not reuse this blocker for generic auth drift; open a fresh blocker only when a concrete live task truly needs CLI deploy auth.",
  "- Next: No follow-up unless a new task specifically requires Railway/Vercel non-interactive CLI access.",
]);

const obsidianDaily = ensureVaultDaily(today);
const paraDaily = ensureParaDaily(today);
const dailyMarker = "## [2026-05-22 22:19 Europe/Brussels] memory maintenance";
const dailyBlock = [
  "",
  dailyMarker,
  `- Changed: Cleaned ${cleanedIssueFiles} issue pages in the karpathy vault; removed ${strippedStdoutBlocks} stored stdout excerpt blocks and normalized ${normalizedScaffolds} scaffold-only pages.`,
  "- Evidence: repo hook fix now ignores stdout for issue-touch detection and writes concise daily notes instead of transcript excerpts.",
  "- Railway status: showcase production endpoints are healthy; CLI auth may still be missing locally, but that is no longer blocking an open issue.",
  "- Next: let future agents write concise durable updates; if a page bloats again, inspect the owning run rather than pasting stdout into memory.",
  "",
].join("\n");
appendIfMissing(obsidianDaily, dailyMarker, dailyBlock);
appendIfMissing(paraDaily, dailyMarker, dailyBlock);

const paraMemoryFile = path.join(paraRoot, "MEMORY.md");
appendIfMissing(
  paraMemoryFile,
  "- 2026-05-22: Karpathy issue pages must not store raw stdout excerpts.",
  [
    "",
    "- 2026-05-22: Karpathy issue pages must not store raw stdout excerpts. Durable memory should capture decisions, verification, blockers, and next action only.",
    "- 2026-05-22: Treat Railway/Vercel CLI auth as a task-scoped blocker, not a standing production outage, unless a live dated deploy check proves otherwise.",
    "",
  ].join("\n"),
);

console.log(
  JSON.stringify(
    {
      vaultRoot,
      paraRoot,
      cleanedIssueFiles,
      strippedStdoutBlocks,
      normalizedScaffolds,
      rea1584Updated,
      rea2511Updated,
      obsidianDaily,
      paraDaily,
    },
    null,
    2,
  ),
);
