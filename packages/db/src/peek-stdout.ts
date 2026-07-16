import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    // CTO had visible stdout earlier — grab its most recent run with stdout
    const rows = await sql<{ name: string; rj: string }[]>`
      SELECT a.name, substring(hr.result_json::text from 1 for 2000) AS rj
      FROM heartbeat_runs hr JOIN agents a ON a.id = hr.agent_id
      WHERE a.adapter_type = 'opencode_local'
        AND hr.result_json::text LIKE '%stdout%'
        AND length(hr.result_json::text) > 500
      ORDER BY hr.created_at DESC LIMIT 3`;
    for (const r of rows) {
      console.log(`\n=== ${r.name} ===`);
      console.log(r.rj.slice(0, 2000));
    }
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
