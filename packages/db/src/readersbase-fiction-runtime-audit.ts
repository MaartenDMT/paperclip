/**
 * Scoped audit/remediation for the ReadersBase/Base production company.
 *
 * Dry-run by default. Pass --apply to update selected agents and clear safe
 * stale locks. This intentionally scopes by company so it does not touch other
 * Paperclip companies in the same instance.
 */
import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

const APPLY = process.argv.includes("--apply");
const FIX_UNSTABLE = process.argv.includes("--fix-unstable-runtime");
const COMPANY_ARG = readArg("--company");

const SITE_QA_RE = /(qa|quality|ux|check|monitor|production|website|catalog qa|author experience|interaction design)/i;
const FICTION_RE = /(fiction|storybook|story book|novel|writer|editor|narrative|creative|lore|world|manuscript|plot|character|graphic novel)/i;
const SITE_QA_AGENT_NAME_RE =
  /^(UXDesigner|QA Engineer|Catalog QA Analyst|UX Optimization Analyst|Interaction Design Optimizer|Admin Operations QA Analyst|Author Experience QA Analyst)$/i;
const FICTION_AGENT_NAME_RE =
  /^(Fiction Director|Storybook Creator|Content Writer|Novelist|Worldbuilding Architect|Manuscript Quality Architect|Character Architect|Graphic Novel Creator|Interactive Fiction Designer|Plot Architect|Short Fiction Writer)$/i;

const CODEX_MODEL = "gpt-5.3-codex";
const STRATEGY_MODEL = "o3";
const CREATIVE_MODEL = "gpt-5.3-codex";
const CREATIVE_SYSTEM_NOTE =
  "Production fiction quality bar: storybook work is not children-only. Create normal or interactive novels across any genre with real plot, character arcs, conflict, setting/world-building, continuity, and mature pacing. Images are occasional supporting assets, not the product. Target length is story-driven: roughly 50 to 200000+ words as appropriate.";
const SITE_QA_SYSTEM_NOTE =
  "Production ReadersBase QA bar: inspect the live site critically, reproduce issues, create or update concrete tasks for every defect, and do not mark work done until the site behavior is verified or a blocker/recovery issue owns the next action.";
const UNSTABLE_RUNTIME_NOTE =
  "Runtime reliability bar: every run must leave a concrete issue disposition: done, blocked with cause, in_review with reviewer/next action, or delegated follow-up. Do not exit after analysis without updating the issue state/comment trail.";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasText(value: string | null | undefined, pattern: RegExp): boolean {
  return pattern.test(value ?? "");
}

function appendPromptNote(config: Record<string, unknown>, note: string): Record<string, unknown> {
  const existing = typeof config.promptTemplate === "string" ? config.promptTemplate.trim() : "";
  if (existing.includes(note.slice(0, 80))) return config;
  return {
    ...config,
    promptTemplate: existing ? `${existing}\n\n${note}` : note,
  };
}

function configNeedsUpdate(current: {
  adapterType: string;
  adapterConfig: Record<string, unknown>;
}, next: Record<string, unknown>): boolean {
  return current.adapterType !== "codex_local" ||
    current.adapterConfig.model !== next.model ||
    current.adapterConfig.modelReasoningEffort !== next.modelReasoningEffort ||
    current.adapterConfig.promptTemplate !== next.promptTemplate;
}

function buildCodexConfig(
  oldConfig: Record<string, unknown>,
  options: { model: string; effort: "high" | "xhigh"; note: string },
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...oldConfig,
    model: options.model,
    modelReasoningEffort: options.effort,
    dangerouslyBypassApprovalsAndSandbox:
      typeof oldConfig.dangerouslyBypassApprovalsAndSandbox === "boolean"
        ? oldConfig.dangerouslyBypassApprovalsAndSandbox
        : true,
  };
  delete next.provider;
  return appendPromptNote(next, options.note);
}

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    console.log(`mode: ${APPLY ? "APPLY" : "DRY-RUN"}${COMPANY_ARG ? `, company=${COMPANY_ARG}` : ""}\n`);

    const companies = await sql<Array<{ id: string; name: string; description: string | null }>>`
      SELECT id, name, description
      FROM companies
      WHERE
        (${COMPANY_ARG}::text IS NOT NULL AND (id::text = ${COMPANY_ARG} OR lower(name) = lower(${COMPANY_ARG})))
        OR (${COMPANY_ARG}::text IS NULL AND (name ILIKE '%base%' OR name ILIKE '%readers%' OR description ILIKE '%readersbase%'))
      ORDER BY
        CASE WHEN lower(name) = 'base' THEN 0 WHEN name ILIKE '%readersbase%' THEN 1 ELSE 2 END,
        created_at DESC`;

    if (companies.length === 0) {
      console.log("No matching Base/ReadersBase company found.");
      return;
    }
    if (companies.length > 1 && !COMPANY_ARG) {
      console.log("Multiple possible companies found. Re-run with --company <id-or-name>.");
      for (const company of companies) console.log(`  ${company.id}  ${company.name}`);
      return;
    }

    const company = companies[0];
    console.log(`Company: ${company.name} (${company.id})\n`);

    const agents = await sql<Array<{
      id: string;
      name: string;
      role: string | null;
      title: string | null;
      capabilities: string | null;
      status: string;
      adapter_type: string;
      adapter_config: Record<string, unknown>;
      runtime_config: Record<string, unknown>;
      recent_runs: number;
      recent_failures: number;
      missing_disposition: number;
      timeouts: number;
      adapter_failures: number;
    }>>`
      SELECT
        a.id, a.name, a.role, a.title, a.capabilities, a.status, a.adapter_type, a.adapter_config, a.runtime_config,
        count(hr.id)::int AS recent_runs,
        count(hr.id) FILTER (WHERE hr.status IN ('failed','timed_out','cancelled'))::int AS recent_failures,
        count(hr.id) FILTER (WHERE hr.error_code = 'missing_issue_disposition')::int AS missing_disposition,
        count(hr.id) FILTER (WHERE hr.error_code = 'timeout')::int AS timeouts,
        count(hr.id) FILTER (WHERE hr.error_code = 'adapter_failed')::int AS adapter_failures
      FROM agents a
      LEFT JOIN heartbeat_runs hr ON hr.agent_id = a.id AND hr.created_at > now() - interval '24 hours'
      WHERE a.company_id = ${company.id}
      GROUP BY a.id
      ORDER BY recent_failures DESC, a.name`;

    const relevant = agents.filter((agent) => {
      const text = `${agent.name} ${agent.role ?? ""} ${agent.title ?? ""} ${agent.capabilities ?? ""}`;
      return SITE_QA_AGENT_NAME_RE.test(agent.name) || FICTION_AGENT_NAME_RE.test(agent.name) || SITE_QA_RE.test(text) || FICTION_RE.test(text) || agent.recent_failures > 0;
    });

    console.log("Relevant agents:");
    for (const agent of relevant) {
      const cfg = asRecord(agent.adapter_config);
      const model = typeof cfg.model === "string" ? cfg.model : "-";
      console.log(
        `  ${agent.name} | ${agent.adapter_type} | model=${model} | status=${agent.status} | runs=${agent.recent_runs} failures=${agent.recent_failures} missingDisposition=${agent.missing_disposition}`,
      );
    }

    const ghostLocks = await sql<Array<{ id: string; identifier: string | null; title: string; finished_at: Date }>>`
      SELECT i.id, i.identifier, i.title, h.finished_at
      FROM issues i
      JOIN heartbeat_runs h ON h.id = i.execution_run_id
      WHERE i.company_id = ${company.id}
        AND i.execution_run_id IS NOT NULL
        AND h.finished_at IS NOT NULL
        AND h.finished_at < now() - interval '30 minutes'
        AND i.status NOT IN ('done','cancelled')
      ORDER BY h.finished_at`;
    console.log(`\nClearable ghost execution locks: ${ghostLocks.length}`);
    for (const issue of ghostLocks) {
      console.log(`  ${issue.identifier ?? issue.id.slice(0, 8)} | ${issue.finished_at.toISOString()} | ${issue.title}`);
    }

    const loops = await sql<Array<{ id: string; identifier: string | null; title: string; status: string; fails: number }>>`
      WITH fails AS (
        SELECT (h.context_snapshot->>'issueId')::uuid AS issue_id, count(*)::int AS c
        FROM heartbeat_runs h
        WHERE h.company_id = ${company.id}
          AND h.created_at > now() - interval '3 days'
          AND h.status IN ('failed','timed_out')
          AND h.context_snapshot ? 'issueId'
        GROUP BY 1
      )
      SELECT i.id, i.identifier, i.title, i.status, f.c AS fails
      FROM fails f
      JOIN issues i ON i.id = f.issue_id
      WHERE f.c >= 5
        AND i.status NOT IN ('done','cancelled')
      ORDER BY f.c DESC
      LIMIT 25`;
    console.log(`\nRetry-loop active issues: ${loops.length}`);
    for (const issue of loops) {
      console.log(`  ${issue.fails.toString().padStart(3)} fails | ${issue.identifier ?? issue.id.slice(0, 8)} | [${issue.status}] ${issue.title}`);
    }

    const upgrades = relevant.filter((agent) => {
      if (agent.status === "terminated") return false;
      return SITE_QA_AGENT_NAME_RE.test(agent.name) || FICTION_AGENT_NAME_RE.test(agent.name);
    });

    const unstableRuntime = FIX_UNSTABLE
      ? agents.filter((agent) => {
          if (agent.status === "terminated") return false;
          const model = asRecord(agent.adapter_config).model;
          return agent.recent_failures >= 4 ||
            model === "gpt-5.5" ||
            model === "gpt-5.4" ||
            model === "gpt-5.2";
        })
      : [];

    console.log(`\nPlanned agent upgrades: ${upgrades.length}`);
    for (const agent of upgrades) {
      const creative = FICTION_AGENT_NAME_RE.test(agent.name);
      const next = buildCodexConfig(asRecord(agent.adapter_config), {
        model: creative ? CREATIVE_MODEL : CODEX_MODEL,
        effort: creative ? "xhigh" : "high",
        note: creative ? CREATIVE_SYSTEM_NOTE : SITE_QA_SYSTEM_NOTE,
      });
      if (!configNeedsUpdate({ adapterType: agent.adapter_type, adapterConfig: asRecord(agent.adapter_config) }, next)) {
        console.log(`  ${agent.name}: already codex_local (${next.model}, effort=${next.modelReasoningEffort})`);
        continue;
      }
      console.log(`  ${agent.name}: ${agent.adapter_type} -> codex_local (${next.model}, effort=${next.modelReasoningEffort})`);
      if (!APPLY) continue;
      await sql`
        INSERT INTO agent_config_revisions (
          id, company_id, agent_id, source, changed_keys, before_config, after_config, created_at
        )
        VALUES (
          gen_random_uuid(),
          ${company.id},
          ${agent.id},
          'readersbase-fiction-runtime-audit',
          ${["adapter_type", "adapter_config"] as unknown as string},
          ${{ adapterType: agent.adapter_type, adapterConfig: agent.adapter_config } as unknown as string},
          ${{ adapterType: "codex_local", adapterConfig: next } as unknown as string},
          now()
        )`;
      await sql`
        UPDATE agents
        SET adapter_type = 'codex_local',
            adapter_config = ${next as unknown as string},
            status = CASE WHEN status = 'error' THEN 'idle' ELSE status END,
            pause_reason = NULL,
            paused_at = NULL,
            updated_at = now()
        WHERE id = ${agent.id}`;
    }

    if (FIX_UNSTABLE) {
      console.log(`\nUnstable runtime upgrades: ${unstableRuntime.length}`);
      for (const agent of unstableRuntime) {
        const strategy = /^(CEO)$/i.test(agent.name);
        const creative = FICTION_AGENT_NAME_RE.test(agent.name);
        const next = buildCodexConfig(asRecord(agent.adapter_config), {
          model: strategy ? STRATEGY_MODEL : CODEX_MODEL,
          effort: creative ? "xhigh" : "high",
          note: UNSTABLE_RUNTIME_NOTE,
        });
        if (!configNeedsUpdate({ adapterType: agent.adapter_type, adapterConfig: asRecord(agent.adapter_config) }, next)) {
          console.log(`  ${agent.name}: already stable (${next.model}, effort=${next.modelReasoningEffort})`);
          continue;
        }
        console.log(`  ${agent.name}: ${agent.adapter_type} -> codex_local (${next.model}, effort=${next.modelReasoningEffort})`);
        if (!APPLY) continue;
        await sql`
          INSERT INTO agent_config_revisions (
            id, company_id, agent_id, source, changed_keys, before_config, after_config, created_at
          )
          VALUES (
            gen_random_uuid(),
            ${company.id},
            ${agent.id},
            'readersbase-unstable-runtime-audit',
            ${["adapter_type", "adapter_config"] as unknown as string},
            ${{ adapterType: agent.adapter_type, adapterConfig: agent.adapter_config } as unknown as string},
            ${{ adapterType: "codex_local", adapterConfig: next } as unknown as string},
            now()
          )`;
        await sql`
          UPDATE agents
          SET adapter_type = 'codex_local',
              adapter_config = ${next as unknown as string},
              status = CASE WHEN status = 'error' THEN 'idle' ELSE status END,
              pause_reason = NULL,
              paused_at = NULL,
              updated_at = now()
          WHERE id = ${agent.id}`;
      }
    }

    if (APPLY && ghostLocks.length > 0) {
      const ids = ghostLocks.map((issue) => issue.id);
      await sql`
        UPDATE issues
        SET execution_run_id = NULL,
            updated_at = now()
        WHERE id = ANY(${ids}::uuid[])`;
      console.log(`\nCleared ${ghostLocks.length} ghost execution lock(s).`);
    }

    console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN complete. Re-run with --apply to commit."}`);
  } finally {
    await sql.end();
    await r.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
