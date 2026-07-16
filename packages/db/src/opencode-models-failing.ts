import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    // For each opencode_local agent, extract the configured model, count
    // recent successes vs failures, and pull a sample error.
    const rows = await sql<{
      model: string;
      total: number;
      failed: number;
      succeeded: number;
      sample_err: string | null;
    }[]>`
      WITH oc_agents AS (
        SELECT id, name, adapter_config -> 'model' #>> '{}' AS model
        FROM agents
        WHERE adapter_type = 'opencode_local'
      ),
      runs AS (
        SELECT a.model, hr.status,
               substring((hr.result_json::jsonb -> 'stdout')::text from 1 for 400) AS so,
               substring(hr.result_json::text from 1 for 400) AS rj
        FROM heartbeat_runs hr
        JOIN oc_agents a ON a.id = hr.agent_id
        WHERE hr.created_at > now() - interval '24 hours'
      )
      SELECT
        coalesce(model, '<no model>') AS model,
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
        max(CASE WHEN status = 'failed' THEN
          coalesce(
            substring(rj from 'Insufficient[^"]+'),
            substring(rj from 'APIError[^,]+'),
            substring(rj from 'statusCode[^,]+'),
            substring(so from 'error[^"]{0,80}'),
            'no message'
          )
        END) AS sample_err
      FROM runs
      GROUP BY model
      ORDER BY failed DESC, total DESC`;

    console.log("opencode_local failures by model (last 24h):\n");
    console.log("MODEL".padEnd(50) + "TOTAL".padStart(7) + "FAIL".padStart(7) + "OK".padStart(5) + "  RATE");
    console.log("-".repeat(80));
    for (const r of rows) {
      const rate = r.total > 0 ? Math.round((r.failed / r.total) * 100) : 0;
      console.log(
        r.model.slice(0, 49).padEnd(50) +
        String(r.total).padStart(7) +
        String(r.failed).padStart(7) +
        String(r.succeeded).padStart(5) +
        "  " + rate + "%"
      );
      if (r.sample_err) console.log("  err: " + r.sample_err.slice(0, 120));
    }

    // Also break down by error class extracted from result_json
    console.log("\n\nError classes (failed runs only, last 24h):");
    const errs = await sql<{ klass: string; c: number }[]>`
      SELECT
        CASE
          WHEN result_json::text LIKE '%Insufficient balance%' THEN 'opencode-billing: 401 Insufficient balance'
          WHEN result_json::text LIKE '%opencode models%failed%' THEN 'opencode-models: discovery failed (CLI crash)'
          WHEN result_json::text LIKE '%opencode models%timed out%' THEN 'opencode-models: timed out (20s)'
          WHEN result_json::text LIKE '%adapter_failed%' AND result_json::text NOT LIKE '%stdout%' THEN 'adapter_failed: empty (likely opencode silent crash)'
          WHEN result_json::text LIKE '%adapter_failed%' THEN 'adapter_failed: with stdout (session-level)'
          ELSE 'other'
        END AS klass,
        count(*)::int AS c
      FROM heartbeat_runs hr
      JOIN agents a ON a.id = hr.agent_id
      WHERE a.adapter_type = 'opencode_local'
        AND hr.status = 'failed'
        AND hr.created_at > now() - interval '24 hours'
      GROUP BY klass
      ORDER BY c DESC`;
    for (const e of errs) console.log("  " + String(e.c).padStart(4) + "  " + e.klass);
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
