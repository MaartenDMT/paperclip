import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

/**
 * Recover the original adapter_config.model values for the 27 agents we
 * overwrote earlier today. Strategy:
 *
 *   Pull each affected agent's last heartbeat run that has stdout output.
 *   OpenCode emits NDJSON events tagged with `modelID` and `providerID` for
 *   each message; parse those out and use them as the original primary model.
 *
 * We only update agents where:
 *   - adapter_type = 'opencode_local'
 *   - current model is exactly 'github-copilot/gpt-5-mini' (= one of the 27)
 *   - we found a model in a heartbeat run from BEFORE the migration cutoff
 */

const CUTOFF = "2026-05-11T18:50:00Z"; // ran my UPDATE around 18:55 UTC; use older runs only

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const candidates = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM agents
      WHERE adapter_type = 'opencode_local'
        AND adapter_config -> 'model' #>> '{}' = 'github-copilot/gpt-5-mini'`;
    console.log(`Scanning ${candidates.length} agents for original model in past heartbeat runs...\n`);

    type Recovered = { id: string; name: string; model: string | null };
    const recovered: Recovered[] = [];

    for (const a of candidates) {
      const runs = await sql<{ stdout: string | null }[]>`
        SELECT substring((result_json::jsonb ->> 'stdout') from 1 for 8000) AS stdout
        FROM heartbeat_runs
        WHERE agent_id = ${a.id}
          AND created_at < ${CUTOFF}
          AND result_json::text LIKE '%modelID%'
        ORDER BY created_at DESC LIMIT 1`;
      let model: string | null = null;
      for (const run of runs) {
        if (!run.stdout) continue;
        // OpenCode JSON events use "providerID":"X","modelID":"Y" — combine to provider/model
        const m = run.stdout.match(/"providerID"\s*:\s*"([^"]+)"\s*,\s*"modelID"\s*:\s*"([^"]+)"/);
        if (m) { model = `${m[1]}/${m[2]}`; break; }
      }
      recovered.push({ id: a.id, name: a.name, model });
    }

    const found = recovered.filter((r) => r.model);
    const missing = recovered.filter((r) => !r.model);
    console.log(`Recovered ${found.length}/${candidates.length} originals\n`);

    for (const r of found.sort((a, b) => (a.model ?? "").localeCompare(b.model ?? ""))) {
      console.log(`  ${r.name.padEnd(40)} -> ${r.model}`);
    }
    if (missing.length) {
      console.log(`\nCould NOT recover (${missing.length}) — will leave as github-copilot/gpt-5-mini:`);
      for (const r of missing) console.log(`  ${r.name}`);
    }

    // Apply
    for (const r of found) {
      if (!r.model) continue;
      await sql`
        UPDATE agents
        SET adapter_config = jsonb_set(adapter_config::jsonb, '{model}', to_jsonb(${r.model}::text)),
            updated_at = now()
        WHERE id = ${r.id}`;
    }
    console.log(`\nApplied ${found.length} revert(s).`);
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
