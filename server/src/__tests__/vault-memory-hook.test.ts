import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectTouchedIssueIds,
  ensureParaDailyPage,
  ensureVaultDailyPage,
  normalizeVaultIssueLinks,
  prepareGraphifyCompactCorpus,
  releaseGraphifyExtractLock,
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

  it("keeps generated community links when matching Obsidian notes exist", async () => {
    const vault = await tempVault();
    await fs.mkdir(path.join(vault, "graphify-out", "obsidian"), { recursive: true });
    await fs.writeFile(
      path.join(vault, "graphify-out", "obsidian", "_COMMUNITY_Community 0.md"),
      "# Community 0\n",
      "utf8",
    );
    const report = path.join(vault, "graphify-out", "GRAPH_REPORT.md");
    await fs.writeFile(report, "- [[_COMMUNITY_Community 0|Community 0]]\n", "utf8");

    expect(sanitizeGraphReportWikilinks(vault)).toBe(0);
    await expect(fs.readFile(report, "utf8")).resolves.toBe("- [[_COMMUNITY_Community 0|Community 0]]\n");
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

describe("graphify graph output validation", () => {
  it("restores the last useful graph when extraction leaves an empty graph over a non-empty corpus", async () => {
    const vault = await tempVault();
    await fs.writeFile(path.join(vault, "issues", "REA-1.md"), "# REA-1\n", "utf8");
    const graphFile = path.join(vault, "graphify-out", "graph.json");
    await fs.writeFile(
      graphFile,
      JSON.stringify({
        nodes: [{ id: "rea-1", label: "REA-1" }],
        edges: [],
      }),
      "utf8",
    );

    expect(validateGraphifyGraphOutput(vault)).toMatchObject({
      nodeCount: 1,
      sourceFiles: 1,
      restoredBackup: false,
    });

    await fs.writeFile(graphFile, JSON.stringify({ nodes: [], edges: [] }), "utf8");

    expect(validateGraphifyGraphOutput(vault)).toMatchObject({
      nodeCount: 0,
      sourceFiles: 1,
      restoredBackup: true,
    });
    await expect(fs.readFile(graphFile, "utf8")).resolves.toContain("rea-1");
  });
});
