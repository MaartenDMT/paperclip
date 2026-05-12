import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const rows = await sql<{
      id: string; agent_id: string; agent_name: string | null; adapter_type: string | null;
      status: string; error_code: string | null; created_at: Date; finished_at: Date | null;
      error_message: string | null;
    }[]>`
      SELECT
        hr.id,
        hr.agent_id,
        a.name AS agent_name,
        a.adapter_type,
        hr.status,
        hr.error_code,
        hr.created_at,
        hr.finished_at,
        substring((hr.result_json::jsonb ->> 'errorMessage') from 1 for 200) AS error_message
      FROM heartbeat_runs hr
      LEFT JOIN agents a ON a.id = hr.agent_id
      WHERE hr.status IN ('failed','timed_out','cancelled')
      ORDER BY hr.created_at DESC
      LIMIT 15`;
    console.log("Recent failures:");
    for (const r of rows) {
      const dur = r.finished_at ? Math.round((r.finished_at.getTime() - r.created_at.getTime()) / 1000) : "-";
      console.log(`\n[${r.status.padEnd(10)}] ${r.created_at.toISOString()} (${dur}s)`);
      console.log(`  agent: ${r.agent_name ?? "?"} (${r.adapter_type ?? "?"})`);
      console.log(`  errorCode: ${r.error_code ?? "-"}`);
      if (r.error_message) console.log(`  msg: ${r.error_message}`);
    }

    // Aggregate by error_code over last 24h
    const agg = await sql<{ error_code: string | null; adapter_type: string | null; c: number }[]>`
      SELECT hr.error_code, a.adapter_type, count(*)::int AS c
      FROM heartbeat_runs hr
      LEFT JOIN agents a ON a.id = hr.agent_id
      WHERE hr.status IN ('failed','timed_out','cancelled')
        AND hr.created_at > now() - interval '24 hours'
      GROUP BY hr.error_code, a.adapter_type
      ORDER BY c DESC`;
    console.log("\n\nFailures last 24h by (error_code, adapter_type):");
    for (const row of agg) {
      console.log(`  ${(row.error_code ?? "<null>").padEnd(35)} ${(row.adapter_type ?? "?").padEnd(20)} ${row.c}`);
    }
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
