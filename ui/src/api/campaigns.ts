import type {
  CampaignDetail,
  CampaignDocumentSummary,
  CampaignListItem,
  CampaignPhaseDetail,
  CampaignPhasePlanSubmission,
  CompleteCampaignPhaseInput,
  CreateCampaignInput,
  CreateCampaignPhaseInput,
  LinkCampaignPhaseExecutionIssueInput,
  ReplaceCampaignProjectsInput,
  SubmitCampaignPhasePlanForReviewInput,
  UpdateCampaignInput,
  UpdateCampaignPhaseInput,
  UpsertCampaignPhasePlanInput,
} from "@paperclipai/shared";
import { api } from "./client";

type CreateCampaignRequest = CreateCampaignInput;
type UpdateCampaignRequest = UpdateCampaignInput;
type ReplaceCampaignProjectsRequest = ReplaceCampaignProjectsInput;
type CreateCampaignPhaseRequest = CreateCampaignPhaseInput;
type UpdateCampaignPhaseRequest = UpdateCampaignPhaseInput;
type LinkCampaignPhaseExecutionIssueRequest = LinkCampaignPhaseExecutionIssueInput;
type CompleteCampaignPhaseRequest = CompleteCampaignPhaseInput;
type UpsertCampaignPhasePlanRequest = UpsertCampaignPhasePlanInput;
type SubmitCampaignPhasePlanForReviewRequest = SubmitCampaignPhasePlanForReviewInput;

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
  completePhase: (phaseId: string, data: CompleteCampaignPhaseRequest = {}) =>
    api.post<CampaignPhaseDetail>(`/campaign-phases/${phaseId}/complete`, data),
  upsertPlan: (phaseId: string, data: UpsertCampaignPhasePlanRequest) =>
    api.put<CampaignDocumentSummary>(`/campaign-phases/${phaseId}/plan`, data),
  submitPlan: (phaseId: string, data: SubmitCampaignPhasePlanForReviewRequest = {}) =>
    api.post<CampaignPhasePlanSubmission>(`/campaign-phases/${phaseId}/submit-plan`, data),
};
