import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";
async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const stuck = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM agents WHERE adapter_type='opencode_local' AND adapter_config -> 'model' #>> '{}' = 'github-copilot/gpt-5-mini'`;
    const total = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM agents WHERE adapter_type='opencode_local'`;
    const errored = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM agents WHERE adapter_type='opencode_local' AND status='error'`;
    console.log("opencode_local agents:", total[0].c);
    console.log("  stuck on github-copilot/gpt-5-mini primary:", stuck[0].c);
    console.log("  in error status:", errored[0].c);
  } finally { await sql.end(); await r.stop(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
