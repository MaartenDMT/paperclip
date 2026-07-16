/**
 * Inject a KARPATHY_WORKFLOW.md instruction file into every agent that has
 * the karpathy-obsidian-memory skill attached. This is NOT a skill edit —
 * it drops a fresh markdown file into each agent's managed instructions
 * bundle (`<instance>/companies/<companyId>/agents/<agentId>/instructions/`),
 * which the runtime auto-loads into the agent's prompt context every wake.
 *
 * The file makes the durable-memory contract explicit so agents follow it
 * end-to-end (read SCHEMA -> update touched issue pages -> log entry).
 *
 * Idempotent: rewrites the file each pass with current content.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

const INSTANCE_ROOT =
  process.env.PAPERCLIP_INSTANCE_ROOT ||
  path.join(os.homedir(), ".paperclip", "instances", "default");

const WORKFLOW_FILENAME = "KARPATHY_WORKFLOW.md";

const WORKFLOW_BODY = `# Karpathy Obsidian Memory — Per-Run Contract

This file is injected by Paperclip ops. Follow it on every wake unless an
explicit instruction overrides it.

## Each run you MUST

1. Read \`<vault>/SCHEMA.md\` if you have not in this session.
2. For every Paperclip issue you touched (status change, comment, gate, blocker):
   - Open or create \`<vault>/issues/<REA-####>.md\` with the documented
     YAML frontmatter (\`title/created/updated/type=issue/tags/status/sources\`).
   - Add durable facts (IDs, links, decisions) and \`[[wikilinks]]\` to related
     pages. Bump \`updated:\` to today.
3. If you took an operating decision, add \`<vault>/decisions/<date>-<slug>.md\`.
4. Append ONE entry to \`<vault>/log.md\` in this format:
   \`\`\`
   ## [YYYY-MM-DD HH:mm Europe/Brussels] <action> | <subject>
   - Changed: concise fact.
   - Evidence: Paperclip issue/run/log/repo path.
   - Next: owner and concrete next action.
   \`\`\`

## Compliance

A post-run hook (\`vault-postrun-hook\`) parses your run output for
\`REA-####\` mentions and verifies the matching \`issues/REA-####.md\` was
written or updated during this run. Missed writes are logged as
\`noncompliant\` entries against your agent slug. Avoid that — it is visible.

## Boundaries (unchanged)

- Paperclip API state is authoritative; memory records durable context.
- Never store secrets, tokens, passwords, cookies, or raw confidential payloads.
- Keep ReadersBase production isolated from universal-clipper tooling.
`;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  let written = 0;
  let skipped = 0;
  try {
    // Find every (company, agent) that has the karpathy-obsidian-memory skill.
    const agents = await sql<Array<{ id: string; company_id: string; name: string }>>`
      SELECT DISTINCT a.id, a.company_id, a.name
        FROM agents a
        JOIN company_skills cs ON cs.company_id = a.company_id
       WHERE cs.key LIKE '%/karpathy-obsidian-memory'
          OR cs.key = 'karpathy-obsidian-memory'`;

    for (const agent of agents) {
      const dir = path.join(
        INSTANCE_ROOT,
        "companies",
        agent.company_id,
        "agents",
        agent.id,
        "instructions",
      );
      try {
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, WORKFLOW_FILENAME);
        fs.writeFileSync(file, WORKFLOW_BODY);
        written++;
        console.log(`  + ${slugify(agent.name)} -> ${file}`);
      } catch (e) {
        skipped++;
        console.warn(`  ! skipped ${agent.name}: ${(e as Error).message}`);
      }
    }
  } finally {
    await sql.end();
    await r.stop();
  }
  console.log(`\nDone. wrote=${written} skipped=${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
