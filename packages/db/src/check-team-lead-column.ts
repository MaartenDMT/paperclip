import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='agent_wakeup_requests' AND column_name='team_lead_id'`;
    console.log("team_lead_id column: " + (cols.length === 1 ? "EXISTS" : "MISSING"));

    const tracker = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM "drizzle"."__drizzle_migrations"`;
    console.log("tracker rows: " + tracker[0].c);

    const idx = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename='agent_wakeup_requests' AND indexname='agent_wakeup_requests_team_lead_status_idx'`;
    console.log("index exists: " + (idx.length === 1 ? "YES" : "NO"));
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
