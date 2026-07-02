import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  companies,
  companySkills,
  costEvents,
  createDb,
  environmentLeases,
  environments,
  heartbeatRunEvents,
  heartbeatRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(() => new Promise<never>(() => undefined)),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat global dispatch tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function waitForNoActiveRuns(db: ReturnType<typeof createDb>, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(inArray(heartbeatRuns.status, ["queued", "running"]));
    if (rows.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForAgentRunProcessStarted(
  db: ReturnType<typeof createDb>,
  agentId: string,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await db
      .select({
        agentId: heartbeatRuns.agentId,
        status: heartbeatRuns.status,
        processStartedAt: heartbeatRuns.processStartedAt,
        invocationSource: heartbeatRuns.invocationSource,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, agentId))
      .then((rows) => rows[0] ?? null);
    if (run?.processStartedAt) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return db
    .select({
      agentId: heartbeatRuns.agentId,
      status: heartbeatRuns.status,
      processStartedAt: heartbeatRuns.processStartedAt,
      invocationSource: heartbeatRuns.invocationSource,
      contextSnapshot: heartbeatRuns.contextSnapshot,
    })
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.agentId, agentId))
    .then((rows) => rows[0] ?? null);
}

describeEmbeddedPostgres("heartbeat global dispatch", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-global-dispatch-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    mockAdapterExecute.mockClear();
    runningProcesses.clear();
    await waitForNoActiveRuns(db);
    const activeRuns = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(inArray(heartbeatRuns.status, ["queued", "running"]));
    if (activeRuns.length > 0) {
      await db
        .update(heartbeatRuns)
        .set({ status: "cancelled", finishedAt: new Date(), errorCode: "test_cleanup" })
        .where(inArray(heartbeatRuns.id, activeRuns.map((run) => run.id)));
    }
    await db.delete(costEvents);
    await db.delete(environmentLeases);
    await db.delete(heartbeatRunEvents);
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    await db.delete(companySkills);
    await db.delete(environments);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name: string) {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function seedAgent(
    companyId: string,
    name: string,
    status = "idle",
    runtimeConfig: Record<string, unknown> = {
      heartbeat: {
        wakeOnDemand: true,
        maxConcurrentRuns: 1,
      },
    },
  ) {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name,
      role: "engineer",
      status,
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig,
      permissions: {},
    });
    return agentId;
  }

  it("enqueues due timer work for an idle agent while unrelated runs are active", async () => {
    const busyCompanyId = await seedCompany("Busy Company");
    const idleCompanyId = await seedCompany("Idle Company");

    for (let index = 0; index < 4; index += 1) {
      const agentId = await seedAgent(busyCompanyId, `Busy Agent ${index}`, "running");
      await db.insert(heartbeatRuns).values({
        companyId: busyCompanyId,
        agentId,
        invocationSource: "assignment",
        triggerDetail: "system",
        status: "running",
        startedAt: new Date(),
        processStartedAt: new Date(),
        contextSnapshot: { source: "test.busy-run" },
      });
    }

    const idleAgentId = await seedAgent(
      idleCompanyId,
      "Idle Agent",
      "idle",
      {
        heartbeat: {
          enabled: true,
          intervalSec: 30,
          wakeOnDemand: true,
          maxConcurrentRuns: 1,
        },
      },
    );
    const now = new Date("2026-05-31T19:30:00.000Z");
    await db
      .update(agents)
      .set({ lastHeartbeatAt: new Date(now.getTime() - 60_000) })
      .where(eq(agents.id, idleAgentId));

    const result = await heartbeatService(db).tickTimers(now);

    const queuedRun = await waitForAgentRunProcessStarted(db, idleAgentId);
    const wakeup = await db
      .select({ status: agentWakeupRequests.status, reason: agentWakeupRequests.reason })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, idleAgentId))
      .then((rows) => rows[0] ?? null);
    const busyRunningCount = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.companyId, busyCompanyId));

    expect(result.enqueued).toBe(1);
    expect(queuedRun).toMatchObject({
      agentId: idleAgentId,
      status: "running",
      invocationSource: "timer",
    });
    expect(queuedRun?.contextSnapshot).toMatchObject({
      source: "scheduler",
      reason: "interval_elapsed",
    });
    expect(wakeup).toMatchObject({
      status: "claimed",
      reason: "heartbeat_timer",
    });
    expect(busyRunningCount).toHaveLength(4);
    expect(queuedRun?.processStartedAt).toBeInstanceOf(Date);
    expect(mockAdapterExecute).toHaveBeenCalledTimes(1);
  });
});
