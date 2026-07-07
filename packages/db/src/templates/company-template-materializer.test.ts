import { describe, expect, it } from "vitest";
import { READERSBASE_PUBLISHING_TEMPLATE } from "./readersbase-publishing.js";
import {
  type CompanyTemplateMaterializerTx,
  type CompanyTemplateMaterializerStore,
  materializeReadersBasePublishingPilot,
  planCompanyTemplateInstall,
} from "./company-template-materializer.js";

type EntityBucket = Record<string, Record<string, unknown>>;

function cloneBuckets(buckets: Record<string, EntityBucket>): Record<string, EntityBucket> {
  return Object.fromEntries(
    Object.entries(buckets).map(([entityType, bucket]) => [
      entityType,
      Object.fromEntries(Object.entries(bucket).map(([slug, row]) => [slug, { ...row }])),
    ]),
  );
}

function createFakeMaterializerStore(options: { failOnCreateSlug?: string } = {}) {
  const buckets: Record<string, EntityBucket> = {};
  const calls: string[] = [];
  let idCounter = 0;

  function entityKey(companyId: string | null, parentId: string | null, slug: string) {
    return `${companyId ?? "root"}:${parentId ?? "none"}:${slug}`;
  }

  const tx: CompanyTemplateMaterializerTx = {
    async findEntity(entityType: string, scope: { companyId?: string | null; parentId?: string | null; slug: string }) {
      const bucket = buckets[entityType] ?? {};
      return bucket[entityKey(scope.companyId ?? null, scope.parentId ?? null, scope.slug)] as { id: string; [key: string]: unknown } | null ?? null;
    },
    async createEntity(entityType: string, input: { companyId?: string | null; parentId?: string | null; slug: string; label: string; data: Record<string, unknown> }) {
      if (options.failOnCreateSlug === input.slug) {
        throw new Error(`planned failure for ${input.slug}`);
      }
      const bucket = buckets[entityType] ?? (buckets[entityType] = {});
      const id = `id-${++idCounter}`;
      const row = { id, label: input.label, ...input.data };
      bucket[entityKey(input.companyId ?? null, input.parentId ?? null, input.slug)] = row;
      return row;
    },
  };

  const store: CompanyTemplateMaterializerStore = {
    async transaction(action) {
      calls.push("transaction");
      const before = cloneBuckets(buckets);
      try {
        return await action(tx);
      } catch (error) {
        for (const key of Object.keys(buckets)) delete buckets[key];
        Object.assign(buckets, before);
        throw error;
      }
    },
  };

  return { store, buckets, calls };
}

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

  it("keeps dry-run materialization side-effect free while planning pilot rows", async () => {
    const fake = createFakeMaterializerStore();

    const result = await materializeReadersBasePublishingPilot(fake.store, { dryRun: true });

    expect(result.applied).toBe(false);
    expect(fake.calls).toEqual([]);
    expect(result.plan.actions.some((action) => action.entityType === "company")).toBe(true);
    expect(result.plan.actions.some((action) => action.entityType === "work_product")).toBe(true);
  });

  it("is idempotent and preserves existing template-managed rows by default", async () => {
    const fake = createFakeMaterializerStore();

    const first = await materializeReadersBasePublishingPilot(fake.store, { dryRun: false });
    const companyKey = Object.keys(fake.buckets.company)[0];
    fake.buckets.company[companyKey].label = "Human edited ReadersBase Publishing";
    const second = await materializeReadersBasePublishingPilot(fake.store, { dryRun: false });

    expect(first.applied).toBe(true);
    expect(first.created.length).toBeGreaterThan(0);
    expect(second.created).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThan(0);
    expect(fake.buckets.company[companyKey].label).toBe("Human edited ReadersBase Publishing");
  });

  it("rolls back the whole materialization transaction when a later row fails", async () => {
    const fake = createFakeMaterializerStore({ failOnCreateSlug: "fiction-production:story-design:work-product" });

    await expect(materializeReadersBasePublishingPilot(fake.store, { dryRun: false })).rejects.toThrow("planned failure");

    expect(fake.buckets.company).toBeUndefined();
    expect(fake.buckets.work_product).toBeUndefined();
  });
});
