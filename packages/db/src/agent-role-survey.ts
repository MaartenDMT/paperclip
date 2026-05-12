import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const rows = await sql<{ role: string | null; name: string | null; status: string; c: number }[]>`
      SELECT role, name, status, count(*)::int AS c
      FROM agents
      GROUP BY role, name, status
      ORDER BY role NULLS LAST, name`;
    console.log("Distinct (role, name) tuples (per status):");
    for (const r of rows) {
      console.log(`  [${r.status.padEnd(10)}] role=${(r.role ?? "<null>").padEnd(28)} name=${r.name ?? "<no name>"}`);
    }

    const roles = await sql<{ role: string | null; c: number }[]>`
      SELECT role, count(*)::int AS c FROM agents GROUP BY role ORDER BY c DESC`;
    console.log("\nRole frequency:");
    for (const r of roles) console.log(`  ${(r.role ?? "<null>").padEnd(30)} ${r.c}`);
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
