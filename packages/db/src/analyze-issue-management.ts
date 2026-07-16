/**
 * Read-only issue-management audit.
 *
 * Surfaces the patterns that make agent companies noisy: duplicate/redundant
 * issue clusters, long comment threads, assignment/status churn, unresolved
 * blocker language without first-class blockers, and terminal issues that keep
 * receiving fresh activity.
 */
import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";
import { resolveDatabaseTarget } from "./runtime-config.js";

type IssueRow = {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignee_name: string | null;
  assignee_role: string | null;
  parent_identifier: string | null;
  created_at: Date;
  updated_at: Date;
  last_activity_at: Date;
  comment_count: number;
  participant_count: number;
  first_class_blockers: number;
  mentions: number;
  blocked_terms: number;
  evidence_terms: number;
  route_terms: number;
  decision_terms: number;
  status_updates: number;
  assignee_changes: number;
  handoff_events: number;
  latest_comment_snippet: string | null;
};

type CompanyRow = {
  id: string;
  name: string;
  issue_prefix: string;
};

const DEFAULT_LIMIT = 10;
const STOP_WORDS = new Set([
  "a",
  "after",
  "and",
  "author",
  "by",
  "can",
  "for",
  "from",
  "in",
  "is",
  "issue",
  "of",
  "on",
  "or",
  "production",
  "repair",
  "resolve",
  "the",
  "this",
  "to",
  "with",
]);

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function ageHours(date: Date): number {
  return Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
}

function titleTokens(title: string): Set<string> {
  const cleaned = title
    .toLowerCase()
    .replace(/\b[a-z]{2,5}-\d+\b/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function classify(row: IssueRow): string[] {
  const labels: string[] = [];
  const text = `${row.title}\n${row.description ?? ""}`.toLowerCase();
  if (/\bcover|covers|image|images|thumbnail\b/.test(text)) labels.push("cover/image");
  if (/\bbilling|spending-limit|github actions|check suite|runner\b/.test(text)) labels.push("ci/billing");
  if (/\bdeploy|railway|vercel|production\b/.test(text)) labels.push("deploy");
  if (/\bqa|verify|evidence|review\b/.test(text)) labels.push("review/evidence");
  if (/\blocked|terminal|correction|drift\b/.test(text)) labels.push("control-plane drift");
  return labels.length > 0 ? labels : ["general"];
}

function riskSignals(row: IssueRow): string[] {
  const signals: string[] = [];
  if (row.comment_count >= 20) signals.push("long thread");
  if (row.participant_count >= 4) signals.push("many participants");
  if (row.status_updates >= 4) signals.push("status churn");
  if (row.assignee_changes >= 2) signals.push("assignment churn");
  if (row.handoff_events > 0) signals.push("handoff recovery");
  if (row.blocked_terms > 0 && row.first_class_blockers === 0 && !["done", "cancelled"].includes(row.status)) {
    signals.push("blocker text without blocker edge");
  }
  if (["done", "cancelled"].includes(row.status) && ageHours(row.last_activity_at) < 48 && row.comment_count >= 10) {
    signals.push("terminal but recently active");
  }
  if (row.route_terms >= 3 || row.decision_terms >= 3) signals.push("routing/decision uncertainty");
  return signals;
}

function printList(title: string, rows: string[]): void {
  console.log(`\n=== ${title} ===`);
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const row of rows) console.log(`  ${row}`);
}

async function main() {
  const limit = Number.parseInt(argValue("limit") ?? `${DEFAULT_LIMIT}`, 10);
  const companyArg = argValue("company");
  const target = resolveDatabaseTarget();
  let stop = async () => {};
  let sql = postgres(
    target.mode === "postgres"
      ? target.connectionString
      : `postgres://paperclip:paperclip@127.0.0.1:${target.port}/paperclip`,
    { max: 1, connect_timeout: 5 },
  );

  try {
    await sql`SELECT 1`;
  } catch {
    await sql.end({ timeout: 1 });
    const r = await resolveMigrationConnection();
    stop = r.stop;
    sql = postgres(r.connectionString, { max: 1, connect_timeout: 5 });
  }

  try {
    const companyRows = companyArg
      ? await sql<CompanyRow[]>`
          SELECT id, name, issue_prefix
            FROM companies
           WHERE id::text = ${companyArg}
              OR lower(name) = lower(${companyArg})
              OR lower(issue_prefix) = lower(${companyArg})
           ORDER BY updated_at DESC
           LIMIT 1`
      : await sql<CompanyRow[]>`
          SELECT c.id, c.name, c.issue_prefix
            FROM companies c
       LEFT JOIN issues i ON i.company_id = c.id
        GROUP BY c.id, c.name, c.issue_prefix
        ORDER BY count(i.id) DESC, c.updated_at DESC
           LIMIT 1`;
    const company = companyRows[0];
    if (!company) throw new Error(`No company found${companyArg ? ` for ${companyArg}` : ""}`);

    const issues = await sql<IssueRow[]>`
      WITH latest AS (
        SELECT
          i.id,
          greatest(i.updated_at, coalesce(max(ic.created_at), i.updated_at)) AS last_activity_at
        FROM issues i
        LEFT JOIN issue_comments ic ON ic.issue_id = i.id
        WHERE i.company_id = ${company.id}
        GROUP BY i.id
        ORDER BY last_activity_at DESC
        LIMIT ${limit}
      ),
      comment_stats AS (
        SELECT
          ic.issue_id,
          count(*)::int AS comment_count,
          count(DISTINCT coalesce(ic.author_agent_id::text, ic.author_user_id, ic.author_type, 'unknown'))::int
            AS participant_count,
          count(*) FILTER (WHERE ic.body ~* '(@|agent://)')::int AS mentions,
          count(*) FILTER (WHERE ic.body ~* '\\m(blocked|blocker|blocks|stuck|cannot continue|no deploy action)\\M')::int
            AS blocked_terms,
          count(*) FILTER (WHERE ic.body ~* '\\m(evidence|verified|checked|screenshot|network|artifact|proof)\\M')::int
            AS evidence_terms,
          count(*) FILTER (WHERE ic.body ~* '\\m(route|routing|handoff|reassign|owner|assignee|next owner)\\M')::int
            AS route_terms,
          count(*) FILTER (WHERE ic.body ~* '\\m(decision|confirm|approval|disposition|approve|reject|question)\\M')::int
            AS decision_terms
        FROM issue_comments ic
        JOIN latest l ON l.id = ic.issue_id
        GROUP BY ic.issue_id
      ),
      latest_comment AS (
        SELECT DISTINCT ON (ic.issue_id)
          ic.issue_id,
          left(regexp_replace(ic.body, '\\s+', ' ', 'g'), 220) AS latest_comment_snippet
        FROM issue_comments ic
        JOIN latest l ON l.id = ic.issue_id
        ORDER BY ic.issue_id, ic.created_at DESC
      ),
      activity_stats AS (
        SELECT
          l.id AS issue_id,
          count(*) FILTER (WHERE a.action = 'issue.updated' AND a.details ? 'status')::int AS status_updates,
          count(*) FILTER (WHERE a.action = 'issue.updated' AND a.details ? 'assigneeAgentId')::int AS assignee_changes,
          count(*) FILTER (WHERE a.action LIKE 'issue.successful_run_handoff%')::int AS handoff_events
        FROM latest l
        LEFT JOIN activity_log a ON a.entity_type = 'issue' AND a.entity_id = l.id::text
        GROUP BY l.id
      ),
      blocker_stats AS (
        SELECT
          l.id AS issue_id,
          count(ir.id)::int AS first_class_blockers
        FROM latest l
        LEFT JOIN issue_relations ir ON ir.issue_id = l.id AND ir.type = 'blocks'
        GROUP BY l.id
      )
      SELECT
        i.id,
        i.identifier,
        i.title,
        i.description,
        i.status,
        i.priority,
        a.name AS assignee_name,
        a.role AS assignee_role,
        p.identifier AS parent_identifier,
        i.created_at,
        i.updated_at,
        l.last_activity_at,
        coalesce(cs.comment_count, 0)::int AS comment_count,
        coalesce(cs.participant_count, 0)::int AS participant_count,
        coalesce(bs.first_class_blockers, 0)::int AS first_class_blockers,
        coalesce(cs.mentions, 0)::int AS mentions,
        coalesce(cs.blocked_terms, 0)::int AS blocked_terms,
        coalesce(cs.evidence_terms, 0)::int AS evidence_terms,
        coalesce(cs.route_terms, 0)::int AS route_terms,
        coalesce(cs.decision_terms, 0)::int AS decision_terms,
        coalesce(ast.status_updates, 0)::int AS status_updates,
        coalesce(ast.assignee_changes, 0)::int AS assignee_changes,
        coalesce(ast.handoff_events, 0)::int AS handoff_events,
        lc.latest_comment_snippet
      FROM latest l
      JOIN issues i ON i.id = l.id
      LEFT JOIN issues p ON p.id = i.parent_id
      LEFT JOIN agents a ON a.id = i.assignee_agent_id
      LEFT JOIN comment_stats cs ON cs.issue_id = i.id
      LEFT JOIN latest_comment lc ON lc.issue_id = i.id
      LEFT JOIN activity_stats ast ON ast.issue_id = i.id
      LEFT JOIN blocker_stats bs ON bs.issue_id = i.id
      ORDER BY l.last_activity_at DESC`;

    console.log(`Issue-management audit for ${company.name} (${company.issue_prefix}), latest ${issues.length} issues`);
    console.log(`Company id: ${company.id}`);

    printList(
      "Latest Issues",
      issues.map((issue) => {
        const signals = riskSignals(issue);
        const labels = classify(issue).join(",");
        return `${issue.identifier ?? issue.id.slice(0, 8)} [${issue.status}] ${issue.title} | assignee=${
          issue.assignee_name ?? "<none>"
        } | comments=${issue.comment_count} participants=${issue.participant_count} | tags=${labels}${
          signals.length ? ` | signals=${signals.join("; ")}` : ""
        }`;
      }),
    );

    const clusters: string[] = [];
    const seenPairs = new Set<string>();
    for (let i = 0; i < issues.length; i += 1) {
      for (let j = i + 1; j < issues.length; j += 1) {
        const left = issues[i];
        const right = issues[j];
        const leftTokens = titleTokens(`${left.title} ${left.description ?? ""}`);
        const rightTokens = titleTokens(`${right.title} ${right.description ?? ""}`);
        const score = jaccard(leftTokens, rightTokens);
        const sharedLabels = classify(left).filter((label) => classify(right).includes(label));
        const likelyCluster = score >= 0.18 || sharedLabels.includes("cover/image") || sharedLabels.includes("ci/billing");
        if (!likelyCluster) continue;
        const key = [left.id, right.id].sort().join(":");
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        clusters.push(
          `${left.identifier} <-> ${right.identifier} | similarity=${score.toFixed(2)} | shared=${sharedLabels.join(",")}`,
        );
      }
    }
    printList("Potential Redundancy Clusters", clusters);

    printList(
      "Role / Decision Churn",
      issues
        .filter((issue) => riskSignals(issue).some((signal) => signal.includes("churn") || signal.includes("uncertainty")))
        .map(
          (issue) =>
            `${issue.identifier}: statusUpdates=${issue.status_updates}, assigneeChanges=${issue.assignee_changes}, routeTerms=${issue.route_terms}, decisionTerms=${issue.decision_terms}, assignee=${
              issue.assignee_name ?? "<none>"
            } (${issue.assignee_role ?? "<no role>"})`,
        ),
    );

    printList(
      "Blocker Hygiene",
      issues
        .filter((issue) => issue.blocked_terms > 0 || issue.first_class_blockers > 0)
        .map(
          (issue) =>
            `${issue.identifier}: status=${issue.status}, blockerMentions=${issue.blocked_terms}, firstClassBlockers=${issue.first_class_blockers}, handoffEvents=${issue.handoff_events}`,
        ),
    );

    const terms = await sql<Array<{ term: string; issue_count: number }>>`
      WITH latest AS (
        SELECT i.id
          FROM issues i
     LEFT JOIN issue_comments ic ON ic.issue_id = i.id
         WHERE i.company_id = ${company.id}
      GROUP BY i.id
      ORDER BY greatest(i.updated_at, coalesce(max(ic.created_at), i.updated_at)) DESC
         LIMIT ${limit}
      ),
      corpus AS (
        SELECT lower(i.title || ' ' || coalesce(i.description, '') || ' ' || coalesce(string_agg(ic.body, ' '), '')) AS body
          FROM latest l
          JOIN issues i ON i.id = l.id
     LEFT JOIN issue_comments ic ON ic.issue_id = i.id
      GROUP BY i.id
      ),
      vocab(term, pattern) AS (
        VALUES
          ('cover/image', '\\m(cover|covers|image|images|thumbnail)\\M'),
          ('billing/actions', '\\m(billing|spending-limit|github actions|check suite|runner)\\M'),
          ('deploy/release', '\\m(deploy|railway|vercel|production)\\M'),
          ('review/evidence', '\\m(review|qa|verify|evidence|screenshot|network)\\M'),
          ('routing/handoff', '\\m(route|routing|handoff|reassign|next owner|assignee)\\M'),
          ('blocked', '\\m(blocked|blocker|stuck|cannot continue)\\M'),
          ('disposition/decision', '\\m(disposition|decision|confirm|approval|question)\\M')
      )
      SELECT v.term, count(*)::int AS issue_count
        FROM vocab v
        JOIN corpus c ON c.body ~ v.pattern
    GROUP BY v.term
    ORDER BY issue_count DESC, v.term`;
    printList("Discussion Themes", terms.map((row) => `${row.term}: ${row.issue_count}/${issues.length} issues`));

    console.log("\n=== Recommended Optimizations ===");
    console.log("  1. Deduplicate before creating work: if a new issue shares a theme with an active parent/root, suggest child/subtask linkage instead of another top-level issue.");
    console.log("  2. Require first-class blocker edges when comments contain blocker language and the issue is non-terminal.");
    console.log("  3. Add a terminal-state guard: recently completed/cancelled issues should accept correction comments, but checkout/reopen should require an explicit recovery issue.");
    console.log("  4. Route by artifact needed: evidence/QA -> QA role, code patch -> frontend/backend role, account billing -> board/CEO, deploy promotion -> DevOps.");
    console.log("  5. Treat handoff recovery events as operator attention: repeated successful-run-missing-disposition means the role prompt or issue template lacks an explicit final disposition step.");
  } finally {
    await sql.end();
    await stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
