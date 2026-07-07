import { describe, expect, it } from "vitest";
import { READERSBASE_PUBLISHING_TEMPLATE } from "./readersbase-publishing.js";
import { planCompanyTemplateInstall } from "./company-template-materializer.js";

describe("planCompanyTemplateInstall", () => {
  it("builds a dry-run plan with deterministic template install actions", () => {
    const plan = planCompanyTemplateInstall(READERSBASE_PUBLISHING_TEMPLATE, { dryRun: true });

    expect(plan.dryRun).toBe(true);
    expect(plan.templateSlug).toBe("readersbase-publishing");
    expect(plan.actions[0]).toMatchObject({ kind: "create", entityType: "company", slug: "readersbase-publishing" });
    expect(plan.actions.some((action) => action.entityType === "campaign_phase" && action.slug === "fiction-production:research")).toBe(true);
    expect(plan.actions.some((action) => action.entityType === "artifact_contract" && action.slug === "deep-fiction-quality-gate")).toBe(true);
    expect(plan.warnings).toContain("ReadersBase bridge validation is metadata-only in v1; no live taxonomy or catalog mutation will run.");
  });

  it("orders agents so managers are planned before direct reports", () => {
    const plan = planCompanyTemplateInstall(READERSBASE_PUBLISHING_TEMPLATE, { dryRun: true });
    const agentActionSlugs = plan.actions.filter((action) => action.entityType === "agent").map((action) => action.slug);

    expect(agentActionSlugs.indexOf("publisher-in-chief")).toBeLessThan(agentActionSlugs.indexOf("head-of-production"));
    expect(agentActionSlugs.indexOf("head-of-production")).toBeLessThan(agentActionSlugs.indexOf("production-planner"));
    expect(agentActionSlugs.indexOf("head-of-research")).toBeLessThan(agentActionSlugs.indexOf("research-classification-agent"));
  });
});
