import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeVaultIssueLinks,
  sanitizeGraphReportWikilinks,
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
