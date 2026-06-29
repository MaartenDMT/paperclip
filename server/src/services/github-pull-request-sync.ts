import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issueWorkProducts } from "@paperclipai/db";
import { ghFetch, gitHubApiBase } from "./github-fetch.js";

type IssueWorkProductRow = typeof issueWorkProducts.$inferSelect;

export type GitHubPullRequestStatusSyncResult = {
  scanned: number;
  checked: number;
  updated: number;
  skippedFresh: number;
  skippedUnparseable: number;
  failed: number;
  workProductIds: string[];
  failures: Array<{
    workProductId: string;
    url: string | null;
    reason: string;
  }>;
};

type GitHubPullRequestRef = {
  hostname: string;
  owner: string;
  repo: string;
  number: string;
  externalId: string;
  url: string;
};

type GitHubPullRequestState = {
  status: "ready_for_review" | "draft" | "merged" | "closed";
  title: string | null;
  url: string | null;
  githubState: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  headRefName: string | null;
  baseRefName: string | null;
};

const DEFAULT_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 500;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseGitHubPullRequestRef(input: {
  externalId?: string | null;
  url?: string | null;
}): GitHubPullRequestRef | null {
  const fromExternalId = input.externalId?.match(/^([^/\s#]+)\/([^/\s#]+)#([0-9]+)$/);
  if (fromExternalId) {
    const owner = fromExternalId[1]!;
    const repo = fromExternalId[2]!;
    const number = fromExternalId[3]!;
    return {
      hostname: "github.com",
      owner,
      repo,
      number,
      externalId: `${owner}/${repo}#${number}`,
      url: `https://github.com/${owner}/${repo}/pull/${number}`,
    };
  }

  if (!input.url) return null;
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[2] !== "pull" || !/^[0-9]+$/.test(parts[3]!)) return null;
  const owner = parts[0]!;
  const repo = parts[1]!;
  const number = parts[3]!;
  return {
    hostname: parsed.hostname,
    owner,
    repo,
    number,
    externalId: `${owner}/${repo}#${number}`,
    url: `https://${parsed.hostname}/${owner}/${repo}/pull/${number}`,
  };
}

function githubHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  return {
    accept: "application/vnd.github+json",
    "user-agent": "paperclip-control-plane",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchGitHubPullRequestState(ref: GitHubPullRequestRef): Promise<GitHubPullRequestState> {
  const apiBase = gitHubApiBase(ref.hostname);
  const response = await ghFetch(
    `${apiBase}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pulls/${encodeURIComponent(ref.number)}`,
    { headers: githubHeaders() },
  );
  if (!response.ok) {
    throw new Error(`GitHub PR status fetch failed with HTTP ${response.status}`);
  }
  const body = await response.json() as Record<string, unknown>;
  const state = asString(body.state)?.toLowerCase() ?? null;
  const mergedAt = asString(body.merged_at);
  const closedAt = asString(body.closed_at);
  const draft = body.draft === true;
  const status = mergedAt
    ? "merged"
    : state === "closed"
      ? "closed"
      : draft
        ? "draft"
        : "ready_for_review";
  const head = asRecord(body.head);
  const base = asRecord(body.base);
  return {
    status,
    title: asString(body.title),
    url: asString(body.html_url),
    githubState: state,
    mergedAt,
    closedAt,
    headRefName: asString(head.ref),
    baseRefName: asString(base.ref),
  };
}

function lastSyncedAt(row: IssueWorkProductRow): Date | null {
  const metadata = asRecord(row.metadata);
  const sync = asRecord(metadata.githubStatusSync);
  const raw = asString(sync.syncedAt);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shouldSkipFresh(row: IssueWorkProductRow, now: Date, staleAfterMs: number, force: boolean) {
  if (force) return false;
  const syncedAt = lastSyncedAt(row);
  return syncedAt ? now.getTime() - syncedAt.getTime() < staleAfterMs : false;
}

export async function syncGitHubPullRequestWorkProducts(
  dbOrTx: Pick<Db, "select" | "update">,
  input: {
    companyId: string;
    issueIds?: string[];
    force?: boolean;
    limit?: number;
    staleAfterMs?: number;
    now?: Date;
  },
): Promise<GitHubPullRequestStatusSyncResult> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 2_000));
  const staleAfterMs = Math.max(0, input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
  const filters = [
    eq(issueWorkProducts.companyId, input.companyId),
    eq(issueWorkProducts.type, "pull_request"),
    eq(issueWorkProducts.provider, "github"),
  ];
  if (input.issueIds && input.issueIds.length > 0) {
    filters.push(inArray(issueWorkProducts.issueId, input.issueIds));
  }

  const rows = await dbOrTx
    .select()
    .from(issueWorkProducts)
    .where(and(...filters))
    .limit(limit);

  const result: GitHubPullRequestStatusSyncResult = {
    scanned: rows.length,
    checked: 0,
    updated: 0,
    skippedFresh: 0,
    skippedUnparseable: 0,
    failed: 0,
    workProductIds: [],
    failures: [],
  };

  for (const row of rows) {
    if (shouldSkipFresh(row, now, staleAfterMs, input.force === true)) {
      result.skippedFresh += 1;
      continue;
    }

    const ref = parseGitHubPullRequestRef({ externalId: row.externalId, url: row.url });
    if (!ref) {
      result.skippedUnparseable += 1;
      continue;
    }

    result.checked += 1;
    let state: GitHubPullRequestState;
    try {
      state = await fetchGitHubPullRequestState(ref);
    } catch (err) {
      result.failed += 1;
      result.failures.push({
        workProductId: row.id,
        url: row.url,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const metadata = {
      ...asRecord(row.metadata),
      githubStatusSync: {
        syncedAt: now.toISOString(),
        githubState: state.githubState,
        mergedAt: state.mergedAt,
        closedAt: state.closedAt,
        headRefName: state.headRefName,
        baseRefName: state.baseRefName,
      },
    };
    const nextTitle = state.title ?? row.title;
    const nextUrl = state.url ?? ref.url;
    const nextExternalId = ref.externalId;
    const changed = row.status !== state.status ||
      row.title !== nextTitle ||
      row.url !== nextUrl ||
      row.externalId !== nextExternalId ||
      JSON.stringify(asRecord(row.metadata).githubStatusSync ?? null) !== JSON.stringify(metadata.githubStatusSync);

    if (!changed) continue;

    await dbOrTx
      .update(issueWorkProducts)
      .set({
        externalId: nextExternalId,
        title: nextTitle,
        url: nextUrl,
        status: state.status,
        metadata,
        updatedAt: now,
      })
      .where(eq(issueWorkProducts.id, row.id));
    result.updated += 1;
    result.workProductIds.push(row.id);
  }

  return result;
}

