import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

const TARGET_KEYS = ["karpathy-obsidian-memory", "caveman"];

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    console.log("=== company_skills installation ===");
    const skills = await sql<
      Array<{ company_id: string; key: string; name: string; created_at: Date }>
    >`SELECT company_id, key, name, created_at
        FROM company_skills
        WHERE key = ANY(${TARGET_KEYS as unknown as string[]})
        ORDER BY key, created_at`;
    if (skills.length === 0) {
      console.log("  (none installed)");
    } else {
      for (const s of skills) {
        console.log(`  ${s.key.padEnd(28)} company=${s.company_id} name="${s.name}"`);
      }
    }

    console.log("\n=== heartbeat_runs mentioning these skills (last 30d) ===");
    for (const key of TARGET_KEYS) {
      const hits = await sql<{ c: number }[]>`
        SELECT count(*)::int AS c
          FROM heartbeat_runs
         WHERE created_at > now() - interval '30 days'
           AND (result_json::text ILIKE ${"%" + key + "%"}
                OR stdout_excerpt ILIKE ${"%" + key + "%"}
                OR next_action ILIKE ${"%" + key + "%"})`;
      console.log(`  ${key.padEnd(28)} ${hits[0].c} run(s)`);
    }

    console.log("\n=== Obsidian-vault evidence (karpathy skill writes .md to vault) ===");
    const obs = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c
        FROM heartbeat_runs
       WHERE created_at > now() - interval '30 days'
         AND (result_json::text ILIKE '%vault%'
              OR result_json::text ILIKE '%obsidian%'
              OR result_json::text ILIKE '%.md%')`;
    console.log(`  vault/obsidian/.md mentions: ${obs[0].c} run(s)`);

    console.log("\n=== Caveman-style terse output proxy (very short result text) ===");
    // Cheap heuristic: result_json text < 400 chars AND status='success'
    const cave = await sql<{ c: number; total: number }[]>`
      SELECT
        sum(CASE WHEN length(result_json::text) < 400 THEN 1 ELSE 0 END)::int AS c,
        count(*)::int AS total
      FROM heartbeat_runs
       WHERE created_at > now() - interval '30 days'
         AND status = 'success'`;
    console.log(`  short result_json (<400 chars): ${cave[0].c}/${cave[0].total} successful runs`);

    console.log("\n=== Top 5 agents producing short outputs (cavemen-likely) ===");
    const topShort = await sql<Array<{ id: string; name: string; c: number }>>`
      SELECT a.id, a.name, count(*)::int AS c
        FROM heartbeat_runs h
        JOIN agents a ON a.id = h.agent_id
       WHERE h.created_at > now() - interval '30 days'
         AND h.status = 'success'
         AND length(h.result_json::text) < 400
       GROUP BY a.id, a.name
       ORDER BY c DESC
       LIMIT 5`;
    for (const t of topShort) console.log(`  ${t.c.toString().padStart(4)}  ${t.name}`);
  } finally {
    await sql.end();
    await r.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
