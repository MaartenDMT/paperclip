import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CompanyTemplateDocumentDefinition } from "@paperclipai/shared";

const here = dirname(fileURLToPath(import.meta.url));
const candidateRoots = [
  resolve(here, "readersbase-company-pack"),
  resolve(here, "../../src/templates/readersbase-company-pack"),
];

function readPackMarkdown(relativePath: string): string {
  const errors: string[] = [];
  for (const root of candidateRoots) {
    const path = resolve(root, relativePath);
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to read ReadersBase company pack markdown ${relativePath}. Tried: ${errors.join("; ")}`);
}

export const READERSBASE_COMPANY_PACK_DOCUMENTS: CompanyTemplateDocumentDefinition[] = [
  {
    slug: "company-operating-manual",
    title: "ReadersBase Publishing Operating Manual",
    scope: "company",
    body: readPackMarkdown("company-operating-manual.md"),
    metadata: { sourcePath: "readersbase-company-pack/company-operating-manual.md" },
  },
  {
    slug: "role-publisher-in-chief",
    title: "Publisher-in-Chief Instructions",
    scope: "agent",
    targetSlug: "publisher-in-chief",
    body: readPackMarkdown("roles/publisher-in-chief.md"),
    metadata: { sourcePath: "readersbase-company-pack/roles/publisher-in-chief.md" },
  },
  {
    slug: "role-head-of-research",
    title: "Head of Research Instructions",
    scope: "agent",
    targetSlug: "head-of-research",
    body: readPackMarkdown("roles/head-of-research.md"),
    metadata: { sourcePath: "readersbase-company-pack/roles/head-of-research.md" },
  },
  {
    slug: "phase-research-plan",
    title: "Research Phase Plan Template",
    scope: "campaign_phase_plan",
    targetSlug: "fiction-production:research",
    body: readPackMarkdown("phases/research.md"),
    metadata: { sourcePath: "readersbase-company-pack/phases/research.md" },
  },
  {
    slug: "phase-analysis-plan",
    title: "Analysis Phase Plan Template",
    scope: "campaign_phase_plan",
    targetSlug: "fiction-production:analysis",
    body: readPackMarkdown("phases/analysis.md"),
    metadata: { sourcePath: "readersbase-company-pack/phases/analysis.md" },
  },
  {
    slug: "phase-story-design-plan",
    title: "Story Design Phase Plan Template",
    scope: "campaign_phase_plan",
    targetSlug: "fiction-production:story-design",
    body: readPackMarkdown("phases/story-design.md"),
    metadata: { sourcePath: "readersbase-company-pack/phases/story-design.md" },
  },
  {
    slug: "pilot-ashen-observatory-research-brief",
    title: "The Ashen Observatory Pilot Brief",
    scope: "issue",
    targetSlug: "fiction-production:research:issue",
    documentKey: "pilot-brief",
    body: readPackMarkdown("pilots/ashen-observatory.md"),
    metadata: { sourcePath: "readersbase-company-pack/pilots/ashen-observatory.md" },
  },
];
