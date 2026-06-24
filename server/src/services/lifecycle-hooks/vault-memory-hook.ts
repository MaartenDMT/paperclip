/**
 * Vault Memory Hook — post-run hook that enforces the karpathy-obsidian-memory
 * contract by writing the audit trail directly to the Obsidian vault.
 *
 * Behaviour (on `run.after.success`):
 *  1. Scaffold `<vault>/agents/<slug>.md` if missing.
 *  2. Extract `REA-####` IDs from explicit run context and structured result data.
 *  3. For each issue ID: scaffold `<vault>/issues/<id>.md` if missing.
 *  4. Validate each touched issue page's mtime advanced during the run.
 *  5. Append a single entry to `<vault>/log.md` matching the schema, marking
 *     `noncompliant` if any touched issue was not updated.
 *
 * Safety:
 *  - Filesystem-only side effects; never modifies the DB.
 *  - Errors are swallowed (handler is wrapped by the registry).
 *  - Idempotent: re-running the same hook on the same run only adds another
 *    log line; pages are only scaffolded when missing.
 *
 * Configurable via env:
 *  - PAPERCLIP_MEMORY_VAULT (default A:/Programming/paperclip/memory/obsidian)
 *  - PAPERCLIP_MEMORY_VAULT_TZ (default Europe/Brussels — label only)
 */

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LifecycleContext, PostHookHandler } from "../lifecycle-hooks.js";

const VAULT =
  process.env.PAPERCLIP_MEMORY_VAULT ||
  "A:/Programming/paperclip/memory/obsidian";
const TZ_LABEL = process.env.PAPERCLIP_MEMORY_VAULT_TZ || "Europe/Brussels";
const ISSUE_RE = /\bREA-\d{2,5}\b/g;

// LLM backend for extraction. By default this follows the local adapter that
// last completed a run: Claude agents use the Claude CLI backend and Codex
// agents use the Codex backend. PAPERCLIP_GRAPHIFY_BACKEND remains an explicit
// operator override; there is intentionally no implicit Ollama fallback.
const GRAPHIFY_BACKEND_OVERRIDE = process.env.PAPERCLIP_GRAPHIFY_BACKEND?.trim() || null;
const GRAPHIFY_MODEL_OVERRIDE = process.env.PAPERCLIP_GRAPHIFY_MODEL?.trim() || null;
const GRAPHIFY_CORPUS_MODE = process.env.PAPERCLIP_GRAPHIFY_CORPUS_MODE || "compact";
const GRAPHIFY_CORPUS_DIR =
  process.env.PAPERCLIP_GRAPHIFY_CORPUS_DIR ||
  path.join(VAULT, ".graphify-corpus");
const GRAPHIFY_MAX_DOC_BYTES = Number(
  process.env.PAPERCLIP_GRAPHIFY_MAX_DOC_BYTES || 12_000,
);
// 0 means "no file-count cap". The compact corpus already bounds per-file
// bytes and excludes noisy note classes, so capping issue/agent pages by mtime
// makes memory search silently miss older but still relevant work.
const GRAPHIFY_MAX_ISSUE_FILES = Number(
  process.env.PAPERCLIP_GRAPHIFY_MAX_ISSUE_FILES ?? 0,
);
const GRAPHIFY_TOKEN_BUDGET = Number(
  process.env.PAPERCLIP_GRAPHIFY_TOKEN_BUDGET ||
    (GRAPHIFY_BACKEND_OVERRIDE === "ollama" ? 4_096 : 60_000),
);
const GRAPHIFY_API_TIMEOUT_SECONDS = Number(
  process.env.PAPERCLIP_GRAPHIFY_API_TIMEOUT_SECONDS || 900,
);
const GRAPHIFY_LOCK_STALE_MS = Number(
  process.env.PAPERCLIP_GRAPHIFY_LOCK_STALE_MS || 6 * 60 * 60 * 1000,
);
// Periodic refresh: extract the vault into a fresh graph every N ms regardless
// of run activity. Predictable load, no per-run trigger means no shell spam.
const GRAPHIFY_INTERVAL_MS = Number(
  process.env.PAPERCLIP_GRAPHIFY_INTERVAL_MS || 15 * 60 * 1000,
);
// Set PAPERCLIP_GRAPHIFY_DISABLE=1 to turn off auto-refresh entirely.
const GRAPHIFY_DISABLED = process.env.PAPERCLIP_GRAPHIFY_DISABLE === "1";
const GRAPHIFY_LOCK_DIR =
  process.env.PAPERCLIP_GRAPHIFY_LOCK_DIR ||
  path.join(VAULT, ".graphify-extract.lock");
const GRAPHIFY_GRAPH_FILE = "graph.json";
const GRAPHIFY_GRAPH_BACKUP_FILE = "graph.last-good.json";
const GRAPHIFY_EXTRACT_LOG_FILE = "graphify-extract.last.log";
const GRAPHIFY_MAX_ANCHOR_SOURCE_FILES = Number(
  process.env.PAPERCLIP_GRAPHIFY_MAX_ANCHOR_SOURCE_FILES || 250,
);
const GRAPHIFY_MAX_ANCHOR_WIKILINKS = Number(
  process.env.PAPERCLIP_GRAPHIFY_MAX_ANCHOR_WIKILINKS || 500,
);

/**
 * Resolve the graphify executable to an absolute path ONCE at module load.
 * On Windows the binary is a `.cmd` shim; Node's spawn() does not honour
 * PATHEXT without `shell: true`. Using `where graphify` (or `which graphify`)
 * gives us the absolute path so we can spawn it directly — no shell, no
 * lingering cmd.exe wrappers, reliable exit detection.
 */
function resolveGraphifyBin(): string | null {
  const override = process.env.PAPERCLIP_GRAPHIFY_BIN;
  if (override && fs.existsSync(override)) return override;
  const lookupCmd = process.platform === "win32" ? "where" : "which";
  try {
    const output = execFileSync(lookupCmd, ["graphify"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    // `where` may print multiple lines; prefer the `.cmd` shim on Windows.
    const candidates = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (candidates.length === 0) return null;
    const scored = candidates
      .map((candidate) => ({
        candidate,
        score: scoreGraphifyCandidate(candidate),
      }))
      .sort((left, right) => right.score - left.score);
    return scored[0]?.candidate ?? null;
  } catch {
    return null;
  }
}

function scoreGraphifyCandidate(candidate: string): number {
  const value = candidate.toLowerCase();
  let score = 0;
  if (value.endsWith(".cmd")) score += 1;
  if (value.includes("\\.local\\bin\\")) score += 10;
  if (value.includes("\\uv\\") || value.includes("\\appdata\\roaming\\uv\\")) score += 8;
  if (value.includes("\\anaconda") || value.includes("\\conda")) score -= 10;
  if (value.includes("\\d:\\bin\\")) score -= 2;
  return score;
}

const GRAPHIFY_BIN_RESOLVED = resolveGraphifyBin();
let graphifyInFlight = false;
let graphifyTimer: NodeJS.Timeout | null = null;
let graphifyCallerAdapterType: string | null = null;

interface GraphifyExtractLock {
  dir: string;
  owner: string;
}

interface GraphifyExtractLockMetadata {
  owner?: string;
  pid?: number | null;
  parentPid?: number | null;
  startedAt?: string;
  target?: string;
  vault?: string;
  command?: string[];
}

const GRAPHIFY_EXCLUDED_DIRS = new Set([
  ".git",
  ".graphify-corpus",
  ".obsidian",
  ".trash",
  "graphify-out",
  "node_modules",
]);
const DEFAULT_WALK_EXCLUDED_DIRS = new Set([".git", "node_modules", ".trash"]);
const GRAPHIFY_EXCLUDED_FILES = new Set(["log.md"]);
const GRAPHIFY_ALLOWED_TOP_LEVEL_DIRS = new Set([
  "agents",
  "comments",
  "decisions",
  "issues",
  "projects",
]);
const GRAPHIFY_ALLOWED_TOP_LEVEL_FILES = new Set(["memory.md", "schema.md"]);

function shouldExcludeGraphifyDir(name: string): boolean {
  if (GRAPHIFY_EXCLUDED_DIRS.has(name)) return true;
  return name.startsWith(".graphify-out") || name.startsWith("graphify-out-broken");
}

function walkMarkdownFiles(
  root: string,
  out: string[] = [],
  excludedDirs: Set<string> = DEFAULT_WALK_EXCLUDED_DIRS,
): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (
        excludedDirs.has(entry.name) ||
        (excludedDirs === GRAPHIFY_EXCLUDED_DIRS && shouldExcludeGraphifyDir(entry.name))
      ) {
        continue;
      }
      walkMarkdownFiles(fullPath, out, excludedDirs);
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".md") &&
      !GRAPHIFY_EXCLUDED_FILES.has(entry.name.toLowerCase())
    ) {
      out.push(fullPath);
    }
  }
  return out;
}

function walkGraphifySourceMarkdownFiles(root: string): string[] {
  return walkMarkdownFiles(root, [], GRAPHIFY_EXCLUDED_DIRS);
}

function slash(value: string): string {
  return value.replaceAll("\\", "/");
}

function stripMd(value: string): string {
  return value.toLowerCase().replace(/\.md$/i, "");
}

function buildMarkdownIndexes(vaultRoot: string): {
  pathIndex: Set<string>;
  basenameIndex: Set<string>;
} {
  const pathIndex = new Set<string>();
  const basenameIndex = new Set<string>();

  for (const file of walkGraphifySourceMarkdownFiles(vaultRoot)) {
    const relPath = slash(path.relative(vaultRoot, file));
    pathIndex.add(stripMd(relPath));
    basenameIndex.add(stripMd(path.posix.basename(relPath)));
  }

  return { pathIndex, basenameIndex };
}

function wikilinkTargetResolves(
  target: string,
  indexes: { pathIndex: Set<string>; basenameIndex: Set<string> },
): boolean {
  const clean = target.split("#")[0]?.trim() ?? "";
  if (!clean || /^[a-z]+:/i.test(clean)) return true;

  const normalized = stripMd(slash(clean).replace(/^\/+/, ""));
  if (normalized.includes("/")) return indexes.pathIndex.has(normalized);
  return indexes.basenameIndex.has(normalized.toLowerCase());
}

export function normalizeVaultIssueLinks(vaultRoot: string): number {
  let replacements = 0;
  for (const file of walkMarkdownFiles(vaultRoot)) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!text.includes("/REA/issues/")) continue;
    const replacementCount = text.split("/REA/issues/").length - 1;
    fs.writeFileSync(file, text.split("/REA/issues/").join("issues/"), "utf8");
    replacements += replacementCount;
  }
  return replacements;
}

export function sanitizeGraphReportWikilinks(vaultRoot: string): number {
  const reportFile = path.join(vaultRoot, "graphify-out", "GRAPH_REPORT.md");
  if (!fs.existsSync(reportFile)) return 0;

  let text: string;
  try {
    text = fs.readFileSync(reportFile, "utf8");
  } catch {
    return 0;
  }

  const indexes = buildMarkdownIndexes(vaultRoot);
  let replacements = 0;
  const updated = text.replace(/\[\[([^\]]+)\]\]/g, (match, body: string) => {
    const separator = body.indexOf("|");
    const target = separator >= 0 ? body.slice(0, separator) : body;
    const alias = separator >= 0 ? body.slice(separator + 1) : "";
    if (wikilinkTargetResolves(target, indexes)) return match;
    replacements += 1;
    return alias || target;
  });

  if (replacements > 0) fs.writeFileSync(reportFile, updated, "utf8");
  return replacements;
}

function sanitizeVaultMemoryOutputs(): void {
  try {
    normalizeVaultIssueLinks(VAULT);
    sanitizeGraphReportWikilinks(VAULT);
  } catch {
    // Graphify refresh sanitation is best-effort; never block heartbeat work.
  }
}

function graphifyGraphFile(vaultRoot: string): string {
  return path.join(vaultRoot, "graphify-out", GRAPHIFY_GRAPH_FILE);
}

function graphifyGraphBackupFile(vaultRoot: string): string {
  return path.join(vaultRoot, "graphify-out", GRAPHIFY_GRAPH_BACKUP_FILE);
}

function graphifyExtractLogFile(vaultRoot: string): string {
  return path.join(vaultRoot, "graphify-out", GRAPHIFY_EXTRACT_LOG_FILE);
}

function readGraphNodeCount(file: string): number | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { nodes?: unknown };
    return Array.isArray(parsed.nodes) ? parsed.nodes.length : null;
  } catch {
    return null;
  }
}

type GraphifyNode = {
  id: string;
  label: string;
  file_type?: string;
  source_file?: string | null;
  source_location?: string | null;
  source_url?: string | null;
  captured_at?: string | null;
  author?: string | null;
  contributor?: string | null;
};

type GraphifyEdge = {
  source: string;
  target: string;
  relation: string;
  confidence?: string;
  confidence_score?: number;
  source_file?: string | null;
  source_location?: string | null;
  weight?: number;
};

type GraphifyGraph = {
  nodes?: GraphifyNode[];
  edges?: GraphifyEdge[];
  hyperedges?: unknown[];
  input_tokens?: unknown;
  output_tokens?: unknown;
  [key: string]: unknown;
};

function stableGraphId(prefix: string, value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `vault-${prefix}-${normalized || "note"}`;
}

function parseFrontmatter(markdown: string): Record<string, string> {
  if (!markdown.startsWith("---\n")) return {};
  const end = markdown.indexOf("\n---", 4);
  if (end < 0) return {};
  const values: Record<string, string> = {};
  for (const line of markdown.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    values[match[1]!.toLowerCase()] = match[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

function firstMarkdownHeading(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

function compactLabel(value: string, maxLength = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

const ISSUE_STATUS_RE =
  /\bstatus\b\s*(?:[:=]|showed|is|still showed)?\s*(?:[`"']|REA-\d+\s+status\s+[`"']?)?\b(backlog|todo|in_progress|in_review|done|blocked|cancelled)\b/gi;

function latestIssueStatusMention(markdown: string): string | null {
  const tail = markdown.slice(-8_000);
  let latest: string | null = null;
  for (const match of tail.matchAll(ISSUE_STATUS_RE)) {
    latest = match[1] ?? latest;
  }
  return latest;
}

function buildAnchorLabel(relPath: string, markdown: string): string {
  const normalized = slash(relPath);
  const basename = path.posix.basename(normalized, ".md");
  const frontmatter = parseFrontmatter(markdown);
  const title = frontmatter.title || firstMarkdownHeading(markdown) || basename;
  if (normalized.startsWith("issues/")) {
    const issueId = basename.match(ISSUE_RE)?.[0] ?? basename;
    const issueStatus = latestIssueStatusMention(markdown) ?? frontmatter.status;
    const status = issueStatus ? ` status ${issueStatus}` : "";
    return compactLabel(`${issueId} issue ${title}${status}`);
  }
  const status = frontmatter.status ? ` status ${frontmatter.status}` : "";
  if (normalized.startsWith("agents/")) {
    return compactLabel(`${basename} agent ${title}${status}`);
  }
  return compactLabel(`${basename} note ${title}${status}`);
}

function normalizeGraphSourceFile(value: string | null | undefined): string {
  return slash(value ?? "").replace(/^\.?\//, "").toLowerCase();
}

function readGraphifyAnchorSourceFiles(vaultRoot: string, relPaths?: Iterable<string>): Array<{
  file: string;
  relPath: string;
  markdown: string;
}> {
  const files: Array<{ file: string; relPath: string; markdown: string }> = [];
  const candidates = relPaths
    ? [...new Set([...relPaths].map((relPath) => slash(relPath)).filter((relPath) => relPath.endsWith(".md")))]
    : [];
  for (const relPath of candidates) {
    if (relPath.startsWith("../") || path.isAbsolute(relPath)) continue;
    if (!relPath.includes("/")) {
      if (!GRAPHIFY_ALLOWED_TOP_LEVEL_FILES.has(relPath.toLowerCase())) continue;
    } else {
      const [topLevel] = relPath.split("/", 1);
      if (!GRAPHIFY_ALLOWED_TOP_LEVEL_DIRS.has(topLevel ?? "")) continue;
    }
    const file = path.join(vaultRoot, relPath);
    try {
      files.push({ file, relPath, markdown: fs.readFileSync(file, "utf8") });
    } catch {
      // Best-effort anchor generation; unreadable notes are skipped.
    }
  }
  return files;
}

function collectGraphSourceRelPaths(graph: GraphifyGraph): string[] {
  const relPaths = new Set<string>();
  for (const node of Array.isArray(graph.nodes) ? graph.nodes : []) {
    const source = normalizeGraphSourceFile(node.source_file);
    if (source.endsWith(".md")) relPaths.add(source);
  }
  for (const edge of Array.isArray(graph.edges) ? graph.edges : []) {
    const source = normalizeGraphSourceFile(edge.source_file);
    if (source.endsWith(".md")) relPaths.add(source);
  }
  return [...relPaths];
}

function hasAnyGraphifySourceMarkdownFile(vaultRoot: string): boolean {
  for (const file of GRAPHIFY_ALLOWED_TOP_LEVEL_FILES) {
    if (fs.existsSync(path.join(vaultRoot, file))) return true;
  }
  for (const dir of GRAPHIFY_ALLOWED_TOP_LEVEL_DIRS) {
    const fullDir = path.join(vaultRoot, dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(fullDir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))) {
      return true;
    }
  }
  return false;
}

function resolveWikilinkTargetRelPath(vaultRoot: string, target: string): string | null {
  const clean = target.split("#")[0]?.trim() ?? "";
  if (!clean || /^[a-z]+:/i.test(clean)) return null;
  const normalized = stripMd(slash(clean).replace(/^\/+/, ""));
  const candidates = normalized.includes("/")
    ? [`${normalized}.md`]
    : [
        `issues/${normalized}.md`,
        `agents/${normalized}.md`,
        `decisions/${normalized}.md`,
        `comments/${normalized}.md`,
        `projects/${normalized}.md`,
        `${normalized}.md`,
      ];
  for (const candidate of candidates) {
    const relPath = slash(candidate);
    if (fs.existsSync(path.join(vaultRoot, relPath))) return relPath;
  }
  return null;
}

function addGraphNode(nodes: GraphifyNode[], byId: Map<string, GraphifyNode>, node: GraphifyNode): boolean {
  const existing = byId.get(node.id);
  if (existing) {
    const before = JSON.stringify(existing);
    Object.assign(existing, node);
    return JSON.stringify(existing) !== before;
  }
  nodes.push(node);
  byId.set(node.id, node);
  return true;
}

function edgeKey(edge: Pick<GraphifyEdge, "source" | "target" | "relation">): string {
  return `${edge.source}\n${edge.target}\n${edge.relation}`;
}

function addGraphEdge(edges: GraphifyEdge[], edgeKeys: Set<string>, edge: GraphifyEdge): boolean {
  const key = edgeKey(edge);
  if (edgeKeys.has(key)) return false;
  edges.push(edge);
  edgeKeys.add(key);
  return true;
}

function dedupeGraphInPlace(nodes: GraphifyNode[], edges: GraphifyEdge[]): void {
  const seenNodeIds = new Set<string>();
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const id = nodes[index]?.id;
    if (!id) {
      nodes.splice(index, 1);
      continue;
    }
    if (seenNodeIds.has(id)) nodes.splice(index, 1);
    else seenNodeIds.add(id);
  }

  const seenEdges = new Set<string>();
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index];
    if (!edge?.source || !edge.target || !edge.relation) {
      edges.splice(index, 1);
      continue;
    }
    const key = edgeKey(edge);
    if (seenEdges.has(key)) edges.splice(index, 1);
    else seenEdges.add(key);
  }
}

export function augmentGraphifyGraphWithVaultAnchors(vaultRoot: string, relPaths?: Iterable<string>): {
  nodesAdded: number;
  nodesUpdated: number;
  edgesAdded: number;
} {
  const graphFile = graphifyGraphFile(vaultRoot);
  let graph: GraphifyGraph;
  try {
    graph = JSON.parse(fs.readFileSync(graphFile, "utf8")) as GraphifyGraph;
  } catch {
    return { nodesAdded: 0, nodesUpdated: 0, edgesAdded: 0 };
  }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  graph.nodes = nodes;
  graph.edges = edges;
  const originalNodeCount = nodes.length;
  const originalEdgeCount = edges.length;
  dedupeGraphInPlace(nodes, edges);
  const dedupedNodes = originalNodeCount - nodes.length;
  const dedupedEdges = originalEdgeCount - edges.length;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edgeKeys = new Set(edges.map(edgeKey));
  const anchorsByRelPath = new Map<string, string>();
  const anchorsByBasename = new Map<string, string>();
  const existingNodeIdsBySource = new Map<string, string[]>();

  for (const node of nodes) {
    const source = normalizeGraphSourceFile(node.source_file);
    if (!source) continue;
    const list = existingNodeIdsBySource.get(source) ?? [];
    list.push(node.id);
    existingNodeIdsBySource.set(source, list);
  }

  let nodesAdded = 0;
  let nodesUpdated = 0;
  let edgesAdded = 0;
  const maxAnchorSourceFiles = Math.max(
    0,
    Math.floor(
      Number.isFinite(GRAPHIFY_MAX_ANCHOR_SOURCE_FILES)
        ? GRAPHIFY_MAX_ANCHOR_SOURCE_FILES
        : 250,
    ),
  );
  const sourceFiles = readGraphifyAnchorSourceFiles(
    vaultRoot,
    relPaths ?? collectGraphSourceRelPaths(graph),
  ).slice(0, maxAnchorSourceFiles);
  for (const source of sourceFiles) {
    const normalizedRelPath = normalizeGraphSourceFile(source.relPath);
    const basename = path.posix.basename(slash(source.relPath), ".md");
    const prefix = normalizedRelPath.startsWith("issues/")
      ? "issue"
      : normalizedRelPath.startsWith("agents/")
        ? "agent"
        : "note";
    const id = stableGraphId(prefix, basename);
    anchorsByRelPath.set(normalizedRelPath, id);
    anchorsByBasename.set(stripMd(basename).toLowerCase(), id);
    const beforeExists = byId.has(id);
    const changed = addGraphNode(nodes, byId, {
      id,
      label: buildAnchorLabel(source.relPath, source.markdown),
      file_type: prefix === "issue" ? "issue" : prefix === "agent" ? "agent" : "document",
      source_file: source.relPath,
      source_location: null,
      source_url: null,
      captured_at: null,
      author: null,
      contributor: null,
    });
    if (!beforeExists) nodesAdded += 1;
    else if (changed) nodesUpdated += 1;
  }

  for (const [sourceRelPath, anchorId] of anchorsByRelPath) {
    const sameSourceIds = existingNodeIdsBySource.get(sourceRelPath) ?? [];
    for (const nodeId of sameSourceIds) {
      if (nodeId === anchorId) continue;
      if (
        addGraphEdge(edges, edgeKeys, {
          source: anchorId,
          target: nodeId,
          relation: "contains_extracted_node",
          confidence: "DETERMINISTIC",
          confidence_score: 1,
          source_file: sourceRelPath,
          source_location: null,
          weight: 1,
        })
      ) {
        edgesAdded += 1;
      }
    }
  }

  let followedWikilinks = 0;
  const maxFollowedWikilinks = Math.max(
    0,
    Math.floor(Number.isFinite(GRAPHIFY_MAX_ANCHOR_WIKILINKS) ? GRAPHIFY_MAX_ANCHOR_WIKILINKS : 500),
  );
  for (const source of sourceFiles) {
    const sourceRelPath = normalizeGraphSourceFile(source.relPath);
    const anchorId = anchorsByRelPath.get(sourceRelPath);
    if (!anchorId) continue;
    for (const match of source.markdown.matchAll(/\[\[([^\]]+)\]\]/g)) {
      if (followedWikilinks >= maxFollowedWikilinks) break;
      const body = match[1] ?? "";
      const target = body.split("|")[0]?.split("#")[0]?.trim() ?? "";
      const resolvedTarget = resolveWikilinkTargetRelPath(vaultRoot, target);
      if (!resolvedTarget) continue;
      followedWikilinks += 1;
      if (!anchorsByRelPath.has(normalizeGraphSourceFile(resolvedTarget))) {
        for (const targetSource of readGraphifyAnchorSourceFiles(vaultRoot, [resolvedTarget])) {
          const targetRelPath = normalizeGraphSourceFile(targetSource.relPath);
          const targetBasename = path.posix.basename(slash(targetSource.relPath), ".md");
          const targetPrefix = targetRelPath.startsWith("issues/")
            ? "issue"
            : targetRelPath.startsWith("agents/")
              ? "agent"
              : "note";
          const targetId = stableGraphId(targetPrefix, targetBasename);
          anchorsByRelPath.set(targetRelPath, targetId);
          anchorsByBasename.set(stripMd(targetBasename).toLowerCase(), targetId);
          const beforeExists = byId.has(targetId);
          const changed = addGraphNode(nodes, byId, {
            id: targetId,
            label: buildAnchorLabel(targetSource.relPath, targetSource.markdown),
            file_type: targetPrefix === "issue" ? "issue" : targetPrefix === "agent" ? "agent" : "document",
            source_file: targetSource.relPath,
            source_location: null,
            source_url: null,
            captured_at: null,
            author: null,
            contributor: null,
          });
          if (!beforeExists) nodesAdded += 1;
          else if (changed) nodesUpdated += 1;
        }
      }
      const normalizedTarget = normalizeGraphSourceFile(resolvedTarget);
      const targetAnchorId =
        anchorsByRelPath.get(normalizedTarget) ??
        anchorsByRelPath.get(normalizeGraphSourceFile(target)) ??
        anchorsByBasename.get(stripMd(slash(target)).toLowerCase());
      if (!targetAnchorId || targetAnchorId === anchorId) continue;
      if (
        addGraphEdge(edges, edgeKeys, {
          source: anchorId,
          target: targetAnchorId,
          relation: "wikilinks_to",
          confidence: "DETERMINISTIC",
          confidence_score: 1,
          source_file: sourceRelPath,
          source_location: null,
          weight: 1,
        })
      ) {
        edgesAdded += 1;
      }
    }
  }

  if (nodesAdded > 0 || nodesUpdated > 0 || edgesAdded > 0 || dedupedNodes > 0 || dedupedEdges > 0) {
    fs.writeFileSync(graphFile, JSON.stringify(graph, null, 2), "utf8");
  }
  return { nodesAdded, nodesUpdated: nodesUpdated + dedupedNodes, edgesAdded };
}

function backupGraphifyGraphIfUseful(vaultRoot: string): boolean {
  const graphFile = graphifyGraphFile(vaultRoot);
  const nodeCount = readGraphNodeCount(graphFile);
  if (nodeCount == null || nodeCount <= 0) return false;
  try {
    const backupFile = graphifyGraphBackupFile(vaultRoot);
    const backupNodeCount = readGraphNodeCount(backupFile);
    if (backupNodeCount != null && backupNodeCount > nodeCount) return false;
    fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    fs.copyFileSync(graphFile, backupFile);
    return true;
  } catch {
    return false;
  }
}

export function validateGraphifyGraphOutput(vaultRoot: string): {
  nodeCount: number | null;
  sourceFiles: number;
  minimumExpectedNodes: number;
  isDegraded: boolean;
  restoredBackup: boolean;
} {
  const graphFile = graphifyGraphFile(vaultRoot);
  augmentGraphifyGraphWithVaultAnchors(vaultRoot);
  const nodeCount = readGraphNodeCount(graphFile);
  let sourceFiles = 0;
  try {
    sourceFiles = collectGraphSourceRelPaths(
      JSON.parse(fs.readFileSync(graphFile, "utf8")) as GraphifyGraph,
    ).length;
  } catch {
    sourceFiles = 0;
  }
  if (sourceFiles === 0 && hasAnyGraphifySourceMarkdownFile(vaultRoot)) {
    sourceFiles = 1;
  }
  const minimumExpectedNodes =
    sourceFiles >= 100 ? Math.max(10, Math.floor(sourceFiles * 0.005)) : 1;
  const isDegraded = nodeCount == null || nodeCount < minimumExpectedNodes;
  if (!isDegraded) {
    backupGraphifyGraphIfUseful(vaultRoot);
    return {
      nodeCount,
      sourceFiles,
      minimumExpectedNodes,
      isDegraded: false,
      restoredBackup: false,
    };
  }

  const backupFile = graphifyGraphBackupFile(vaultRoot);
  const backupNodeCount = readGraphNodeCount(backupFile);
  const backupIsUseful =
    backupNodeCount != null &&
    backupNodeCount >= minimumExpectedNodes &&
    backupNodeCount > (nodeCount ?? 0);
  if (sourceFiles > 0 && backupIsUseful) {
    try {
      fs.copyFileSync(backupFile, graphFile);
      return {
        nodeCount,
        sourceFiles,
        minimumExpectedNodes,
        isDegraded: true,
        restoredBackup: true,
      };
    } catch {
      return {
        nodeCount,
        sourceFiles,
        minimumExpectedNodes,
        isDegraded: true,
        restoredBackup: false,
      };
    }
  }

  return {
    nodeCount,
    sourceFiles,
    minimumExpectedNodes,
    isDegraded: true,
    restoredBackup: false,
  };
}

function safePositiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function safePositiveMs(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function isProcessAlive(pid: number | null | undefined): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "EPERM";
  }
}

function readGraphifyExtractLockMetadata(
  lockDir: string,
): GraphifyExtractLockMetadata | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(lockDir, "metadata.json"), "utf8"),
    ) as GraphifyExtractLockMetadata;
  } catch {
    return null;
  }
}

function lockDirectoryAgeMs(lockDir: string): number | null {
  try {
    return Date.now() - fs.statSync(lockDir).mtimeMs;
  } catch {
    return null;
  }
}

function graphifyExtractLockIsStale(lockDir: string, staleMs: number): boolean {
  const metadata = readGraphifyExtractLockMetadata(lockDir);
  const startedAt = metadata?.startedAt ? Date.parse(metadata.startedAt) : Number.NaN;
  const ageMs = Number.isFinite(startedAt)
    ? Date.now() - startedAt
    : lockDirectoryAgeMs(lockDir);
  const ageIsStale = ageMs == null || ageMs >= staleMs;

  if (metadata?.pid) {
    return !isProcessAlive(metadata.pid) || ageIsStale;
  }
  if (metadata?.parentPid && isProcessAlive(metadata.parentPid) && !ageIsStale) {
    return false;
  }
  return ageIsStale;
}

export function tryAcquireGraphifyExtractLock(
  lockDir = GRAPHIFY_LOCK_DIR,
  staleMs = GRAPHIFY_LOCK_STALE_MS,
): GraphifyExtractLock | null {
  const owner = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const create = (): GraphifyExtractLock | null => {
    try {
      fs.mkdirSync(lockDir);
      const lock = { dir: lockDir, owner };
      writeGraphifyExtractLockMetadata(lock, {
        owner,
        pid: null,
        parentPid: process.pid,
        startedAt: new Date().toISOString(),
        vault: VAULT,
      });
      return lock;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EEXIST") return null;
      return null;
    }
  };

  const first = create();
  if (first) return first;
  if (!graphifyExtractLockIsStale(lockDir, safePositiveMs(staleMs, 6 * 60 * 60 * 1000))) {
    return null;
  }

  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch {
    return null;
  }
  return create();
}

function writeGraphifyExtractLockMetadata(
  lock: GraphifyExtractLock,
  metadata: GraphifyExtractLockMetadata,
): void {
  try {
    fs.writeFileSync(
      path.join(lock.dir, "metadata.json"),
      JSON.stringify({ ...metadata, owner: lock.owner }, null, 2),
      "utf8",
    );
  } catch {
    // Best-effort metadata; the lock directory itself is the authoritative lock.
  }
}

export function releaseGraphifyExtractLock(lock: GraphifyExtractLock): void {
  const metadata = readGraphifyExtractLockMetadata(lock.dir);
  if (metadata?.owner && metadata.owner !== lock.owner) return;
  try {
    fs.rmSync(lock.dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup. Stale lock cleanup handles leftovers on later ticks.
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;

  const headBudget = Math.max(4_000, Math.floor(maxBytes * 0.35));
  const tailBudget = Math.max(4_000, maxBytes - headBudget - 500);
  const charsPerByteFloor = 4;
  let head = value.slice(0, Math.floor(headBudget / charsPerByteFloor));
  while (Buffer.byteLength(head, "utf8") > headBudget) head = head.slice(0, -1);

  let tail = value.slice(-Math.floor(tailBudget / charsPerByteFloor));
  while (Buffer.byteLength(tail, "utf8") > tailBudget) tail = tail.slice(1);

  return [
    head.trimEnd(),
    "",
    `<!-- graphify compact corpus omitted middle of large note; original size ${Buffer.byteLength(value, "utf8")} bytes -->`,
    "",
    tail.trimStart(),
  ].join("\n");
}

function compactIssueNote(body: string, maxBytes: number): string {
  if (Buffer.byteLength(body, "utf8") <= maxBytes) return body;

  const lines = body.split(/\r?\n/);
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith("## ") && current.length > 0) {
      sections.push(current.join("\n"));
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) sections.push(current.join("\n"));

  const prelude = sections.shift() ?? body;
  const preferred = sections.filter((section) =>
    /^## (Summary|Durable Facts|Next Action)\b/m.test(section),
  );
  const dated = sections.filter((section) =>
    /^## \d{4}-\d{2}-\d{2}\b/m.test(section) || /^## \[\d{4}-\d{2}-\d{2}/m.test(section),
  );
  const recent = dated.slice(-3);

  const compact = [
    prelude.trim(),
    ...preferred.map((section) => section.trim()),
    ...recent
      .filter((section, index, array) => array.findIndex((candidate) => candidate === section) === index)
      .map((section) => section.trim()),
  ]
    .filter((section, index, array) => section.length > 0 && array.indexOf(section) === index)
    .join("\n\n");

  return truncateUtf8(compact, maxBytes);
}

function writeFileIfChanged(file: string, body: string): boolean {
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === body) return false;
  } catch {
    // Fall through and rewrite; compact corpus writes are best-effort.
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
  return true;
}

function removeStaleCorpusFiles(corpusRoot: string, desiredRelPaths: Set<string>): number {
  let removed = 0;
  const root = path.resolve(corpusRoot);
  const stack = [corpusRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (DEFAULT_WALK_EXCLUDED_DIRS.has(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const rel = slash(path.relative(corpusRoot, full));
      if (desiredRelPaths.has(rel)) continue;
      const resolved = path.resolve(full);
      if (!resolved.startsWith(root + path.sep)) continue;
      try {
        fs.rmSync(full, { force: true });
        removed += 1;
      } catch {
        // Best-effort cleanup; stale compact notes are less harmful than hook failure.
      }
    }
  }
  return removed;
}

export function prepareGraphifyCompactCorpus(
  vaultRoot: string,
  corpusRoot: string,
  maxDocBytes = GRAPHIFY_MAX_DOC_BYTES,
  maxIssueFiles = GRAPHIFY_MAX_ISSUE_FILES,
): { files: number; truncated: number; written: number; removed: number } {
  const byteLimit = safePositiveInt(maxDocBytes, 80_000);
  const issueLimit = Math.max(0, Math.floor(Number.isFinite(maxIssueFiles) ? maxIssueFiles : 250));
  const maxAgentFiles = Number(process.env.PAPERCLIP_GRAPHIFY_MAX_AGENT_FILES ?? 0);
  const agentLimit = Math.max(
    0,
    Math.floor(Number.isFinite(maxAgentFiles) ? maxAgentFiles : 12),
  );
  const desired = new Set<string>();
  let files = 0;
  let truncated = 0;
  let written = 0;
  const sources = walkGraphifySourceMarkdownFiles(vaultRoot);
  const issueCandidates = sources
    .filter((source) => slash(path.relative(vaultRoot, source)).startsWith("issues/"))
    .map((source) => {
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(source).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { source, mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs || left.source.localeCompare(right.source));
  const allowedIssues =
    issueLimit > 0
      ? new Set(issueCandidates.slice(0, issueLimit).map((entry) => entry.source))
      : new Set<string>();
  const agentCandidates = sources
    .filter((source) => slash(path.relative(vaultRoot, source)).startsWith("agents/"))
    .map((source) => {
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(source).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { source, mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs || left.source.localeCompare(right.source));
  const allowedAgents =
    agentLimit > 0
      ? new Set(agentCandidates.slice(0, agentLimit).map((entry) => entry.source))
      : new Set<string>();

  for (const source of sources) {
    const rel = slash(path.relative(vaultRoot, source));
    if (rel.startsWith("../") || path.isAbsolute(rel)) continue;
    const [topLevel] = rel.split("/", 1);
    if (!rel.includes("/")) {
      if (!GRAPHIFY_ALLOWED_TOP_LEVEL_FILES.has(rel.toLowerCase())) continue;
    } else if (!GRAPHIFY_ALLOWED_TOP_LEVEL_DIRS.has(topLevel ?? "")) {
      continue;
    }
    if (rel.startsWith("issues/") && issueLimit > 0 && !allowedIssues.has(source)) continue;
    if (rel.startsWith("agents/") && agentLimit > 0 && !allowedAgents.has(source)) continue;
    desired.add(rel);
    files += 1;

    let body: string;
    try {
      body = fs.readFileSync(source, "utf8");
    } catch {
      continue;
    }

    const compact = rel.startsWith("issues/")
      ? compactIssueNote(body, byteLimit)
      : truncateUtf8(body, byteLimit);
    if (compact !== body) truncated += 1;
    if (writeFileIfChanged(path.join(corpusRoot, rel), compact)) written += 1;
  }

  const removed = removeStaleCorpusFiles(corpusRoot, desired);
  return { files, truncated, written, removed };
}

function graphifyExtractTarget(): string | null {
  if (GRAPHIFY_CORPUS_MODE === "vault") return VAULT;
  try {
    prepareGraphifyCompactCorpus(VAULT, GRAPHIFY_CORPUS_DIR);
    return GRAPHIFY_CORPUS_DIR;
  } catch {
    return null;
  }
}

type GraphifyBackendSelection = {
  backend: string;
  model: string | null;
  tokenBudget: number;
};

function graphifyBackendForAdapter(adapterType: string | null | undefined): string | null {
  const normalized = String(adapterType ?? "").trim().toLowerCase();
  switch (normalized) {
    case "claude":
    case "claude_local":
      return "claude-cli";
    case "codex":
    case "codex_local":
      return "codex";
    default:
      return null;
  }
}

function defaultGraphifyModelForBackend(backend: string): string | null {
  return backend === "ollama" ? "qwen3.5:9b" : null;
}

export function resolveGraphifyBackendSelection(
  adapterType: string | null | undefined,
): GraphifyBackendSelection | null {
  const backend = GRAPHIFY_BACKEND_OVERRIDE ?? graphifyBackendForAdapter(adapterType);
  if (!backend) return null;
  return {
    backend,
    model: GRAPHIFY_MODEL_OVERRIDE ?? defaultGraphifyModelForBackend(backend),
    tokenBudget: safePositiveInt(
      GRAPHIFY_TOKEN_BUDGET,
      backend === "ollama" ? 4_096 : 60_000,
    ),
  };
}

/**
 * Fire-and-forget `graphify extract <vault>` to refresh the agent-memory
 * knowledge graph. Driven by a periodic timer (not per-run) so server load is
 * predictable. Errors are swallowed; failures never block the heartbeat hook.
 * The resulting graph powers `graphify query "..."` for agents.
 */
function runGraphifyExtract(): void {
  if (GRAPHIFY_DISABLED) return;
  if (!GRAPHIFY_BIN_RESOLVED) return; // graphify not installed — silently skip
  if (graphifyInFlight) return;
  if (!fs.existsSync(VAULT)) return; // vault missing — nothing to index
  const extractTarget = graphifyExtractTarget();
  if (!extractTarget) return;
  const backendSelection = resolveGraphifyBackendSelection(graphifyCallerAdapterType);
  if (!backendSelection) return;
  const args = [
    "extract",
    extractTarget,
    "--backend",
    backendSelection.backend,
    ...(backendSelection.model ? ["--model", backendSelection.model] : []),
    "--token-budget",
    String(backendSelection.tokenBudget),
    "--max-concurrency",
    "1",
    "--api-timeout",
    String(safePositiveInt(GRAPHIFY_API_TIMEOUT_SECONDS, 900)),
    "--out",
    VAULT,
    "--no-cluster",
  ];
  const lock = tryAcquireGraphifyExtractLock();
  if (!lock) return;
  graphifyInFlight = true;
  let logFd: number | null = null;
  try {
    backupGraphifyGraphIfUseful(VAULT);
    try {
      const logFile = graphifyExtractLogFile(VAULT);
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      logFd = fs.openSync(logFile, "w");
    } catch {
      logFd = null;
    }
    // `extract` has built-in caching, so only new/changed files are re-processed.
    // `--no-cluster` keeps it fast; clustering can be re-run on demand later.
    // `--max-concurrency 1` is required for local LLMs (per graphify CLI docs).
    // No `shell: true` — we resolved the absolute path so cmd.exe is unnecessary.
    const child = spawn(GRAPHIFY_BIN_RESOLVED, args, {
      detached: false,
      stdio: logFd == null ? "ignore" : ["ignore", logFd, logFd],
      windowsHide: true,
      env: {
        ...process.env,
        ...(backendSelection.backend === "ollama" && !process.env.OLLAMA_API_KEY
          ? { OLLAMA_API_KEY: "local" }
          : {}),
      },
    });
    writeGraphifyExtractLockMetadata(lock, {
      pid: child.pid ?? null,
      parentPid: process.pid,
      startedAt: new Date().toISOString(),
      target: extractTarget,
      vault: VAULT,
      command: [GRAPHIFY_BIN_RESOLVED, ...args],
    });
    const finish = () => {
      if (logFd != null) {
        try {
          fs.closeSync(logFd);
        } catch {
          // Best-effort cleanup.
        }
        logFd = null;
      }
      releaseGraphifyExtractLock(lock);
      graphifyInFlight = false;
    };
    child.on("error", finish);
    child.on("close", () => {
      sanitizeVaultMemoryOutputs();
      validateGraphifyGraphOutput(VAULT);
      finish();
    });
    child.unref();
  } catch {
    releaseGraphifyExtractLock(lock);
    graphifyInFlight = false;
  }
}

/**
 * Idempotent: starts the periodic timer once. Called lazily from the hook so
 * we don't pay the cost in test environments that never invoke the hook.
 * Module-level `graphifyTimer` guards against duplicate timers.
 */
function ensureGraphifyTimer(): void {
  if (GRAPHIFY_DISABLED) return;
  if (!GRAPHIFY_BIN_RESOLVED) return;
  if (graphifyTimer) return;
  graphifyTimer = setInterval(runGraphifyExtract, GRAPHIFY_INTERVAL_MS);
  graphifyTimer.unref(); // don't keep the event loop alive just for this
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${TZ_LABEL}`;
}

function ensureAgentPage(slug: string, name: string, role: string): boolean {
  const file = path.join(VAULT, "agents", `${slug}.md`);
  if (fs.existsSync(file)) return false;
  const today = new Date().toISOString().slice(0, 10);
  const body = `---
title: ${name} agent
created: ${today}
updated: ${today}
type: agent
tags: [paperclip, agent]
status: active
sources: []
---

# ${name}

## Role

${role || "TODO: describe responsibility lane and primary deliverables."}

## Durable Health Note

TODO: capture recurring blockers, adapter quirks, or restart hazards as they accrue.

## Handling Rule

TODO: document the playbook the agent should follow on resume.

## Latest Evidence

- Page scaffolded by vault-memory-hook on ${today}.
`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return true;
}

function ensureIssuePage(issueId: string): void {
  const file = path.join(VAULT, "issues", `${issueId}.md`);
  if (fs.existsSync(file)) return;
  const today = new Date().toISOString().slice(0, 10);
  const body = `---
title: ${issueId}
created: ${today}
updated: ${today}
type: issue
tags: [paperclip, issue]
status: needs-update
sources: []
---

# ${issueId}

## Summary

TODO: scaffolded by vault-memory-hook. Owning agent should fill in next wake.

## Durable Facts

- TODO

## Next Action

- TODO
`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/**
 * Build a compact, append-only digest from the run record. This is a fallback
 * for when the agent itself failed to write durable memory — we'd rather have
 * a noisy auto-digest than an empty page that says "TODO".
 */
function buildFallbackDigest(opts: {
  stamp: string;
  agentName: string;
  agentSlug: string;
  runId: string;
  status: string;
  resultText: string;
  nextAction: string | null | undefined;
}): string {
  const clip = (s: string | null | undefined, n: number): string => {
    if (!s) return "";
    const trimmed = s.trim();
    if (trimmed.length <= n) return trimmed;
    return trimmed.slice(0, n) + "…";
  };

  // Try to surface a one-line summary from result_json if it's structured.
  let summary = "";
  try {
    const parsed = JSON.parse(opts.resultText || "null");
    if (parsed && typeof parsed === "object") {
      const candidate =
        (parsed as Record<string, unknown>).summary ??
        (parsed as Record<string, unknown>).message ??
        (parsed as Record<string, unknown>).result ??
        (parsed as Record<string, unknown>).output;
      if (typeof candidate === "string") summary = clip(candidate, 400);
    }
  } catch {
    summary = clip(opts.resultText, 400);
  }

  const lines = [
    "",
    `## [${opts.stamp}] auto-digest by [[${opts.agentSlug}]] (hook-written)`,
    `- Run: \`${opts.runId.slice(0, 8)}\` status=${opts.status}; agent did not write durable memory, hook captured this digest.`,
  ];
  if (summary) lines.push(`- Summary: ${summary}`);
  if (opts.nextAction) lines.push(`- Next action (from run): ${clip(opts.nextAction, 400)}`);
  return lines.join("\n") + "\n";
}

function appendFallbackDigest(
  issueId: string,
  digest: string,
): void {
  const file = path.join(VAULT, "issues", `${issueId}.md`);
  try {
    fs.appendFileSync(file, digest);
  } catch {
    // swallow — vault writes are best-effort
  }
}

function issuePageUpdatedSince(issueId: string, since: Date): boolean {
  const file = path.join(VAULT, "issues", `${issueId}.md`);
  try {
    const st = fs.statSync(file);
    return st.mtime.getTime() >= since.getTime();
  } catch {
    return false;
  }
}

function extractIssueIds(text: string): string[] {
  const set = new Set<string>();
  for (const m of text.matchAll(ISSUE_RE)) set.add(m[0]);
  return [...set];
}

function readIssueIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === "string" && (entry.match(ISSUE_RE)?.length ?? 0) > 0,
  );
}

function extractIssueIdsFromRunContext(contextSnapshot: Record<string, unknown> | null | undefined): string[] {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return [];
  const set = new Set<string>();
  const scalarCandidates = [
    contextSnapshot.issueId,
    contextSnapshot.taskId,
    contextSnapshot.sourceIssueId,
  ];
  for (const candidate of scalarCandidates) {
    if (typeof candidate !== "string") continue;
    for (const match of candidate.match(ISSUE_RE) ?? []) set.add(match);
  }
  for (const candidate of readIssueIdList(contextSnapshot.issueIds)) set.add(candidate);
  for (const candidate of readIssueIdList(contextSnapshot.sourceIssueIds)) set.add(candidate);
  return [...set];
}

export function collectTouchedIssueIds(opts: {
  contextSnapshot?: Record<string, unknown> | null;
  resultText?: string | null;
  nextAction?: string | null;
}): string[] {
  const set = new Set<string>();
  for (const id of extractIssueIdsFromRunContext(opts.contextSnapshot)) set.add(id);
  for (const id of extractIssueIds(`${opts.resultText ?? ""}\n${opts.nextAction ?? ""}`)) set.add(id);
  return [...set];
}

function summarizeIssueRefs(issueIds: string[], limit = 12): string {
  if (issueIds.length === 0) return "no issue touched";
  const shown = issueIds.slice(0, limit).map((id) => `[[${id}]]`);
  const remaining = issueIds.length - shown.length;
  return remaining > 0 ? `${shown.join(", ")} (+${remaining} more)` : shown.join(", ");
}

function upsertFrontmatterUpdated(markdown: string, yyyyMmDd: string): string {
  if (!markdown.startsWith("---\n")) return markdown;
  return markdown.replace(/^updated:\s.*$/m, `updated: ${yyyyMmDd}`);
}

function appendIfMissing(file: string, marker: string, block: string): void {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (existing.includes(marker)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, existing + block, "utf8");
}

export function ensureVaultDailyPage(dateKey: string, vaultRoot = VAULT): string {
  const dailyDir = path.join(vaultRoot, "daily");
  const file = path.join(dailyDir, `${dateKey}.md`);
  if (!fs.existsSync(file)) {
    const body = `---
title: ${dateKey}
created: ${dateKey}
updated: ${dateKey}
type: run
tags: [paperclip, daily]
status: active
sources: []
---

# ${dateKey}
`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
  } else {
    const current = fs.readFileSync(file, "utf8");
    const updated = upsertFrontmatterUpdated(current, dateKey);
    if (updated !== current) fs.writeFileSync(file, updated, "utf8");
  }
  return file;
}

export function ensureParaDailyPage(dateKey: string, vaultRoot = VAULT): string {
  const file = path.join(path.dirname(vaultRoot), `${dateKey}.md`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `# ${dateKey}\n`, "utf8");
  }
  return file;
}

function appendDailyEntries(opts: {
  stamp: string;
  dateKey: string;
  agentSlug: string;
  agentName: string;
  runId: string;
  status: string;
  touched: string[];
  missed: string[];
  summary: string;
  nextAction: string | null | undefined;
}): void {
  const touchedSummary = summarizeIssueRefs(opts.touched, 10);
  const missedSummary = opts.missed.length > 0 ? summarizeIssueRefs(opts.missed, 10) : "none";
  const summary = opts.summary || "No structured summary recorded.";
  const nextAction = opts.nextAction?.trim() || "None recorded.";

  const vaultMarker = `- Run: \`${opts.runId.slice(0, 8)}\` status=\`${opts.status}\`.`;
  const vaultEntry = [
    "",
    `## [${opts.stamp}] [[${opts.agentSlug}]] heartbeat`,
    vaultMarker,
    `- Touched: ${touchedSummary}.`,
    `- Durable writes missed: ${missedSummary}.`,
    `- Summary: ${summary}`,
    `- Next: ${nextAction}`,
    "",
  ].join("\n");
  appendIfMissing(ensureVaultDailyPage(opts.dateKey), vaultMarker, vaultEntry);

  const paraMarker = `## ${opts.stamp} — ${opts.agentName}`;
  const paraEntry = [
    "",
    paraMarker,
    `- Run: \`${opts.runId.slice(0, 8)}\` status=\`${opts.status}\``,
    `- Touched: ${touchedSummary}`,
    `- Durable writes missed: ${missedSummary}`,
    `- Summary: ${summary}`,
    `- Next: ${nextAction}`,
    "",
  ].join("\n");
  appendIfMissing(ensureParaDailyPage(opts.dateKey), paraMarker, paraEntry);
}

/**
 * The actual hook. Registered under the name "vault-memory" against
 * `run.after.success`.
 */
export const vaultMemoryPostHook: PostHookHandler = async (ctx: LifecycleContext) => {
  const { agent, run } = ctx;
  if (!run.finishedAt) return;
  const finishedAt = run.finishedAt instanceof Date ? run.finishedAt : new Date(run.finishedAt);
  const startedAt = run.startedAt
    ? run.startedAt instanceof Date
      ? run.startedAt
      : new Date(run.startedAt)
    : new Date(finishedAt.getTime() - 30 * 60 * 1000);

  const slug = slugify(agent.name);
  ensureAgentPage(slug, agent.name, agent.role ?? "");

  // Prefer explicit run context plus structured summaries. Stdout excerpts are
  // too noisy and can mention hundreds of unrelated issue ids.
  const resultText =
    run.resultJson && typeof run.resultJson === "object"
      ? JSON.stringify(run.resultJson)
      : (run.resultJson as string | null) ?? "";
  const touched = collectTouchedIssueIds({
    contextSnapshot: run.contextSnapshot,
    resultText,
    nextAction: run.nextAction,
  });

  const stamp = fmtStamp(finishedAt);
  const dateKey = finishedAt.toISOString().slice(0, 10);
  const missed: string[] = [];
  for (const id of touched) {
    ensureIssuePage(id);
    if (!issuePageUpdatedSince(id, startedAt)) missed.push(id);
  }

  try {
    augmentGraphifyGraphWithVaultAnchors(VAULT, [
      `agents/${slug}.md`,
      ...touched.map((id) => `issues/${id}.md`),
    ]);
  } catch {
    // Best-effort graph search repair; heartbeat memory writes remain authoritative.
  }

  // Fallback: agent didn't update touched issue pages — write a hook-authored
  // digest so the page is no longer empty. Better noisy than blank.
  if (missed.length > 0) {
    const digest = buildFallbackDigest({
      stamp,
      agentName: agent.name,
      agentSlug: slug,
      runId: run.id,
      status: run.status,
      resultText,
      nextAction: run.nextAction,
    });
    for (const id of missed) appendFallbackDigest(id, digest);
  }

  let summary = "";
  try {
    const parsed = JSON.parse(resultText || "null");
    if (parsed && typeof parsed === "object") {
      const candidate =
        (parsed as Record<string, unknown>).summary ??
        (parsed as Record<string, unknown>).message ??
        (parsed as Record<string, unknown>).result ??
        (parsed as Record<string, unknown>).output;
      if (typeof candidate === "string") summary = candidate.trim().slice(0, 400);
    }
  } catch {
    summary = resultText.trim().slice(0, 400);
  }
  appendDailyEntries({
    stamp,
    dateKey,
    agentSlug: slug,
    agentName: agent.name,
    runId: run.id,
    status: run.status,
    touched,
    missed,
    summary,
    nextAction: run.nextAction,
  });

  const action = missed.length > 0 ? "noncompliant-autodigest" : "run";
  const touchedRef = summarizeIssueRefs(touched);
  const lines = [
    `\n## [${stamp}] ${action} | [[${slug}]] heartbeat`,
    `- Changed: ${agent.name} completed run ${run.id.slice(0, 8)} (\`${run.status}\`); touched ${touchedRef}.`,
    `- Evidence: heartbeat_run ${run.id}.`,
    missed.length > 0
      ? `- Next: [[${slug}]] missed durable writes on ${summarizeIssueRefs(missed)} — update those pages or justify in comment.`
      : `- Next: review surfaced facts for [[${slug}]] role page if material.`,
  ];
  fs.appendFileSync(path.join(VAULT, "log.md"), lines.join("\n") + "\n");

  // Make sure the periodic graphify-refresh timer is armed. Idempotent —
  // the first hook call after server start starts the timer; further calls
  // are no-ops. The timer uses the adapter from the latest successful local
  // run, so Claude-triggered refreshes route through Claude and Codex-triggered
  // refreshes route through Codex unless an operator override is configured.
  graphifyCallerAdapterType = agent.adapterType;
  ensureGraphifyTimer();
};
