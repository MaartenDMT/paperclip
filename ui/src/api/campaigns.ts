import type {
  CampaignDetail,
  CampaignDocumentSummary,
  CampaignListItem,
  CampaignPhaseDetail,
  CampaignPhasePlanSubmission,
  createCampaignPhaseSchema,
  createCampaignSchema,
  linkCampaignPhaseExecutionIssueSchema,
  replaceCampaignProjectsSchema,
  submitCampaignPhasePlanForReviewSchema,
  updateCampaignPhaseSchema,
  updateCampaignSchema,
  upsertCampaignPhasePlanSchema,
} from "@paperclipai/shared";
import type { z } from "zod";
import { api } from "./client";

type CreateCampaignRequest = z.input<typeof createCampaignSchema>;
type UpdateCampaignRequest = z.input<typeof updateCampaignSchema>;
type ReplaceCampaignProjectsRequest = z.input<typeof replaceCampaignProjectsSchema>;
type CreateCampaignPhaseRequest = z.input<typeof createCampaignPhaseSchema>;
type UpdateCampaignPhaseRequest = z.input<typeof updateCampaignPhaseSchema>;
type LinkCampaignPhaseExecutionIssueRequest = z.input<typeof linkCampaignPhaseExecutionIssueSchema>;
type UpsertCampaignPhasePlanRequest = z.input<typeof upsertCampaignPhasePlanSchema>;
type SubmitCampaignPhasePlanForReviewRequest = z.input<
  typeof submitCampaignPhasePlanForReviewSchema
>;

export const campaignsApi = {
  list: (companyId: string) =>
    api.get<CampaignListItem[]>(`/companies/${companyId}/campaigns`),
  create: (companyId: string, data: CreateCampaignRequest) =>
    api.post<CampaignDetail>(`/companies/${companyId}/campaigns`, data),
  get: (id: string) => api.get<CampaignDetail>(`/campaigns/${id}`),
  update: (id: string, data: UpdateCampaignRequest) =>
    api.patch<CampaignDetail>(`/campaigns/${id}`, data),
  replaceProjects: (id: string, data: ReplaceCampaignProjectsRequest) =>
    api.put<CampaignDetail>(`/campaigns/${id}/projects`, data),
  listPhases: (campaignId: string) =>
    api.get<CampaignPhaseDetail[]>(`/campaigns/${campaignId}/phases`),
  createPhase: (campaignId: string, data: CreateCampaignPhaseRequest) =>
    api.post<CampaignPhaseDetail>(`/campaigns/${campaignId}/phases`, data),
  updatePhase: (phaseId: string, data: UpdateCampaignPhaseRequest) =>
    api.patch<CampaignPhaseDetail>(`/campaign-phases/${phaseId}`, data),
  linkExecutionIssue: (phaseId: string, data: LinkCampaignPhaseExecutionIssueRequest) =>
    api.put<CampaignPhaseDetail>(`/campaign-phases/${phaseId}/execution-issue`, data),
  upsertPlan: (phaseId: string, data: UpsertCampaignPhasePlanRequest) =>
    api.put<CampaignDocumentSummary>(`/campaign-phases/${phaseId}/plan`, data),
  submitPlan: (phaseId: string, data: SubmitCampaignPhasePlanForReviewRequest = {}) =>
    api.post<CampaignPhasePlanSubmission>(`/campaign-phases/${phaseId}/submit-plan`, data),
};
