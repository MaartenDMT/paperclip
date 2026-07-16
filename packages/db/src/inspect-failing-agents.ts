import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    // Find the missing 2 via fuzzy search
    const missing = await sql<{ id: string; name: string; role: string | null; adapter_type: string; status: string }[]>`
      SELECT id, name, role, adapter_type, status FROM agents
      WHERE name ILIKE '%graphic%' OR name ILIKE '%novel%'
         OR name ILIKE '%engineering%steward%' OR name ILIKE '%operations%steward%'
         OR role ILIKE '%graphic%novel%' OR role ILIKE '%engineering%operations%'`;
    console.log("FUZZY MATCH for missing agents:");
    for (const a of missing) console.log(` - ${a.name} | role=${a.role ?? "-"} | adapter=${a.adapter_type} | status=${a.status} | ${a.id}`);
    console.log();

    // Full result_json for the 5 known + missing for last failed run
    const ids = ["1987be7a-f820-4b45-b037-575e90ef72cc","5d5a8a73-42e0-4a55-a843-1af31e8c49ae","4e32782a-17a4-4944-a15c-8eb72133b90d","44d742e5-f1d2-4074-b06b-c945aa149ba3","bdd5d269-0d0a-4dc0-a5fe-d4665f3863ff", ...missing.map(m => m.id)];
    for (const id of ids) {
      const row = await sql<{ name: string; status: string; error_code: string | null; result: unknown }[]>`
        SELECT a.name, hr.status, hr.error_code, hr.result_json AS result
        FROM heartbeat_runs hr JOIN agents a ON a.id = hr.agent_id
        WHERE hr.agent_id = ${id} AND hr.status = 'failed'
        ORDER BY hr.created_at DESC LIMIT 1`;
      if (!row.length) continue;
      const r0 = row[0];
      const result = typeof r0.result === "string" ? r0.result : JSON.stringify(r0.result);
      console.log(`[${r0.name}] code=${r0.error_code}`);
      console.log(`  result_json (first 600 chars): ${result.slice(0, 600).replace(/\\n/g, " | ")}`);
      console.log();
    }
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
