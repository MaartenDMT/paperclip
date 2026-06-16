/**
 * Scoped audit/remediation for the ReadersBase/Base production company.
 *
 * Dry-run by default. Pass --apply to update selected agents and clear safe
 * stale locks. This intentionally scopes by company so it does not touch other
 * Paperclip companies in the same instance.
 */
import postgres from "postgres";
import { pathToFileURL } from "node:url";
import { resolveMigrationConnection } from "./migration-runtime.js";

const APPLY = process.argv.includes("--apply");
const FIX_UNSTABLE = process.argv.includes("--fix-unstable-runtime");
const FICTION_PRIORITY_ONLY = process.argv.includes("--fiction-priority-only");
const FICTION_CREATE_ONLY = process.argv.includes("--fiction-create-only");
const COMPANY_ARG = readArg("--company");

const SITE_QA_RE = /(qa|quality|ux|check|monitor|production|website|catalog qa|author experience|interaction design)/i;
const FICTION_RE = /(fiction|storybook|story book|novel|novella|writer|editor|narrative|creative|lore|world|manuscript|plot|character|research|classification|graphic novel|series|fantasy|sci-fi|science fiction|genre[- ]?mix)/i;
const SITE_QA_AGENT_NAME_RE =
  /^(UXDesigner|QA Engineer|Catalog QA Analyst|UX Optimization Analyst|Interaction Design Optimizer|Admin Operations QA Analyst|Author Experience QA Analyst)$/i;
const FICTION_AGENT_NAME_RE =
  /^(Fiction Director|Research & Classification Agent|Storybook Creator|Content Writer|Novelist|Worldbuilding Architect|Manuscript Quality Architect|Character Architect|Graphic Novel Creator|Interactive Fiction Designer|Plot Architect|Short Fiction Writer|Novella Writer|Series Architect|Genre-Mix Architect|Sci-Fi Architect|Fantasy Architect)$/i;
const PAUSED_FICTION_AGENT_NAME_RE = /^(Short Fiction Writer|Novella Writer)$/i;

const CODEX_MODEL = "gpt-5.3-codex";
const STRATEGY_MODEL = "o3";
const CREATIVE_MODEL = "gpt-5.3-codex";
export const READERSBASE_CURRENT_FICTION_PRIORITY_NOTE =
  "Current ReadersBase fiction priority: prioritize full-length novels and series development, especially fantasy, genre-mix, and sci-fi lanes. Standalone short-story and novella production is paused for now unless the board explicitly reactivates it.";
export const READERSBASE_FICTION_DEPARTMENT_NOTE =
  "ReadersBase codebase and live website are the source of truth for product behavior, catalog surfaces, reader experience, author experience, and existing story-world commitments. Research & Classification Agent owns story research, source classification, backstory/history/family/friends/enemies/lovers dossiers, and evidence handoff before draft work expands the canon. Draft, research, character, plot, and worldbuilding agents should use story alignment meetings to discuss setup changes, reconcile plot/world/character/research conflicts, and update the story plan before major drafting or continuity decisions.";
const CREATIVE_SYSTEM_NOTE =
  `Production fiction quality bar: storybook work is not children-only. Create full-length normal or interactive novels and connected series with real plot, character arcs, conflict, setting/world-building, continuity, and mature pacing. Treat fantasy, genre-mix, and sci-fi as priority shelves. Images are occasional supporting assets, not the product. Target length is story-driven long-form fiction: do not initiate short stories or novellas under the current priority.\n\n${READERSBASE_CURRENT_FICTION_PRIORITY_NOTE}\n\n${READERSBASE_FICTION_DEPARTMENT_NOTE}`;
const SITE_QA_SYSTEM_NOTE =
  "Production ReadersBase QA bar: inspect the live site critically, reproduce issues, create or update concrete tasks for every defect, and do not mark work done until the site behavior is verified or a blocker/recovery issue owns the next action.";
const UNSTABLE_RUNTIME_NOTE =
  "Runtime reliability bar: every run must leave a concrete issue disposition: done, blocked with cause, in_review with reviewer/next action, or delegated follow-up. Do not exit after analysis without updating the issue state/comment trail.";
const PAUSED_FICTION_REASON =
  "Paused by ReadersBase board direction: short stories and novellas are deprioritized while full-length novels, interactive novels, fantasy, genre-mix, sci-fi, and series development take priority.";

export type ReadersbaseFictionAuditAgent = {
  id: string;
  name: string;
  status: string;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  recentFailures: number;
};

export type ReadersbaseFictionAgentCreatePlan = {
  name: string;
  role: string;
  title: string;
  icon: string;
  reportsTo: string;
  capabilities: string;
  adapterType: "codex_local";
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
};

export type ReadersbaseFictionAgentPlan = {
  creates: ReadersbaseFictionAgentCreatePlan[];
  upgrades: Array<{
    agent: ReadersbaseFictionAuditAgent;
    nextConfig: Record<string, unknown>;
  }>;
  resumes: Array<{
    agent: ReadersbaseFictionAuditAgent;
  }>;
  pauses: Array<{
    agent: ReadersbaseFictionAuditAgent;
    reason: string;
  }>;
};

const READERSBASE_FICTION_REQUIRED_AGENT_DEFS = [
  {
    name: "Research & Classification Agent",
    role: "research_classification",
    title: "Research & Classification Agent",
    icon: "search",
    capabilities:
      `Owns ReadersBase fiction research and classification before drafting expands canon. ${READERSBASE_FICTION_DEPARTMENT_NOTE}`,
  },
  {
    name: "Series Architect",
    role: "series_architect",
    title: "Series Architect",
    icon: "library",
    capabilities:
      `Owns connected novel and series structure, continuity, season/book arcs, and long-form franchise planning. ${READERSBASE_FICTION_DEPARTMENT_NOTE}`,
  },
  {
    name: "Genre-Mix Architect",
    role: "genre_mix_architect",
    title: "Genre-Mix Architect",
    icon: "sparkles",
    capabilities:
      `Owns genre-blend strategy, trope compatibility, reader promise, and cross-genre shelf positioning for ReadersBase fiction. ${READERSBASE_FICTION_DEPARTMENT_NOTE}`,
  },
  {
    name: "Sci-Fi Architect",
    role: "sci_fi_architect",
    title: "Sci-Fi Architect",
    icon: "rocket",
    capabilities:
      `Owns science-fiction systems, speculative logic, technology constraints, future history, and continuity for ReadersBase fiction. ${READERSBASE_FICTION_DEPARTMENT_NOTE}`,
  },
  {
    name: "Fantasy Architect",
    role: "fantasy_architect",
    title: "Fantasy Architect",
    icon: "wand",
    capabilities:
      `Owns fantasy worlds, magic or myth systems, factions, setting history, lore continuity, and reader-facing fantasy promise. ${READERSBASE_FICTION_DEPARTMENT_NOTE}`,
  },
] as const;

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

function normalizeAgentName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function buildReadersbaseFictionAgentPlan(
  agents: ReadersbaseFictionAuditAgent[],
): ReadersbaseFictionAgentPlan {
  const fictionDirector = agents.find((agent) => normalizeAgentName(agent.name) === "fiction-director" && agent.status !== "terminated") ?? null;
  const existingNames = new Set(agents.filter((agent) => agent.status !== "terminated").map((agent) => normalizeAgentName(agent.name)));
  const creates: ReadersbaseFictionAgentCreatePlan[] = fictionDirector
    ? READERSBASE_FICTION_REQUIRED_AGENT_DEFS
      .filter((definition) => !existingNames.has(normalizeAgentName(definition.name)))
      .map((definition) => ({
        ...definition,
        reportsTo: fictionDirector.id,
        adapterType: "codex_local",
        adapterConfig: buildCodexConfig({}, {
          model: CREATIVE_MODEL,
          effort: "xhigh",
          note: CREATIVE_SYSTEM_NOTE,
        }),
        runtimeConfig: {
          heartbeat: {
            enabled: false,
            wakeOnDemand: true,
          },
        },
      }))
    : [];

  const pauses = agents
    .filter((agent) => PAUSED_FICTION_AGENT_NAME_RE.test(agent.name) && agent.status !== "terminated")
    .map((agent) => ({ agent, reason: PAUSED_FICTION_REASON }));

  const upgrades = agents
    .filter((agent) => {
      if (agent.status === "terminated") return false;
      if (!FICTION_AGENT_NAME_RE.test(agent.name)) return false;
      return !PAUSED_FICTION_AGENT_NAME_RE.test(agent.name);
    })
    .map((agent) => ({
      agent,
      nextConfig: buildCodexConfig(agent.adapterConfig, {
        model: CREATIVE_MODEL,
        effort: "xhigh",
        note: CREATIVE_SYSTEM_NOTE,
      }),
    }));

  const resumes = upgrades
    .map((upgrade) => upgrade.agent)
    .filter((agent) => agent.status === "paused")
    .map((agent) => ({ agent }));

  return { creates, upgrades, resumes, pauses };
}

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    console.log(
      `mode: ${APPLY ? "APPLY" : "DRY-RUN"}${COMPANY_ARG ? `, company=${COMPANY_ARG}` : ""}${FICTION_PRIORITY_ONLY ? ", fiction-priority-only" : ""}${FICTION_CREATE_ONLY ? ", fiction-create-only" : ""}\n`,
    );

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
      pause_reason: string | null;
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
        a.id, a.name, a.role, a.title, a.capabilities, a.status, a.pause_reason, a.adapter_type, a.adapter_config, a.runtime_config,
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

    const siteQaUpgrades = FICTION_PRIORITY_ONLY || FICTION_CREATE_ONLY
      ? []
      : relevant.filter((agent) => {
          if (agent.status === "terminated") return false;
          return SITE_QA_AGENT_NAME_RE.test(agent.name);
        });
    const fictionPlan = buildReadersbaseFictionAgentPlan(
      relevant.map((agent) => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        adapterType: agent.adapter_type,
        adapterConfig: asRecord(agent.adapter_config),
        recentFailures: agent.recent_failures,
      })),
    );

    const unstableRuntime = FIX_UNSTABLE && !FICTION_PRIORITY_ONLY && !FICTION_CREATE_ONLY
      ? agents.filter((agent) => {
          if (agent.status === "terminated") return false;
          if (PAUSED_FICTION_AGENT_NAME_RE.test(agent.name)) return false;
          const model = asRecord(agent.adapter_config).model;
          return agent.recent_failures >= 4 ||
            model === "gpt-5.5" ||
            model === "gpt-5.4" ||
            model === "gpt-5.2";
        })
      : [];

    console.log(`\nPlanned site QA upgrades: ${siteQaUpgrades.length}`);
    for (const agent of siteQaUpgrades) {
      const next = buildCodexConfig(asRecord(agent.adapter_config), {
        model: CODEX_MODEL,
        effort: "high",
        note: SITE_QA_SYSTEM_NOTE,
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

    if (!FICTION_CREATE_ONLY) {
      console.log(`\nPlanned fiction priority upgrades: ${fictionPlan.upgrades.length}`);
      for (const upgrade of fictionPlan.upgrades) {
        const agent = agents.find((candidate) => candidate.id === upgrade.agent.id);
        if (!agent) continue;
        const next = upgrade.nextConfig;
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
    }

    console.log(`\nPlanned fiction agent creates: ${fictionPlan.creates.length}`);
    for (const create of fictionPlan.creates) {
      console.log(`  ${create.name}: new ${create.role} reporting to ${create.reportsTo}`);
      if (!APPLY) continue;
      await sql`
        INSERT INTO agents (
          id, company_id, name, role, title, icon, status, reports_to, capabilities,
          adapter_type, adapter_config, runtime_config, permissions, created_at, updated_at
        )
        VALUES (
          gen_random_uuid(),
          ${company.id},
          ${create.name},
          ${create.role},
          ${create.title},
          ${create.icon},
          'idle',
          ${create.reportsTo},
          ${create.capabilities},
          ${create.adapterType},
          ${create.adapterConfig as unknown as string},
          ${create.runtimeConfig as unknown as string},
          ${{} as unknown as string},
          now(),
          now()
        )`;
    }

    if (!FICTION_CREATE_ONLY) {
      console.log(`\nPlanned fiction resumes: ${fictionPlan.resumes.length}`);
      for (const resume of fictionPlan.resumes) {
        const agent = agents.find((candidate) => candidate.id === resume.agent.id);
        if (!agent) continue;
        console.log(`  ${agent.name}: ${agent.status} -> idle`);
        if (!APPLY) continue;
        await sql`
          UPDATE agents
          SET status = 'idle',
              pause_reason = NULL,
              paused_at = NULL,
              updated_at = now()
          WHERE id = ${agent.id}
            AND status = 'paused'`;
      }

      console.log(`\nPlanned fiction pauses: ${fictionPlan.pauses.length}`);
      for (const pause of fictionPlan.pauses) {
        const agent = agents.find((candidate) => candidate.id === pause.agent.id);
        if (!agent) continue;
        if (agent.status === "paused" && agent.pause_reason === pause.reason) {
          console.log(`  ${agent.name}: already paused`);
          continue;
        }
        console.log(`  ${agent.name}: ${agent.status} -> paused`);
        if (!APPLY) continue;
        await sql`
          UPDATE agents
          SET status = 'paused',
              pause_reason = ${pause.reason},
              paused_at = COALESCE(paused_at, now()),
              updated_at = now()
          WHERE id = ${agent.id}`;
      }
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
