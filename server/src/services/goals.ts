import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, goals } from "@paperclipai/db";
import { unprocessable } from "../errors.js";

type GoalReader = Pick<Db, "select">;
type GoalLinkPatch = {
  parentId?: string | null;
  ownerAgentId?: string | null;
};

export async function getDefaultCompanyGoal(db: GoalReader, companyId: string) {
  const activeRootGoal = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.companyId, companyId),
        eq(goals.level, "company"),
        eq(goals.status, "active"),
        isNull(goals.parentId),
      ),
    )
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
  if (activeRootGoal) return activeRootGoal;

  const anyRootGoal = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.companyId, companyId),
        eq(goals.level, "company"),
        isNull(goals.parentId),
      ),
    )
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
  if (anyRootGoal) return anyRootGoal;

  return db
    .select()
    .from(goals)
    .where(and(eq(goals.companyId, companyId), eq(goals.level, "company")))
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
}

export function goalService(db: Db) {
  async function assertOwnerAgentBelongsToCompany(companyId: string, ownerAgentId: string | null | undefined) {
    if (!ownerAgentId) return;
    const owner = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, ownerAgentId), eq(agents.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!owner) throw unprocessable("Goal owner agent must belong to the same company");
  }

  async function assertParentGoalBelongsToCompany(input: {
    companyId: string;
    parentId: string | null | undefined;
    goalId?: string | null;
  }) {
    if (!input.parentId) return;
    if (input.goalId && input.parentId === input.goalId) {
      throw unprocessable("Goal cannot be its own parent");
    }

    let cursor: string | null = input.parentId;
    const visited = new Set<string>();
    while (cursor) {
      if (input.goalId && cursor === input.goalId) {
        throw unprocessable("Goal parent would create a cycle");
      }
      if (visited.has(cursor)) {
        throw unprocessable("Goal parent hierarchy contains a cycle");
      }
      visited.add(cursor);
      const parent = await db
        .select({ id: goals.id, companyId: goals.companyId, parentId: goals.parentId })
        .from(goals)
        .where(eq(goals.id, cursor))
        .then((rows) => rows[0] ?? null);
      if (!parent || parent.companyId !== input.companyId) {
        throw unprocessable("Goal parent must belong to the same company");
      }
      cursor = parent.parentId;
    }
  }

  async function assertGoalLinks(companyId: string, data: GoalLinkPatch, goalId?: string | null) {
    if (data.parentId !== undefined) {
      await assertParentGoalBelongsToCompany({ companyId, parentId: data.parentId, goalId });
    }
    if (data.ownerAgentId !== undefined) {
      await assertOwnerAgentBelongsToCompany(companyId, data.ownerAgentId);
    }
  }

  return {
    list: (companyId: string) => db.select().from(goals).where(eq(goals.companyId, companyId)),

    getById: (id: string) =>
      db
        .select()
        .from(goals)
        .where(eq(goals.id, id))
        .then((rows) => rows[0] ?? null),

    getDefaultCompanyGoal: (companyId: string) => getDefaultCompanyGoal(db, companyId),

    create: async (companyId: string, data: Omit<typeof goals.$inferInsert, "companyId">) => {
      await assertGoalLinks(companyId, data);
      return db
        .insert(goals)
        .values({ ...data, companyId })
        .returning()
        .then((rows) => rows[0]);
    },

    update: async (id: string, data: Partial<typeof goals.$inferInsert>) => {
      const existing = await db
        .select()
        .from(goals)
        .where(eq(goals.id, id))
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;
      await assertGoalLinks(existing.companyId, data, id);
      return db
        .update(goals)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    remove: (id: string) =>
      db
        .delete(goals)
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),
  };
}
