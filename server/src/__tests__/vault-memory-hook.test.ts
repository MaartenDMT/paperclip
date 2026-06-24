import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  augmentGraphifyGraphWithVaultAnchors,
  collectTouchedIssueIds,
  ensureParaDailyPage,
  ensureVaultDailyPage,
  normalizeVaultIssueLinks,
  prepareGraphifyCompactCorpus,
  releaseGraphifyExtractLock,
  resolveGraphifyBackendSelection,
  sanitizeGraphReportWikilinks,
  tryAcquireGraphifyExtractLock,
  validateGraphifyGraphOutput,
} from "../services/lifecycle-hooks/vault-memory-hook.ts";

const cleanupDirs = new Set<string>();

async function tempVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-vault-memory-"));
  cleanupDirs.add(dir);
  await fs.mkdir(path.join(dir, "issues"), { recursive: true });
  await fs.mkdir(path.join(dir, "graphify-out"), { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  cleanupDirs.clear();
});

describe("vault memory output sanitation", () => {
  it("normalizes project-root REA issue paths into vault-relative links", async () => {
    const vault = await tempVault();
    const issueFile = path.join(vault, "issues", "REA-1469.md");
    await fs.writeFile(issueFile, "# REA-1469\n", "utf8");

    const source = path.join(vault, "issues", "REA-1.md");
    await fs.writeFile(
      source,
      "See [[/REA/issues/REA-1469]] and [[/REA/issues/REA-1469|the issue]].\n",
      "utf8",
    );

    expect(normalizeVaultIssueLinks(vault)).toBe(2);
    await expect(fs.readFile(source, "utf8")).resolves.toBe(
      "See [[issues/REA-1469]] and [[issues/REA-1469|the issue]].\n",
    );
  });

  it("de-links generated report wikilinks that do not resolve to vault notes", async () => {
    const vault = await tempVault();
    await fs.writeFile(path.join(vault, "issues", "REA-1469.md"), "# REA-1469\n", "utf8");
    const report = path.join(vault, "graphify-out", "GRAPH_REPORT.md");
    await fs.writeFile(
      report,
      [
        "- [[_COMMUNITY_Community 0|Community 0]]",
        "- [[issues/REA-1469|REA-1469]]",
        "- [[), code:block3 ([REA-668]]",
        "",
      ].join("\n"),
      "utf8",
    );

    expect(sanitizeGraphReportWikilinks(vault)).toBe(2);
    await expect(fs.readFile(report, "utf8")).resolves.toBe(
      [
        "- Community 0",
        "- [[issues/REA-1469|REA-1469]]",
        "- ), code:block3 ([REA-668",
        "",
      ].join("\n"),
    );
  });

  it("de-links generated community links even when graphify report artifacts exist", async () => {
    const vault = await tempVault();
    await fs.mkdir(path.join(vault, "graphify-out", "obsidian"), { recursive: true });
    await fs.writeFile(
      path.join(vault, "graphify-out", "obsidian", "_COMMUNITY_Community 0.md"),
      "# Community 0\n",
      "utf8",
    );
    const report = path.join(vault, "graphify-out", "GRAPH_REPORT.md");
    await fs.writeFile(report, "- [[_COMMUNITY_Community 0|Community 0]]\n", "utf8");

    expect(sanitizeGraphReportWikilinks(vault)).toBe(1);
    await expect(fs.readFile(report, "utf8")).resolves.toBe("- Community 0\n");
  });
});

describe("vault memory issue selection", () => {
  it("prefers explicit run context and ignores unrelated issue ids in stdout-like text", () => {
    const touched = collectTouchedIssueIds({
      contextSnapshot: {
        issueId: "REA-1584",
        issueIds: ["REA-2511"],
        sourceIssueIds: ["REA-2436"],
      },
      resultText: JSON.stringify({ summary: "Resolved REA-1584 with REA-2511 context." }),
      nextAction: "Update REA-1584 and REA-2511 only.",
    });

    expect(touched).toEqual(["REA-1584", "REA-2511", "REA-2436"]);
  });
});

describe("daily memory pages", () => {
  it("creates vault and para daily notes in the expected locations", async () => {
    const vault = await tempVault();

    const vaultDaily = ensureVaultDailyPage("2026-05-22", vault);
    const paraDaily = ensureParaDailyPage("2026-05-22", vault);

    await expect(fs.readFile(vaultDaily, "utf8")).resolves.toContain("# 2026-05-22");
    await expect(fs.readFile(paraDaily, "utf8")).resolves.toContain("# 2026-05-22");
  });
});

describe("graphify compact corpus", () => {
  it("copies vault markdown into a compact corpus without generated graphify output", async () => {
    const vault = await tempVault();
    const corpus = path.join(vault, ".graphify-corpus");
    const issueFile = path.join(vault, "issues", "REA-252.md");
    const largeBody = `# REA-252\n\n${"older note\n".repeat(300)}\n## Latest\n${"newer note\n".repeat(300)}`;
    await fs.writeFile(issueFile, largeBody, "utf8");
    await fs.writeFile(path.join(vault, "graphify-out", "GRAPH_REPORT.md"), "# Generated\n", "utf8");

    const result = prepareGraphifyCompactCorpus(vault, corpus, 2_000);

    expect(result.files).toBe(1);
    expect(result.truncated).toBe(1);
    expect(result.written).toBe(1);
    await expect(fs.readFile(path.join(corpus, "issues", "REA-252.md"), "utf8")).resolves.toContain(
      "graphify compact corpus omitted middle of large note",
    );
    await expect(fs.stat(path.join(corpus, "graphify-out", "GRAPH_REPORT.md"))).rejects.toThrow();
  });

  it("excludes broken graphify backup directories from the compact corpus", async () => {
    const vault = await tempVault();
    const corpus = path.join(vault, ".graphify-corpus");
    await fs.mkdir(path.join(vault, ".graphify-out-broken-20260520-053206"), { recursive: true });
    await fs.writeFile(path.join(vault, "issues", "REA-1.md"), "# REA-1\n", "utf8");
    await fs.writeFile(
      path.join(vault, ".graphify-out-broken-20260520-053206", "GRAPH_REPORT.md"),
      "# Broken backup\n",
      "utf8",
    );

    expect(prepareGraphifyCompactCorpus(vault, corpus, 10_000)).toMatchObject({
      files: 1,
      written: 1,
    });
    await expect(
      fs.stat(path.join(corpus, ".graphify-out-broken-20260520-053206", "GRAPH_REPORT.md")),
    ).rejects.toThrow();
  });

  it("excludes top-level log.md from the compact corpus", async () => {
    const vault = await tempVault();
    const corpus = path.join(vault, ".graphify-corpus");
    await fs.writeFile(path.join(vault, "log.md"), "# giant audit log\n", "utf8");
    await fs.writeFile(path.join(vault, "issues", "REA-1.md"), "# REA-1\n", "utf8");

    expect(prepareGraphifyCompactCorpus(vault, corpus, 10_000, 250)).toMatchObject({
      files: 1,
      written: 1,
    });
    await expect(fs.stat(path.join(corpus, "log.md"))).rejects.toThrow();
  });

  it("removes stale excluded log files from an existing compact corpus", async () => {
    const vault = await tempVault();
    const corpus = path.join(vault, ".graphify-corpus");
    await fs.mkdir(corpus, { recursive: true });
    await fs.writeFile(path.join(corpus, "log.md"), "# stale log\n", "utf8");
    await fs.writeFile(path.join(vault, "issues", "REA-1.md"), "# REA-1\n", "utf8");

    expect(prepareGraphifyCompactCorpus(vault, corpus, 10_000, 250)).toMatchObject({
      files: 1,
      removed: 1,
    });
    await expect(fs.stat(path.join(corpus, "log.md"))).rejects.toThrow();
  });

  it("keeps only the most recent bounded issue pages in the compact corpus", async () => {
    const vault = await tempVault();
    const corpus = path.join(vault, ".graphify-corpus");
    const older = path.join(vault, "issues", "REA-1.md");
    const newer = path.join(vault, "issues", "REA-2.md");
    await fs.writeFile(older, "# REA-1\n", "utf8");
    await fs.writeFile(newer, "# REA-2\n", "utf8");
    const olderTime = new Date("2026-05-20T10:00:00Z");
    const newerTime = new Date("2026-05-21T10:00:00Z");
    await fs.utimes(older, olderTime, olderTime);
    await fs.utimes(newer, newerTime, newerTime);

    expect(prepareGraphifyCompactCorpus(vault, corpus, 10_000, 1)).toMatchObject({
      files: 1,
      written: 1,
    });
    await expect(fs.readFile(path.join(corpus, "issues", "REA-2.md"), "utf8")).resolves.toContain("REA-2");
    await expect(fs.stat(path.join(corpus, "issues", "REA-1.md"))).rejects.toThrow();
  });

  it("keeps all issue and agent pages by default while still bounding each file", async () => {
    const vault = await tempVault();
    const corpus = path.join(vault, ".graphify-corpus");
    await fs.mkdir(path.join(vault, "agents"), { recursive: true });
    await fs.writeFile(path.join(vault, "issues", "REA-1.md"), "# REA-1\n", "utf8");
    await fs.writeFile(path.join(vault, "issues", "REA-2.md"), "# REA-2\n", "utf8");
    await fs.writeFile(path.join(vault, "agents", "alpha.md"), "# alpha\n", "utf8");
    await fs.writeFile(path.join(vault, "agents", "beta.md"), "# beta\n", "utf8");

    expect(prepareGraphifyCompactCorpus(vault, corpus, 10_000)).toMatchObject({
      files: 4,
      written: 4,
    });
    await expect(fs.readFile(path.join(corpus, "issues", "REA-1.md"), "utf8")).resolves.toContain("REA-1");
    await expect(fs.readFile(path.join(corpus, "issues", "REA-2.md"), "utf8")).resolves.toContain("REA-2");
    await expect(fs.readFile(path.join(corpus, "agents", "alpha.md"), "utf8")).resolves.toContain("alpha");
    await expect(fs.readFile(path.join(corpus, "agents", "beta.md"), "utf8")).resolves.toContain("beta");
  });

  it("keeps only the most recent bounded agent pages in the compact corpus", async () => {
    const vault = await tempVault();
    const corpus = path.join(vault, ".graphify-corpus");
    await fs.mkdir(path.join(vault, "agents"), { recursive: true });
    const older = path.join(vault, "agents", "older-agent.md");
    const newer = path.join(vault, "agents", "newer-agent.md");
    await fs.writeFile(older, "# older\n", "utf8");
    await fs.writeFile(newer, "# newer\n", "utf8");
    const olderTime = new Date("2026-05-20T10:00:00Z");
    const newerTime = new Date("2026-05-21T10:00:00Z");
    await fs.utimes(older, olderTime, olderTime);
    await fs.utimes(newer, newerTime, newerTime);

    const previousLimit = process.env.PAPERCLIP_GRAPHIFY_MAX_AGENT_FILES;
    process.env.PAPERCLIP_GRAPHIFY_MAX_AGENT_FILES = "1";
    try {
      expect(prepareGraphifyCompactCorpus(vault, corpus, 10_000, 250)).toMatchObject({
        files: 1,
        written: 1,
      });
    } finally {
      if (previousLimit == null) delete process.env.PAPERCLIP_GRAPHIFY_MAX_AGENT_FILES;
      else process.env.PAPERCLIP_GRAPHIFY_MAX_AGENT_FILES = previousLimit;
    }

    await expect(fs.readFile(path.join(corpus, "agents", "newer-agent.md"), "utf8")).resolves.toContain(
      "newer",
    );
    await expect(fs.stat(path.join(corpus, "agents", "older-agent.md"))).rejects.toThrow();
  });

  it("excludes unsupported note classes from the compact corpus", async () => {
    const vault = await tempVault();
    const corpus = path.join(vault, ".graphify-corpus");
    await fs.mkdir(path.join(vault, "daily"), { recursive: true });
    await fs.writeFile(path.join(vault, "daily", "2026-05-23.md"), "# daily\n", "utf8");
    await fs.writeFile(path.join(vault, "MEMORY.md"), "# memory\n", "utf8");
    await fs.writeFile(path.join(vault, "issues", "REA-1.md"), "# REA-1\n", "utf8");

    expect(prepareGraphifyCompactCorpus(vault, corpus, 10_000, 250)).toMatchObject({
      files: 2,
      written: 2,
    });
    await expect(fs.readFile(path.join(corpus, "MEMORY.md"), "utf8")).resolves.toContain("memory");
    await expect(fs.readFile(path.join(corpus, "issues", "REA-1.md"), "utf8")).resolves.toContain("REA-1");
    await expect(fs.stat(path.join(corpus, "daily", "2026-05-23.md"))).rejects.toThrow();
  });

  it("does not rewrite unchanged compact corpus files", async () => {
    const vault = await tempVault();
    const corpus = path.join(vault, ".graphify-corpus");
    await fs.writeFile(path.join(vault, "issues", "REA-1.md"), "# REA-1\n", "utf8");

    expect(prepareGraphifyCompactCorpus(vault, corpus, 10_000)).toMatchObject({
      files: 1,
      written: 1,
    });
    expect(prepareGraphifyCompactCorpus(vault, corpus, 10_000)).toMatchObject({
      files: 1,
      written: 0,
    });
  });
});

describe("graphify extraction lock", () => {
  it("allows only one holder until the lock is released", async () => {
    const vault = await tempVault();
    const lockDir = path.join(vault, ".graphify-extract.lock");

    const first = tryAcquireGraphifyExtractLock(lockDir);
    expect(first).not.toBeNull();
    expect(tryAcquireGraphifyExtractLock(lockDir)).toBeNull();

    releaseGraphifyExtractLock(first!);
    const second = tryAcquireGraphifyExtractLock(lockDir);
    expect(second).not.toBeNull();
    releaseGraphifyExtractLock(second!);
  });

  it("replaces a stale abandoned lock", async () => {
    const vault = await tempVault();
    const lockDir = path.join(vault, ".graphify-extract.lock");
    await fs.mkdir(lockDir);
    await fs.writeFile(
      path.join(lockDir, "metadata.json"),
      JSON.stringify({
        owner: "abandoned",
        pid: null,
        parentPid: null,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      "utf8",
    );

    const lock = tryAcquireGraphifyExtractLock(lockDir, 1);
    expect(lock).not.toBeNull();
    const metadata = JSON.parse(
      await fs.readFile(path.join(lockDir, "metadata.json"), "utf8"),
    ) as { owner?: string };
    expect(metadata.owner).toBe(lock!.owner);

    releaseGraphifyExtractLock(lock!);
  });
});

describe("graphify backend selection", () => {
  it("routes Claude local agents through the Claude CLI backend", () => {
    expect(resolveGraphifyBackendSelection("claude_local")).toMatchObject({
      backend: "claude-cli",
      model: null,
      tokenBudget: 60_000,
    });
  });

  it("routes Codex local agents through the Codex backend", () => {
    expect(resolveGraphifyBackendSelection("codex_local")).toMatchObject({
      backend: "codex",
      model: null,
      tokenBudget: 60_000,
    });
  });

  it("does not silently fall back to Ollama for unsupported adapters", () => {
    expect(resolveGraphifyBackendSelection("process")).toBeNull();
  });
});

describe("graphify graph output validation", () => {
  it("adds deterministic vault anchors for issue queries that extraction misses", async () => {
    const vault = await tempVault();
    await fs.mkdir(path.join(vault, "agents"), { recursive: true });
    await fs.writeFile(
      path.join(vault, "issues", "REA-4459.md"),
      [
        "---",
        "title: Plot packet review",
        "status: in_review",
        "---",
        "",
        "# REA-4459",
        "",
        "Waiting on [[cto]] after [[plot-architect]] handoff.",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(path.join(vault, "agents", "cto.md"), "# CTO\n", "utf8");
    await fs.writeFile(path.join(vault, "agents", "plot-architect.md"), "# Plot Architect\n", "utf8");
    await fs.writeFile(
      path.join(vault, "graphify-out", "graph.json"),
      JSON.stringify({
        nodes: [
          {
            id: "extracted_review_state",
            label: "Review state",
            source_file: "issues/REA-4459.md",
          },
        ],
        edges: [],
      }),
      "utf8",
    );

    expect(augmentGraphifyGraphWithVaultAnchors(vault)).toMatchObject({
      nodesAdded: 3,
      edgesAdded: 3,
    });

    const graph = JSON.parse(await fs.readFile(path.join(vault, "graphify-out", "graph.json"), "utf8")) as {
      nodes: Array<{ id: string; label: string; source_file: string }>;
      edges: Array<{ source: string; target: string; relation: string }>;
    };
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vault-issue-rea-4459",
          label: "rea-4459 issue Plot packet review status in_review",
          source_file: "issues/rea-4459.md",
        }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "vault-issue-rea-4459",
          target: "extracted_review_state",
          relation: "contains_extracted_node",
        }),
        expect.objectContaining({
          source: "vault-issue-rea-4459",
          target: "vault-agent-cto",
          relation: "wikilinks_to",
        }),
        expect.objectContaining({
          source: "vault-issue-rea-4459",
          target: "vault-agent-plot-architect",
          relation: "wikilinks_to",
        }),
      ]),
    );
  });

  it("restores the last useful graph when extraction leaves an empty graph over a non-empty corpus", async () => {
    const vault = await tempVault();
    await fs.writeFile(path.join(vault, "issues", "REA-1.md"), "# REA-1\n", "utf8");
    const graphFile = path.join(vault, "graphify-out", "graph.json");
    await fs.writeFile(
      graphFile,
      JSON.stringify({
        nodes: [{ id: "rea-1", label: "REA-1", source_file: "issues/REA-1.md" }],
        edges: [],
      }),
      "utf8",
    );

    expect(validateGraphifyGraphOutput(vault)).toMatchObject({
      nodeCount: 2,
      sourceFiles: 1,
      restoredBackup: false,
    });

    await fs.writeFile(graphFile, JSON.stringify({ nodes: [], edges: [] }), "utf8");

    expect(validateGraphifyGraphOutput(vault)).toMatchObject({
      nodeCount: 0,
      sourceFiles: 1,
      restoredBackup: true,
    });
    await expect(fs.readFile(graphFile, "utf8")).resolves.toContain("vault-issue-rea-1");
  });

  it("treats deterministic anchors as a usable floor when semantic extraction is sparse", async () => {
    const vault = await tempVault();
    for (let i = 0; i < 120; i += 1) {
      await fs.writeFile(path.join(vault, "issues", `REA-${i}.md`), `# REA-${i}\n`, "utf8");
    }
    const graphFile = path.join(vault, "graphify-out", "graph.json");
    await fs.writeFile(
      graphFile,
      JSON.stringify({
        nodes: [{ id: "rea-1", label: "REA-1", source_file: "issues/REA-1.md" }],
        edges: [],
      }),
      "utf8",
    );

    expect(validateGraphifyGraphOutput(vault)).toMatchObject({
      nodeCount: 2,
      sourceFiles: 1,
      isDegraded: false,
      restoredBackup: false,
    });
  });
});
