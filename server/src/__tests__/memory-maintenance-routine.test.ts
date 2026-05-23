import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  routineTriggers,
  routines,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  memoryMaintenanceRoutineService,
  MEMORY_MAINTENANCE_ROUTINE_MARKER,
  MEMORY_MAINTENANCE_ROUTINE_TITLE,
} from "../services/memory-maintenance-routine.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres memory maintenance routine tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("memory maintenance routine service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-memory-maintenance-routine-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(routineTriggers);
    await db.delete(routines);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    });
    return companyId;
  }

  async function seedAgent(companyId: string, input: {
    name: string;
    role: string;
    status?: string;
    title?: string | null;
  }) {
    const [agent] = await db.insert(agents).values({
      companyId,
      name: input.name,
      role: input.role,
      title: input.title ?? null,
      status: input.status ?? "idle",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    return agent;
  }

  it("creates an active weekly memory routine assigned to a steward agent", async () => {
    const companyId = await seedCompany();
    const steward = await seedAgent(companyId, {
      name: "Worktree Steward",
      role: "worktree_steward",
    });
    const svc = memoryMaintenanceRoutineService(db);

    const result = await svc.ensureForCompany(companyId);

    expect(result).toMatchObject({
      status: "created",
      assigneeAgentId: steward.id,
    });
    const [routine] = await db.select().from(routines).where(eq(routines.id, result.routineId));
    expect(routine).toMatchObject({
      title: MEMORY_MAINTENANCE_ROUTINE_TITLE,
      status: "active",
      priority: "low",
      assigneeAgentId: steward.id,
      concurrencyPolicy: "coalesce_if_active",
      catchUpPolicy: "skip_missed",
    });
    expect(routine.description).toContain(MEMORY_MAINTENANCE_ROUTINE_MARKER);
    expect(routine.description).toContain("karpathy-obsidian-memory");
    expect(routine.description).toContain("para-memory-files");
    expect(routine.description).toContain("memoryCorrections");

    const [trigger] = await db.select().from(routineTriggers).where(eq(routineTriggers.routineId, routine.id));
    expect(trigger).toMatchObject({
      kind: "schedule",
      label: "Weekly memory maintenance",
      enabled: true,
      cronExpression: "0 8 * * 1",
      timezone: "Europe/Brussels",
    });
    expect(trigger.nextRunAt).toBeInstanceOf(Date);
  });

  it("does not duplicate the built-in routine or default trigger", async () => {
    const companyId = await seedCompany();
    await seedAgent(companyId, { name: "Worktree Steward", role: "worktree_steward" });
    const svc = memoryMaintenanceRoutineService(db);

    const first = await svc.ensureForCompany(companyId);
    const second = await svc.ensureForCompany(companyId);

    expect(second).toMatchObject({
      status: "unchanged",
      routineId: first.routineId,
    });
    const routineRows = await db.select().from(routines).where(eq(routines.title, MEMORY_MAINTENANCE_ROUTINE_TITLE));
    const triggerRows = await db.select().from(routineTriggers).where(eq(routineTriggers.routineId, first.routineId));
    expect(routineRows).toHaveLength(1);
    expect(triggerRows).toHaveLength(1);
  });

  it("pauses without a steward and activates the same routine once a steward exists", async () => {
    const companyId = await seedCompany();
    await seedAgent(companyId, { name: "General Engineer", role: "engineer" });
    const svc = memoryMaintenanceRoutineService(db);

    const paused = await svc.ensureForCompany(companyId);
    let [routine] = await db.select().from(routines).where(eq(routines.id, paused.routineId));
    expect(paused).toMatchObject({ status: "created", assigneeAgentId: null });
    expect(routine).toMatchObject({ status: "paused", assigneeAgentId: null });

    const steward = await seedAgent(companyId, { name: "Memory Steward", role: "ops" });
    const activated = await svc.ensureForCompany(companyId);

    [routine] = await db.select().from(routines).where(eq(routines.id, paused.routineId));
    expect(activated).toMatchObject({
      status: "updated",
      routineId: paused.routineId,
      assigneeAgentId: steward.id,
    });
    expect(routine).toMatchObject({ status: "active", assigneeAgentId: steward.id });
  });

  it("reassigns an existing routine when the assigned steward is no longer invokable", async () => {
    const companyId = await seedCompany();
    const oldSteward = await seedAgent(companyId, {
      name: "Old Worktree Steward",
      role: "worktree_steward",
      status: "idle",
    });
    const svc = memoryMaintenanceRoutineService(db);
    const created = await svc.ensureForCompany(companyId);
    expect(created.assigneeAgentId).toBe(oldSteward.id);

    await db.update(agents).set({ status: "terminated" }).where(eq(agents.id, oldSteward.id));
    const newSteward = await seedAgent(companyId, {
      name: "New Worktree Steward",
      role: "worktree_steward",
      status: "idle",
    });
    const reassigned = await svc.ensureForCompany(companyId);

    expect(reassigned).toMatchObject({
      status: "updated",
      routineId: created.routineId,
      assigneeAgentId: newSteward.id,
    });
    const [routine] = await db.select().from(routines).where(eq(routines.id, created.routineId));
    expect(routine).toMatchObject({
      status: "active",
      assigneeAgentId: newSteward.id,
    });
  });
});
