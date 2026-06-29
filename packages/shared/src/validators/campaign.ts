import { z } from "zod";
import { CAMPAIGN_PHASE_STATUSES, CAMPAIGN_STATUSES, ISSUE_PRIORITIES } from "../constants.js";
import { multilineTextSchema } from "./text.js";

export const createCampaignSchema = z.object({
  goalId: z.string().uuid().optional().nullable(),
  leadAgentId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  objective: z.string().trim().max(20_000).optional().nullable(),
  status: z.enum(CAMPAIGN_STATUSES).optional().default("draft"),
  projectIds: z.array(z.string().uuid()).max(50).optional().default([]),
});

export type CreateCampaign = z.infer<typeof createCampaignSchema>;
export type CreateCampaignInput = z.input<typeof createCampaignSchema>;

export const updateCampaignSchema = createCampaignSchema.partial().extend({
  archivedAt: z.string().datetime().optional().nullable(),
});

export type UpdateCampaign = z.infer<typeof updateCampaignSchema>;
export type UpdateCampaignInput = z.input<typeof updateCampaignSchema>;

export const replaceCampaignProjectsSchema = z.object({
  projectIds: z.array(z.string().uuid()).max(50).default([]),
});

export type ReplaceCampaignProjects = z.infer<typeof replaceCampaignProjectsSchema>;
export type ReplaceCampaignProjectsInput = z.input<typeof replaceCampaignProjectsSchema>;

export const createCampaignPhaseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  objective: z.string().trim().max(20_000).optional().nullable(),
  sequenceNumber: z.number().int().positive().optional(),
  assigneeAgentId: z.string().uuid().optional().nullable(),
  planBody: multilineTextSchema.pipe(z.string().max(200_000)).optional().nullable(),
});

export type CreateCampaignPhase = z.infer<typeof createCampaignPhaseSchema>;
export type CreateCampaignPhaseInput = z.input<typeof createCampaignPhaseSchema>;

export const updateCampaignPhaseSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  objective: z.string().trim().max(20_000).optional().nullable(),
  sequenceNumber: z.number().int().positive().optional(),
  status: z.enum(CAMPAIGN_PHASE_STATUSES).optional(),
  assigneeAgentId: z.string().uuid().optional().nullable(),
});

export type UpdateCampaignPhase = z.infer<typeof updateCampaignPhaseSchema>;
export type UpdateCampaignPhaseInput = z.input<typeof updateCampaignPhaseSchema>;

export const linkCampaignPhaseExecutionIssueSchema = z.object({
  issueId: z.string().uuid().nullable(),
});

export type LinkCampaignPhaseExecutionIssue = z.infer<typeof linkCampaignPhaseExecutionIssueSchema>;
export type LinkCampaignPhaseExecutionIssueInput = z.input<
  typeof linkCampaignPhaseExecutionIssueSchema
>;

export const upsertCampaignPhasePlanSchema = z.object({
  body: multilineTextSchema.pipe(z.string().min(1).max(200_000)),
  changeSummary: z.string().trim().max(500).optional().nullable(),
});

export type UpsertCampaignPhasePlan = z.infer<typeof upsertCampaignPhasePlanSchema>;
export type UpsertCampaignPhasePlanInput = z.input<typeof upsertCampaignPhasePlanSchema>;

export const submitCampaignPhasePlanForReviewSchema = z.object({
  decisionNote: multilineTextSchema.pipe(z.string().max(2_000)).optional().nullable(),
});

export type SubmitCampaignPhasePlanForReview = z.infer<
  typeof submitCampaignPhasePlanForReviewSchema
>;
export type SubmitCampaignPhasePlanForReviewInput = z.input<
  typeof submitCampaignPhasePlanForReviewSchema
>;

export const approveCampaignPhasePlanSchema = z.object({
  decisionNote: multilineTextSchema.pipe(z.string().max(2_000)).optional().nullable(),
  issueTitle: z.string().trim().min(1).max(200).optional(),
  issuePriority: z.enum(ISSUE_PRIORITIES).optional().default("medium"),
});

export type ApproveCampaignPhasePlan = z.infer<typeof approveCampaignPhasePlanSchema>;
export type ApproveCampaignPhasePlanInput = z.input<typeof approveCampaignPhasePlanSchema>;

export const completeCampaignPhaseSchema = z.object({
  resultBody: multilineTextSchema.pipe(z.string().max(200_000)).optional().nullable(),
  resultTitle: z.string().trim().max(200).optional().nullable(),
});

export type CompleteCampaignPhase = z.infer<typeof completeCampaignPhaseSchema>;
export type CompleteCampaignPhaseInput = z.input<typeof completeCampaignPhaseSchema>;
