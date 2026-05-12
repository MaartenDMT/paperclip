import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";
async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const pausedAt = await sql<{ min: Date | null; max: Date | null }[]>`
      SELECT min(paused_at) AS min, max(paused_at) AS max FROM agents
      WHERE pause_reason = 'opencode-cli-broken-2026-05-11'`;
    console.log("pause window: " + pausedAt[0]?.min?.toISOString() + " .. " + pausedAt[0]?.max?.toISOString());
    const after = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM heartbeat_runs hr
      JOIN agents a ON a.id = hr.agent_id
      WHERE a.adapter_type='opencode_local'
        AND hr.created_at > (SELECT max(paused_at) FROM agents WHERE pause_reason='opencode-cli-broken-2026-05-11')`;
    console.log("opencode heartbeat_runs after pause: " + after[0]?.c);
    const recent = await sql<{ status: string; c: number }[]>`
      SELECT status, count(*)::int AS c FROM heartbeat_runs
      WHERE created_at > now() - interval '5 minutes'
      GROUP BY status ORDER BY c DESC`;
    console.log("\nAll runs last 5min (any adapter):");
    for (const r of recent) console.log("  " + r.status.padEnd(12) + r.c);
  } finally { await sql.end(); await r.stop(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
