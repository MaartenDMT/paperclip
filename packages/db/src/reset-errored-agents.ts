import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const before = await sql<{ k: string; c: number }[]>`
      SELECT status AS k, count(*)::int AS c FROM agents GROUP BY status ORDER BY c DESC`;
    console.log("Before:");
    for (const row of before) console.log("  " + row.k + ": " + row.c);

    const updated = await sql<{ id: string; name: string | null }[]>`
      UPDATE agents
      SET status = 'idle', updated_at = now()
      WHERE status = 'error'
      RETURNING id, name`;
    console.log("\nReset " + updated.length + " errored agent(s) to idle:");
    for (const row of updated) console.log("  - " + row.id + " (" + (row.name ?? "<no name>") + ")");

    const after = await sql<{ k: string; c: number }[]>`
      SELECT status AS k, count(*)::int AS c FROM agents GROUP BY status ORDER BY c DESC`;
    console.log("\nAfter:");
    for (const row of after) console.log("  " + row.k + ": " + row.c);
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
