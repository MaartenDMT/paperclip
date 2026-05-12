import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

const NEW_MODEL = "github-copilot/gpt-5-mini";

// Cheap / unreliable models we want to migrate AWAY from.
// Anything starting with one of these prefixes is in scope.
const CHEAP_PREFIXES = [
  "kimi-for-coding/",
  "minimax/",
  "zai-coding-plan/",
  "github-copilot/gemini-3-flash-preview",
  "github-copilot/gemini-3.1-pro-preview", // worst fail rate (63%)
];

function isCheap(model: string | null): boolean {
  if (!model) return false;
  return CHEAP_PREFIXES.some((p) => model.startsWith(p));
}

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    // 1. Snapshot before
    const before = await sql<{ id: string; name: string; model: string | null; status: string }[]>`
      SELECT id, name, adapter_config -> 'model' #>> '{}' AS model, status
      FROM agents WHERE adapter_type = 'opencode_local'`;

    const toMigrate = before.filter((a) => isCheap(a.model));
    if (toMigrate.length === 0) {
      console.log("No agents on cheap models found. Nothing to do.");
      return;
    }

    console.log(`Migrating ${toMigrate.length} agent(s) → ${NEW_MODEL}\n`);
    const byModel = new Map<string, string[]>();
    for (const a of toMigrate) {
      const key = a.model ?? "<null>";
      if (!byModel.has(key)) byModel.set(key, []);
      byModel.get(key)!.push(a.name);
    }
    for (const [m, names] of [...byModel.entries()].sort()) {
      console.log(`  from ${m} (${names.length}): ${names.slice(0, 5).join(", ")}${names.length > 5 ? ", ..." : ""}`);
    }

    // 2. Update — jsonb_set is atomic; preserves all other adapter_config keys
    const ids = toMigrate.map((a) => a.id);
    const updated = await sql`
      UPDATE agents
      SET adapter_config = jsonb_set(adapter_config::jsonb, '{model}', to_jsonb(${NEW_MODEL}::text)),
          status = CASE WHEN status = 'error' THEN 'idle' ELSE status END,
          pause_reason = NULL,
          paused_at = NULL,
          updated_at = now()
      WHERE id = ANY(${ids}::uuid[])
      RETURNING id, name, adapter_config -> 'model' #>> '{}' AS model, status`;

    console.log(`\nUpdated ${updated.length} agent(s). New state:`);
    for (const a of updated) console.log(`  ${a.name}: model=${a.model}, status=${a.status}`);
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
