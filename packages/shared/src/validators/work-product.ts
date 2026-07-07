import { z } from "zod";
import { readersBaseArtifactBridgeMetadataSchema } from "./readersbase-artifact-bridge.js";

export const issueWorkProductTypeSchema = z.enum([
  "preview_url",
  "runtime_service",
  "pull_request",
  "branch",
  "commit",
  "artifact",
  "document",
]);

export const issueWorkProductStatusSchema = z.enum([
  "active",
  "ready_for_review",
  "approved",
  "changes_requested",
  "merged",
  "closed",
  "failed",
  "archived",
  "draft",
]);

export const issueWorkProductReviewStateSchema = z.enum([
  "none",
  "needs_board_review",
  "approved",
  "changes_requested",
]);

const issueWorkProductInputSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  executionWorkspaceId: z.string().uuid().optional().nullable(),
  runtimeServiceId: z.string().uuid().optional().nullable(),
  type: issueWorkProductTypeSchema,
  provider: z.string().min(1),
  externalId: z.string().optional().nullable(),
  title: z.string().min(1),
  url: z.string().url().optional().nullable(),
  status: issueWorkProductStatusSchema.default("active"),
  reviewState: issueWorkProductReviewStateSchema.optional().default("none"),
  isPrimary: z.boolean().optional().default(false),
  healthStatus: z.enum(["unknown", "healthy", "unhealthy"]).optional().default("unknown"),
  summary: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
  createdByRunId: z.string().uuid().optional().nullable(),
});

function addReadersBaseBridgeMetadataIssues(
  workProduct: { provider?: string; metadata?: Record<string, unknown> | null },
  ctx: z.RefinementCtx,
): void {
  if (workProduct.provider !== "readersbase") return;

  const result = readersBaseArtifactBridgeMetadataSchema.safeParse(
    workProduct.metadata,
  );
  if (result.success) return;

  for (const issue of result.error.issues) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: issue.message,
      path: ["metadata", ...issue.path],
    });
  }
}

export const createIssueWorkProductSchema = issueWorkProductInputSchema.superRefine(
  addReadersBaseBridgeMetadataIssues,
);

export type CreateIssueWorkProduct = z.infer<typeof createIssueWorkProductSchema>;

export const updateIssueWorkProductSchema = issueWorkProductInputSchema
  .partial()
  .superRefine(addReadersBaseBridgeMetadataIssues);

export type UpdateIssueWorkProduct = z.infer<typeof updateIssueWorkProductSchema>;
