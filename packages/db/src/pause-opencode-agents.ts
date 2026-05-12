import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

// Pauses every idle/error agent currently configured with adapter_type =
// opencode_local. The upstream `opencode` CLI is broken on this Windows host
// (244 adapter_failed events in last 24h) — keeping the agents active just
// generates noise and stuck work.
//
// REVERSAL: UPDATE agents SET status = 'idle' WHERE pause_reason = 'opencode-cli-broken-2026-05-11';
async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const before = await sql<{ status: string; c: number }[]>`
      SELECT status, count(*)::int AS c FROM agents
      WHERE adapter_type = 'opencode_local'
      GROUP BY status ORDER BY c DESC`;
    console.log("opencode_local agents BEFORE:");
    for (const r of before) console.log("  " + r.status.padEnd(12) + r.c);

    const updated = await sql<{ id: string; name: string | null }[]>`
      UPDATE agents
      SET status = 'paused',
          pause_reason = 'opencode-cli-broken-2026-05-11',
          paused_at = now(),
          updated_at = now()
      WHERE adapter_type = 'opencode_local'
        AND status IN ('idle','error','running')
      RETURNING id, name`;
    console.log("\nPaused " + updated.length + " opencode_local agent(s):");
    for (const r of updated) console.log("  - " + (r.name ?? "<no name>") + " (" + r.id + ")");

    const after = await sql<{ status: string; c: number }[]>`
      SELECT status, count(*)::int AS c FROM agents
      WHERE adapter_type = 'opencode_local'
      GROUP BY status ORDER BY c DESC`;
    console.log("\nopencode_local agents AFTER:");
    for (const r of after) console.log("  " + r.status.padEnd(12) + r.c);
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
