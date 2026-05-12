import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const rows = await sql<{ status: string; c: number }[]>`
      SELECT status, count(*)::int AS c FROM agents
      WHERE adapter_type = 'opencode_local'
      GROUP BY status ORDER BY c DESC`;
    console.log("opencode_local by status:");
    for (const r of rows) console.log("  " + r.status.padEnd(12) + r.c);

    const paused = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM agents
      WHERE pause_reason = 'opencode-cli-broken-2026-05-11'`;
    console.log("\nWith opencode-cli-broken pause_reason: " + paused[0]?.c);

    const recent = await sql<{ agent_name: string | null; status: string; created_at: Date }[]>`
      SELECT a.name AS agent_name, hr.status, hr.created_at
      FROM heartbeat_runs hr
      LEFT JOIN agents a ON a.id = hr.agent_id
      WHERE a.adapter_type = 'opencode_local'
        AND hr.created_at > now() - interval '15 minutes'
      ORDER BY hr.created_at DESC LIMIT 10`;
    console.log("\nLast 15min opencode runs (" + recent.length + "):");
    for (const r of recent) console.log("  " + r.created_at.toISOString() + "  " + r.status.padEnd(10) + "  " + (r.agent_name ?? "?"));
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
