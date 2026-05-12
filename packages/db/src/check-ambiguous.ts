import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const a = await sql`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'routines' AND column_name IN ('project_id', 'assignee_agent_id')`;
    console.log("routines columns (expect is_nullable=YES after 0054):");
    console.log(a);

    const b = await sql`
      SELECT column_default
      FROM information_schema.columns
      WHERE table_name = 'companies' AND column_name = 'require_board_approval_for_new_agents'`;
    console.log("companies default (expect 'false' after 0071):");
    console.log(b);
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
