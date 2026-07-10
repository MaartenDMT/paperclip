import { z } from "zod";
import { GOAL_LEVELS, GOAL_STATUSES } from "../constants.js";

const maosSystemIdSchema = z.string().regex(
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  "MAOS system identifiers must use lowercase kebab-case",
);

export const createGoalSchema = z.object({
  title: z.string().min(1),
  maosSystemId: maosSystemIdSchema.optional().nullable(),
  description: z.string().optional().nullable(),
  level: z.enum(GOAL_LEVELS).optional().default("task"),
  status: z.enum(GOAL_STATUSES).optional().default("planned"),
  parentId: z.string().uuid().optional().nullable(),
  ownerAgentId: z.string().uuid().optional().nullable(),
});

export type CreateGoal = z.infer<typeof createGoalSchema>;

export const updateGoalSchema = createGoalSchema.partial();

export type UpdateGoal = z.infer<typeof updateGoalSchema>;
