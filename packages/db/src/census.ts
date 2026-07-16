import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema()
      ORDER BY table_name`;
    const names = new Set(tables.map((t) => t.table_name));
    console.log("Tables present: " + names.size);

    async function count(table: string, where = "") {
      if (!names.has(table)) return null;
      try {
        const rows = await sql.unsafe(`SELECT count(*)::int AS c FROM "${table}" ${where}`);
        return (rows[0] as unknown as { c: number }).c;
      } catch (e) {
        return `ERR ${(e as Error).message.slice(0, 60)}`;
      }
    }

    async function group(table: string, col: string) {
      if (!names.has(table)) return null;
      try {
        const rows = await sql.unsafe(
          `SELECT "${col}" AS k, count(*)::int AS c FROM "${table}" GROUP BY "${col}" ORDER BY c DESC LIMIT 20`,
        );
        return rows;
      } catch (e) {
        return `ERR ${(e as Error).message.slice(0, 60)}`;
      }
    }

    const reports = [
      ["companies", await count("companies")],
      ["departments", await count("departments")],
      ["agents (total)", await count("agents")],
      ["agents by status", await group("agents", "status")],
      ["agents by archived", await group("agents", "archived")],
      ["agent_runtime_state", await count("agent_runtime_state")],
      ["agent_runtime_state by status", await group("agent_runtime_state", "status")],
      ["runs (total)", await count("runs")],
      ["runs by status", await group("runs", "status")],
      ["routines", await count("routines")],
      ["routine_runs (total)", await count("routine_runs")],
      ["routine_runs by status", await group("routine_runs", "status")],
      ["issues (total)", await count("issues")],
      ["issues by status", await group("issues", "status")],
      ["plugins installed", await count("plugins")],
      ["environments", await count("environments")],
    ];

    for (const [label, value] of reports) {
      console.log(label + ":");
      console.log("  " + JSON.stringify(value, null, 2).replace(/\n/g, "\n  "));
    }
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
