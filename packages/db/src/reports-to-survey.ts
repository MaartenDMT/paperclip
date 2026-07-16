import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

type AgentReportRow = {
  id: string;
  name: string | null;
  role: string | null;
  parent: string | null;
};

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'agents'
      ORDER BY ordinal_position`;
    console.log("agents columns: " + cols.map((c) => c.column_name).join(", "));

    // Try common spellings
    const candidate = cols.find((c) => /reports.?to/i.test(c.column_name))?.column_name;
    if (!candidate) {
      console.log("\nNo reports_to / reportsTo column found.");
      return;
    }
    console.log(`\nUsing column: ${candidate}`);

    const populated = await sql.unsafe(
      `SELECT count(*)::int AS c FROM agents WHERE "${candidate}" IS NOT NULL`,
    );
    const total = await sql.unsafe(`SELECT count(*)::int AS c FROM agents`);
    console.log(`Populated: ${(populated[0] as any).c}/${(total[0] as any).c}`);

    // Build a parent->children mini-tree
    const rows = Array.from(await sql.unsafe<AgentReportRow[]>(
      `SELECT id, name, role, "${candidate}" AS parent FROM agents`,
    ));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const children = new Map<string | null, AgentReportRow[]>();
    for (const r of rows) {
      const arr = children.get(r.parent) ?? [];
      arr.push(r);
      children.set(r.parent, arr);
    }
    const roots = children.get(null) ?? [];
    console.log(`\nRoot agents (no parent): ${roots.length}`);
    function dump(nodeId: string | null, depth: number) {
      for (const c of children.get(nodeId) ?? []) {
        const ind = "  ".repeat(depth);
        console.log(`${ind}- ${c.name ?? "<no name>"} [role=${c.role ?? "?"}]`);
        dump(c.id, depth + 1);
      }
    }
    dump(null, 0);
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
