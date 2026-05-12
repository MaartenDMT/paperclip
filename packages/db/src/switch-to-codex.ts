/**
 * Switch named agents from opencode_local → codex_local with role-appropriate
 * models. Avoids gpt-5.5 and gpt-5.4 per operator instruction.
 *
 * Audit: writes a row to agent_config_revisions for every change so the
 * earlier recovery pattern still works if you need to roll back.
 *
 * Dry-run by default. Pass --apply to commit.
 */
import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

const APPLY = process.argv.includes("--apply");

// Role → codex model mapping (no gpt-5.5, no gpt-5.4).
// CEO is pure strategy → o3 (deep reasoning, non-coding).
// CTO does both architecture and code review → gpt-5.3-codex.
// All engineers get gpt-5.3-codex (codex flagship for coding).
const PLAN: Array<{ name: string; model: string; effort: "minimal" | "low" | "medium" | "high" | "xhigh"; rationale: string }> = [
  { name: "CEO",                   model: "o3",             effort: "high",   rationale: "Strategic reasoning, no coding — o3 best for non-code deep reasoning." },
  { name: "CTO",                   model: "gpt-5.3-codex",  effort: "high",   rationale: "Architecture + code review — codex flagship handles both." },
  { name: "Senior Engineer",       model: "gpt-5.3-codex",  effort: "high",   rationale: "Heavy coding — codex flagship at high reasoning." },
  { name: "Full-Stack Developer",  model: "gpt-5.3-codex",  effort: "medium", rationale: "Broad coding — codex flagship at medium reasoning." },
  { name: "Backend Developer",     model: "gpt-5.3-codex",  effort: "medium", rationale: "Backend coding — codex flagship at medium reasoning." },
  { name: "Backend Developer 2",   model: "gpt-5.3-codex",  effort: "medium", rationale: "Backend coding — codex flagship at medium reasoning." },
];

// Keys that have direct meaning in both adapters and should survive migration.
const PORTABLE_KEYS = new Set([
  "cwd",
  "instructionsFilePath",
  "promptTemplate",
  "command",
  "extraArgs",
  "env",
  "timeoutSec",
  "graceSec",
]);

function buildCodexConfig(oldConfig: Record<string, unknown>, model: string, effort: string) {
  const next: Record<string, unknown> = {
    model,
    modelReasoningEffort: effort,
    dangerouslyBypassApprovalsAndSandbox: true,
  };
  // Translate opencode dangerouslySkipPermissions → codex bypass (preserve intent).
  if (oldConfig.dangerouslySkipPermissions === false) {
    next.dangerouslyBypassApprovalsAndSandbox = false;
  }
  for (const k of PORTABLE_KEYS) {
    if (k in oldConfig && oldConfig[k] !== undefined && oldConfig[k] !== null) {
      next[k] = oldConfig[k];
    }
  }
  return next;
}

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    console.log(`mode: ${APPLY ? "APPLY" : "DRY-RUN"} — pass --apply to commit\n`);
    for (const entry of PLAN) {
      const found = await sql<Array<{
        id: string; company_id: string; name: string; adapter_type: string;
        adapter_config: Record<string, unknown>;
      }>>`
        SELECT id, company_id, name, adapter_type, adapter_config
          FROM agents
         WHERE name = ${entry.name}`;
      if (found.length === 0) {
        console.log(`  ⚠ ${entry.name.padEnd(28)} — not found, skipping`);
        continue;
      }
      for (const agent of found) {
        const oldConfig = agent.adapter_config ?? {};
        const newConfig = buildCodexConfig(oldConfig, entry.model, entry.effort);
        const oldModel = (oldConfig.model as string | undefined) ?? "?";
        console.log(
          `  ${agent.name.padEnd(28)} ${agent.adapter_type} (${oldModel}) → codex_local (${entry.model}, effort=${entry.effort})`
        );
        if (APPLY) {
          const beforeSnapshot = { adapterType: agent.adapter_type, adapterConfig: oldConfig };
          const afterSnapshot = { adapterType: "codex_local", adapterConfig: newConfig };
          await sql`
            INSERT INTO agent_config_revisions (id, company_id, agent_id, source, before_config, after_config, created_at)
            VALUES (gen_random_uuid(), ${agent.company_id}, ${agent.id}, 'switch-to-codex', ${beforeSnapshot as unknown as string}, ${afterSnapshot as unknown as string}, now())`;
          await sql`
            UPDATE agents
               SET adapter_type = 'codex_local',
                   adapter_config = ${newConfig as unknown as string},
                   updated_at = now()
             WHERE id = ${agent.id}`;
          console.log(`    ✓ applied + revision recorded`);
        }
      }
    }
    console.log(`\n${APPLY ? "✅ APPLIED" : "ℹ DRY-RUN — pass --apply to commit"}`);
  } finally { await sql.end(); await r.stop(); }
}

main().catch((e) => { console.error(e); process.exit(1); });
