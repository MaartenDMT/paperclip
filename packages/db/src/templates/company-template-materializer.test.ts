import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  campaignPhases,
  campaignProjects,
  campaigns,
  companies,
  documentRevisions,
  documents,
  goals,
  issueDocuments,
  issueWorkProducts,
  issues,
  projects,
} from "../schema/index.js";
import { createDb } from "../client.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../test-embedded-postgres.js";
import { READERSBASE_PUBLISHING_TEMPLATE } from "./readersbase-publishing.js";
import {
  type CompanyTemplateMaterializerTx,
  type CompanyTemplateMaterializerStore,
  createDrizzleCompanyTemplateMaterializerStore,
  materializeReadersBasePublishingPilot,
  planCompanyTemplateInstall,
} from "./company-template-materializer.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const embeddedPostgresTestTimeoutMs = process.platform === "win32" ? 120_000 : 30_000;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres materializer tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

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

describeEmbeddedPostgres("createDrizzleCompanyTemplateMaterializerStore", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-template-materializer-");
    db = createDb(tempDb.connectionString);
  }, embeddedPostgresTestTimeoutMs);

  afterEach(async () => {
    await db.delete(issueWorkProducts);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(campaignPhases);
    await db.delete(campaignProjects);
    await db.delete(campaigns);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it(
    "maps campaign phase assignees to resolved agent IDs instead of template slugs",
    async () => {
      const store = createDrizzleCompanyTemplateMaterializerStore(db);

      const result = await materializeReadersBasePublishingPilot(store, { dryRun: false });

      expect(result.applied).toBe(true);
      expect(result.companyId).toBeTruthy();

      const agentRows = await db
        .select({
          id: agents.id,
          metadata: agents.metadata,
        })
        .from(agents)
        .where(eq(agents.companyId, String(result.companyId)));
      const agentIdBySlug = new Map(
        agentRows.map((agent) => [
          String((agent.metadata as Record<string, unknown> | null)?.templateAgentSlug),
          agent.id,
        ]),
      );
      const phaseRows = await db
        .select({
          title: campaignPhases.title,
          assigneeAgentId: campaignPhases.assigneeAgentId,
        })
        .from(campaignPhases)
        .where(eq(campaignPhases.companyId, String(result.companyId)));

      expect(phaseRows).toHaveLength(READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates[0].phases.length);
      for (const phase of READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates[0].phases) {
        expect(phase.ownerAgentSlug).toBeTruthy();
        const ownerAgentSlug = String(phase.ownerAgentSlug);
        const row = phaseRows.find((candidate) => candidate.title === phase.title);
        expect(row).toBeTruthy();
        expect(row?.assigneeAgentId).toBe(agentIdBySlug.get(ownerAgentSlug));
        expect(row?.assigneeAgentId).not.toBe(ownerAgentSlug);
      }

      const seededDocuments = await db
        .select({ title: documents.title, latestBody: documents.latestBody })
        .from(documents)
        .where(eq(documents.companyId, String(result.companyId)));
      expect(seededDocuments.some((document) => document.title === "ReadersBase Publishing Operating Manual")).toBe(true);
      expect(seededDocuments.some((document) => document.latestBody.includes("Do not mutate ReadersBase"))).toBe(true);

      const researchPhase = await db
        .select({ planDocumentId: campaignPhases.planDocumentId })
        .from(campaignPhases)
        .where(eq(campaignPhases.title, "Research"))
        .limit(1);
      expect(researchPhase[0]?.planDocumentId).toBeTruthy();

      const pilotIssueDocumentRows = await db
        .select({ key: issueDocuments.key })
        .from(issueDocuments)
        .where(eq(issueDocuments.key, "pilot-brief"));
      expect(pilotIssueDocumentRows).toHaveLength(1);
    },
    embeddedPostgresTestTimeoutMs,
  );
});
