import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  goals,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { goalService } from "../services/goals.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres goal service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("goalService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-goals-service-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedFixture() {
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const parentGoalId = randomUUID();
    const otherCompanyGoalId = randomUUID();
    const ownerAgentId = randomUUID();
    const otherCompanyAgentId = randomUUID();

    await db.insert(companies).values([
      {
        id: companyId,
        name: "Paperclip",
        issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      },
      {
        id: otherCompanyId,
        name: "Other",
        issuePrefix: `T${otherCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      },
    ]);
    await db.insert(agents).values([
      {
        id: ownerAgentId,
        companyId,
        name: "Owner",
        role: "pm",
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: otherCompanyAgentId,
        companyId: otherCompanyId,
        name: "Other Owner",
        role: "pm",
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(goals).values([
      {
        id: parentGoalId,
        companyId,
        title: "Company goal",
        level: "company",
        status: "active",
      },
      {
        id: otherCompanyGoalId,
        companyId: otherCompanyId,
        title: "Other company goal",
        level: "company",
        status: "active",
      },
    ]);

    return { companyId, parentGoalId, otherCompanyGoalId, ownerAgentId, otherCompanyAgentId };
  }

  it("rejects parent and owner links outside the goal company", async () => {
    const fixture = await seedFixture();
    const svc = goalService(db);

    await expect(
      svc.create(fixture.companyId, {
        title: "Cross-company parent",
        parentId: fixture.otherCompanyGoalId,
      }),
    ).rejects.toMatchObject({ status: 422 });

    await expect(
      svc.create(fixture.companyId, {
        title: "Cross-company owner",
        ownerAgentId: fixture.otherCompanyAgentId,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects updates that move a goal under another company or owner", async () => {
    const fixture = await seedFixture();
    const svc = goalService(db);
    const goal = await svc.create(fixture.companyId, {
      title: "Owned team goal",
      parentId: fixture.parentGoalId,
      ownerAgentId: fixture.ownerAgentId,
    });

    await expect(svc.update(goal.id, { parentId: fixture.otherCompanyGoalId })).rejects.toMatchObject({ status: 422 });
    await expect(svc.update(goal.id, { ownerAgentId: fixture.otherCompanyAgentId })).rejects.toMatchObject({ status: 422 });
  });
});
