import type {
  CompanyTemplateArtifactKind,
  CompanyTemplateArtifactLifecycleStatus,
  CompanyTemplateArtifactReviewGate,
} from "./company-template.js";

export const READERSBASE_ARTIFACT_CONTRACT_VERSION = 1;

export type ReadersBaseArtifactContractVersion =
  typeof READERSBASE_ARTIFACT_CONTRACT_VERSION;

export interface ReadersBaseArtifactBridgeContractRef {
  key: string;
  title: string;
  phaseSlug: string;
  projectSlug?: string;
  ownerAgentSlug?: string;
  kind: CompanyTemplateArtifactKind;
  lifecycle: CompanyTemplateArtifactLifecycleStatus;
  reviewGates: CompanyTemplateArtifactReviewGate[];
  required: boolean;
}

export interface ReadersBaseArtifactBridgeSourceRefs {
  paperclipTemplateSlug: string;
  paperclipTemplateVersion: string;
  readersbaseArtifactInventoryPath: string;
  taxonomyValidation: "future-bridge" | "readersbase-runtime";
}

export interface ReadersBaseArtifactBridgeFollowUpContext {
  summary: string;
  nextAgentInstructions?: string;
  requiredBeforeNextPhase: string[];
  downstreamConsumerAgentSlugs: string[];
  blockers?: string[];
  approvalGate?: CompanyTemplateArtifactReviewGate;
}

export interface ReadersBaseArtifactBridgeMetadata
  extends Record<string, unknown> {
  artifactContractVersion: ReadersBaseArtifactContractVersion;
  bridgeKind: "readersbase_phase_artifact_bridge";
  readersbaseProjectId: string;
  readersbaseSeriesId?: string | null;
  readersbaseWorkId?: string | null;
  readersbasePhase: string;
  paperclipCampaignSlug: string;
  paperclipCampaignPhaseSlug: string;
  artifactKeys: string[];
  artifactContracts: ReadersBaseArtifactBridgeContractRef[];
  sourceRefs: ReadersBaseArtifactBridgeSourceRefs;
  followUpContext: ReadersBaseArtifactBridgeFollowUpContext;
  noLiveReadersBaseMutation: true;
}
