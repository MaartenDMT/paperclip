/**
 * Pull a sample of blocked issues sorted by priority + recency, with their
 * last 3 comments, so we can decide which are auto-fixable.
 */
import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

const LIMIT = Number(process.argv[2] ?? 20);

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const issues = await sql<Array<{
      id: string; title: string; priority: string; updated_at: Date; created_at: Date;
    }>>`
      SELECT id, title, priority, updated_at, created_at
        FROM issues
       WHERE status = 'blocked'
       ORDER BY CASE priority
                  WHEN 'critical' THEN 0
                  WHEN 'high' THEN 1
                  WHEN 'medium' THEN 2
                  WHEN 'low' THEN 3
                  ELSE 4
                END,
                updated_at DESC
       LIMIT ${LIMIT}`;

    for (const issue of issues) {
      const ageDays = Math.floor((Date.now() - issue.updated_at.getTime()) / 86400000);
      console.log(`\n=== [${issue.priority}] ${issue.id.slice(0,8)}  (${ageDays}d stale)  ${issue.title.slice(0,80)}`);
      const comments = await sql<Array<{ body: string; author_type: string; created_at: Date }>>`
        SELECT body, author_type, created_at
          FROM issue_comments
         WHERE issue_id = ${issue.id}
         ORDER BY created_at DESC LIMIT 3`;
      for (const c of comments.reverse()) {
        const stamp = c.created_at.toISOString().slice(0, 16).replace("T", " ");
        const body = c.body.replace(/\s+/g, " ").slice(0, 200);
        console.log(`  [${stamp}] (${c.author_type}) ${body}`);
      }
      if (comments.length === 0) console.log("  (no comments)");
    }
    console.log(`\n--- ${issues.length} blocked issues inspected ---`);
  } finally {
    await sql.end();
    await r.stop();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
