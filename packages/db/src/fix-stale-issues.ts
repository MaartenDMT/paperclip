/**
 * fix-stale-issues — safe remediation for the two patterns surfaced by
 * analyze-stale-issues.ts:
 *
 *   Tier 1: clear ghost execution_run_id locks (run finished, lock dangling).
 *   Tier 2: flip retry-loop issues (≥5 failed runs in last 3d) to `blocked`
 *           with an auto-comment so the queue stops burning compute and a
 *           human triages.
 *
 * Dry-run by default. Pass --apply to commit.
 */
import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

const APPLY = process.argv.includes("--apply");
const FAIL_THRESHOLD = 5;
const FAIL_WINDOW = "3 days";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    console.log(`mode: ${APPLY ? "APPLY" : "DRY-RUN"} — pass --apply to commit\n`);

    // -------------- Tier 1: ghost execution locks --------------
    const ghostLocks = await sql<Array<{ id: string; title: string; finished_at: Date }>>`
      SELECT i.id, i.title, h.finished_at
        FROM issues i
        JOIN heartbeat_runs h ON h.id = i.execution_run_id
       WHERE i.execution_run_id IS NOT NULL
         AND h.finished_at IS NOT NULL
         AND h.finished_at < now() - interval '30 minutes'`;
    console.log(`=== Tier 1: ghost execution locks (${ghostLocks.length}) ===`);
    for (const row of ghostLocks) {
      console.log(`  ${row.id.slice(0, 8)}  finished ${row.finished_at.toISOString()}  ${row.title.slice(0, 60)}`);
    }
    if (APPLY && ghostLocks.length > 0) {
      const ids = ghostLocks.map((r) => r.id);
      const res = await sql`
        UPDATE issues SET execution_run_id = NULL, updated_at = now()
         WHERE id = ANY(${ids as unknown as string[]})`;
      console.log(`  -> cleared ${res.count} execution_run_id pointers`);
    }

    // -------------- Tier 2: retry-loop issues --------------
    const loops = await sql<Array<{ id: string; title: string; status: string; fails: number; company_id: string }>>`
      WITH fails AS (
        SELECT (h.context_snapshot->>'issueId')::uuid AS issue_id, count(*)::int AS c
          FROM heartbeat_runs h
         WHERE h.created_at > now() - interval '3 days'
           AND h.status IN ('failed','timed_out')
           AND h.context_snapshot ? 'issueId'
         GROUP BY 1
      )
      SELECT i.id, i.title, i.status, f.c AS fails, i.company_id
        FROM fails f
        JOIN issues i ON i.id = f.issue_id
       WHERE f.c >= ${FAIL_THRESHOLD}
         AND i.status NOT IN ('blocked','done','cancelled')
       ORDER BY f.c DESC`;
    console.log(`\n=== Tier 2: retry-loop issues (${loops.length}) ===`);
    for (const row of loops) {
      console.log(`  ${row.fails.toString().padStart(3)} fails  ${row.id.slice(0, 8)}  [${row.status}] ${row.title.slice(0, 60)}`);
    }
    if (APPLY && loops.length > 0) {
      const commentBody =
        "Auto-flagged by fix-stale-issues: this issue has accumulated " +
        `${FAIL_THRESHOLD}+ failed heartbeat runs in the last ${FAIL_WINDOW}. ` +
        "Moving to `blocked` to stop the retry storm. Likely root cause: " +
        "opencode_local adapter silent crash. Human triage required before " +
        "resuming.";
      for (const row of loops) {
        await sql`
          INSERT INTO issue_comments (id, issue_id, company_id, author_type, body, created_at, updated_at)
          VALUES (gen_random_uuid(), ${row.id}, ${row.company_id}, 'system', ${commentBody}, now(), now())`;
        await sql`
          UPDATE issues
             SET status = 'blocked',
                 execution_run_id = NULL,
                 checkout_run_id = NULL,
                 updated_at = now()
           WHERE id = ${row.id}`;
        console.log(`  -> ${row.id.slice(0, 8)} flipped to blocked + comment posted`);
      }
    }

    console.log(`\n${APPLY ? "✅ APPLIED" : "ℹ DRY-RUN — re-run with --apply to commit"}`);
  } finally {
    await sql.end();
    await r.stop();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
