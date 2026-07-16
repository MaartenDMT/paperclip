/**
 * fix-stale-blockers — Tier 3.
 *
 * Drops `blocks` relations whose blocker is itself terminated (cancelled/done).
 * Then for every previously-blocked issue, if no active blockers remain, flips
 * status `blocked` → `todo` with an auto-comment.
 *
 * Convention (confirmed against heartbeat.ts ~L1640): `issue_id` is BLOCKER,
 * `related_issue_id` is BLOCKED.
 *
 * Dry-run by default. Pass --apply to commit.
 */
import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    console.log(`mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

    // 1. Stale relations: blocker is terminated.
    const stale = await sql<Array<{
      relation_id: string;
      blocker_id: string;
      blocker_title: string;
      blocker_status: string;
      blocked_id: string;
      blocked_title: string;
      blocked_status: string;
      blocked_company: string;
    }>>`
      SELECT r.id AS relation_id,
             b.id AS blocker_id, b.title AS blocker_title, b.status AS blocker_status,
             d.id AS blocked_id, d.title AS blocked_title, d.status AS blocked_status,
             d.company_id AS blocked_company
        FROM issue_relations r
        JOIN issues b ON b.id = r.issue_id
        JOIN issues d ON d.id = r.related_issue_id
       WHERE r.type = 'blocks'
         AND b.status IN ('cancelled','done')
       ORDER BY d.status, d.priority`;
    console.log(`=== Stale blocker relations (${stale.length}) ===`);
    for (const row of stale.slice(0, 20)) {
      console.log(`  blocker ${row.blocker_id.slice(0,8)} [${row.blocker_status}] -> blocked ${row.blocked_id.slice(0,8)} [${row.blocked_status}]`);
    }
    if (stale.length > 20) console.log(`  ... +${stale.length - 20} more`);

    // 2. Find blocked issues that would be unblockable.
    const blockedIds = [...new Set(stale.filter(s => s.blocked_status === 'blocked').map(s => s.blocked_id))];
    const unblockable: Array<{ id: string; title: string; company_id: string; remaining: number }> = [];
    for (const id of blockedIds) {
      const remaining = await sql<{ c: number }[]>`
        SELECT count(*)::int AS c
          FROM issue_relations r
          JOIN issues b ON b.id = r.issue_id
         WHERE r.type = 'blocks'
           AND r.related_issue_id = ${id}
           AND b.status NOT IN ('cancelled','done')`;
      const issue = stale.find(s => s.blocked_id === id)!;
      unblockable.push({
        id,
        title: issue.blocked_title,
        company_id: issue.blocked_company,
        remaining: remaining[0].c,
      });
    }
    const trulyUnblockable = unblockable.filter(u => u.remaining === 0);
    console.log(`\n=== Issues unblockable after relation cleanup (${trulyUnblockable.length}) ===`);
    for (const u of trulyUnblockable) {
      console.log(`  ${u.id.slice(0,8)}  ${u.title.slice(0, 70)}`);
    }
    const stillBlocked = unblockable.filter(u => u.remaining > 0);
    if (stillBlocked.length > 0) {
      console.log(`\n  (${stillBlocked.length} blocked issues still have live blockers after cleanup — left at 'blocked')`);
    }

    if (APPLY) {
      // Drop stale relations.
      const ids = stale.map(s => s.relation_id);
      if (ids.length > 0) {
        const res = await sql`DELETE FROM issue_relations WHERE id = ANY(${ids as unknown as string[]})`;
        console.log(`\n  -> deleted ${res.count} stale relations`);
      }
      // Unblock and post comment.
      for (const u of trulyUnblockable) {
        const body =
          "Auto-unblocked by fix-stale-blockers: all `blocks` relations on " +
          "this issue pointed at blocker issues that are themselves " +
          "`cancelled` or `done`. Stale relations dropped; this issue is " +
          "moved back to `todo` for the queue to re-pick.";
        await sql`
          INSERT INTO issue_comments (id, issue_id, company_id, author_type, body, created_at, updated_at)
          VALUES (gen_random_uuid(), ${u.id}, ${u.company_id}, 'system', ${body}, now(), now())`;
        await sql`
          UPDATE issues SET status = 'todo', updated_at = now() WHERE id = ${u.id}`;
        console.log(`  -> ${u.id.slice(0,8)} unblocked + comment posted`);
      }
      console.log("\n✅ APPLIED");
    } else {
      console.log("\nℹ DRY-RUN — re-run with --apply to commit");
    }
  } finally {
    await sql.end();
    await r.stop();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
