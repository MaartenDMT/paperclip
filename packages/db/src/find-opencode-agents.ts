import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const rows = await sql<{
      id: string; name: string | null; role: string | null; status: string;
      adapter_type: string | null; adapter_config: unknown;
    }[]>`
      SELECT id, name, role, status, adapter_type, adapter_config
      FROM agents
      WHERE adapter_type ILIKE '%opencode%'
         OR adapter_config::text ILIKE '%opencode%'
      ORDER BY status, name`;
    if (rows.length === 0) {
      console.log("No agents reference opencode in adapter_type or adapter_config.");
      return;
    }
    console.log(`Found ${rows.length} agent(s) referencing opencode:`);
    for (const a of rows) {
      console.log(`  [${a.status.padEnd(10)}] adapter=${(a.adapter_type ?? "?").padEnd(20)} name=${a.name ?? "?"}  id=${a.id}`);
    }
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
