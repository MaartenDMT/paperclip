import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const candidates = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM agents
      WHERE adapter_type = 'opencode_local'
        AND adapter_config -> 'model' #>> '{}' = 'github-copilot/gpt-5-mini'
      ORDER BY name`;
    console.log(`Recovering ${candidates.length} agents via agent_config_revisions...\n`);

    let applied = 0, missing = 0;
    for (const a of candidates) {
      // Find the most recent revision where after_config has a model that ISN'T gpt-5-mini
      const rev = await sql<{ model: string | null; created_at: Date | null }[]>`
        SELECT after_config -> 'adapterConfig' -> 'model' #>> '{}' AS model,
               created_at
        FROM agent_config_revisions
        WHERE agent_id = ${a.id}
          AND after_config -> 'adapterConfig' -> 'model' #>> '{}' IS NOT NULL
          AND after_config -> 'adapterConfig' -> 'model' #>> '{}' != 'github-copilot/gpt-5-mini'
        ORDER BY created_at DESC LIMIT 1`;
      const model = rev[0]?.model;
      if (!model) { console.log(`  MISS ${a.name}`); missing++; continue; }
      await sql`
        UPDATE agents
        SET adapter_config = jsonb_set(adapter_config::jsonb, '{model}', to_jsonb(${model}::text)),
            updated_at = now()
        WHERE id = ${a.id}`;
      console.log(`  OK   ${a.name.padEnd(40)} -> ${model}`);
      applied++;
    }
    console.log(`\nApplied ${applied} reverts. Missing: ${missing}.`);
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
