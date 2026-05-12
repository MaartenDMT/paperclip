/**
 * Diagnose stale & stuck issues. Read-only: counts patterns, names root
 * causes. Run a separate script to actually mutate state once you've
 * reviewed this report.
 */
import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    console.log("=== Issues by status ===");
    const byStatus = await sql<Array<{ status: string; c: number }>>`
      SELECT status, count(*)::int AS c FROM issues GROUP BY status ORDER BY c DESC`;
    for (const r of byStatus) console.log(`  ${r.status.padEnd(16)} ${r.c}`);

    console.log("\n=== Stuck in_progress (no update >1h) ===");
    const stuckInProgress = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM issues
       WHERE status = 'in_progress'
         AND updated_at < now() - interval '1 hour'`;
    console.log(`  count: ${stuckInProgress[0].c}`);

    console.log("\n=== Issues with execution/checkout lock pointing at finished run ===");
    const ghostLocks = await sql<{ c: number; sample_id: string | null }[]>`
      SELECT count(*)::int AS c, max(i.id::text) AS sample_id
        FROM issues i
        JOIN heartbeat_runs h ON h.id = i.execution_run_id
       WHERE i.execution_run_id IS NOT NULL
         AND h.finished_at IS NOT NULL`;
    console.log(`  ghost execution locks: ${ghostLocks[0].c} (sample issue ${ghostLocks[0].sample_id})`);

    const ghostCheckout = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c
        FROM issues i
        JOIN heartbeat_runs h ON h.id = i.checkout_run_id
       WHERE i.checkout_run_id IS NOT NULL
         AND h.finished_at IS NOT NULL
         AND i.status NOT IN ('done','cancelled')`;
    console.log(`  ghost checkout locks: ${ghostCheckout[0].c}`);

    console.log("\n=== Top agents with the most stuck in_progress issues ===");
    const stuckByAgent = await sql<Array<{ name: string; c: number }>>`
      SELECT a.name, count(*)::int AS c
        FROM issues i
        JOIN agents a ON a.id = i.assignee_agent_id
       WHERE i.status = 'in_progress'
         AND i.updated_at < now() - interval '1 hour'
       GROUP BY a.name ORDER BY c DESC LIMIT 8`;
    for (const r of stuckByAgent) console.log(`  ${r.c.toString().padStart(4)}  ${r.name}`);

    console.log("\n=== Issues with >5 consecutive failed runs (run loops) ===");
    const failureLoop = await sql<Array<{ id: string; title: string; fails: number }>>`
      WITH fails AS (
        SELECT h.context_snapshot->>'issueId' AS issue_id, count(*)::int AS c
          FROM heartbeat_runs h
         WHERE h.created_at > now() - interval '3 days'
           AND h.status IN ('failed','timed_out')
           AND h.context_snapshot ? 'issueId'
         GROUP BY 1
      )
      SELECT i.id, i.title, f.c AS fails
        FROM fails f
        JOIN issues i ON i.id = (f.issue_id)::uuid
       WHERE f.c >= 5
       ORDER BY f.c DESC
       LIMIT 10`;
    if (failureLoop.length === 0) console.log("  (none)");
    for (const r of failureLoop) console.log(`  ${r.fails.toString().padStart(3)} fails  ${r.id.slice(0,8)}  ${r.title.slice(0, 60)}`);

    console.log("\n=== Issues stale >7 days in active statuses ===");
    const longStale = await sql<Array<{ status: string; c: number }>>`
      SELECT status, count(*)::int AS c FROM issues
       WHERE status IN ('todo','in_progress','in_review','blocked')
         AND updated_at < now() - interval '7 days'
       GROUP BY status ORDER BY c DESC`;
    for (const r of longStale) console.log(`  ${r.status.padEnd(16)} ${r.c}`);

    console.log("\n=== Auto-fix opportunities ===");
    const safe = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c
        FROM issues i
        JOIN heartbeat_runs h ON h.id = i.execution_run_id
       WHERE i.execution_run_id IS NOT NULL
         AND h.finished_at IS NOT NULL
         AND h.finished_at < now() - interval '30 minutes'`;
    console.log(`  clearable ghost execution locks (run finished >30m ago): ${safe[0].c}`);
    const safeCheckout = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c
        FROM issues i
        JOIN heartbeat_runs h ON h.id = i.checkout_run_id
       WHERE i.checkout_run_id IS NOT NULL
         AND h.finished_at IS NOT NULL
         AND h.finished_at < now() - interval '30 minutes'
         AND i.status NOT IN ('done','cancelled')`;
    console.log(`  clearable ghost checkout locks (run finished >30m ago): ${safeCheckout[0].c}`);
  } finally {
    await sql.end();
    await r.stop();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
