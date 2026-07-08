import { describe, expect, it } from "vitest";
import {
  renderCompanyTemplateInstallResult,
  resolveCompanyTemplateApplyConfirmationMode,
  resolveCompanyTemplateInstallApiPath,
} from "../commands/client/company.js";

describe("resolveCompanyTemplateInstallApiPath", () => {
  it("builds the generic company template install route", () => {
    expect(resolveCompanyTemplateInstallApiPath("readersbase-publishing")).toBe(
      "/api/companies/templates/readersbase-publishing/install",
    );
  });

  it("rejects an empty template slug", () => {
    expect(() => resolveCompanyTemplateInstallApiPath("  ")).toThrow(/template slug is required/i);
  });
});

describe("resolveCompanyTemplateApplyConfirmationMode", () => {
  it("skips confirmation for dry runs", () => {
    expect(resolveCompanyTemplateApplyConfirmationMode({ apply: false, yes: false, interactive: false, json: true })).toBe("skip");
  });

  it("requires --yes for non-interactive apply", () => {
    expect(() =>
      resolveCompanyTemplateApplyConfirmationMode({ apply: true, yes: false, interactive: false, json: false }),
    ).toThrow(/requires --yes/i);
  });

  it("requires --yes for json apply", () => {
    expect(() =>
      resolveCompanyTemplateApplyConfirmationMode({ apply: true, yes: false, interactive: true, json: true }),
    ).toThrow(/with --json requires --yes/i);
  });
});

describe("renderCompanyTemplateInstallResult", () => {
  it("summarizes dry-run template capability including first pilot issue specs", () => {
    const rendered = renderCompanyTemplateInstallResult({
      templateSlug: "readersbase-publishing",
      templateVersion: "1.0.0",
      applied: false,
      companyId: undefined,
      summary: {
        company: { name: "ReadersBase Publishing", issuePrefix: "RB" },
        agents: 44,
        projects: 10,
        phases: 6,
        artifactContracts: 10,
        documents: 7,
        firstPilotIssueSpecs: [
          { slug: "ashen-observatory-sci-fi-mystery-novel:research", phaseSlug: "research", title: "Research", assigneeRoleSlug: "head-of-research", requiredArtifactKeys: ["research-brief"] },
        ],
      },
      plan: {
        templateSlug: "readersbase-publishing",
        templateVersion: "1.0.0",
        dryRun: true,
        actions: [
          { kind: "create", entityType: "company", slug: "readersbase-publishing", label: "ReadersBase Publishing" },
          { kind: "create", entityType: "agent", slug: "publisher-in-chief", label: "Publisher-in-Chief" },
        ],
        warnings: ["metadata-only"],
      },
      created: [],
      updated: [],
      skipped: [],
      warnings: ["metadata-only"],
    });

    expect(rendered).toContain("Template: readersbase-publishing@1.0.0");
    expect(rendered).toContain("Mode: dry-run");
    expect(rendered).toContain("Company: ReadersBase Publishing (RB)");
    expect(rendered).toContain("Agents: 44");
    expect(rendered).toContain("Projects: 10");
    expect(rendered).toContain("Phases: 6");
    expect(rendered).toContain("Artifact contracts: 10");
    expect(rendered).toContain("Documents: 7");
    expect(rendered).toContain("First pilot issue specs: 1");
    expect(rendered).toContain("ashen-observatory-sci-fi-mystery-novel:research");
    expect(rendered).toContain("Planned actions: 2");
  });
});
