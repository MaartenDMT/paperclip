import {
  READERSBASE_ARTIFACT_CONTRACT_VERSION,
  readersBaseArtifactBridgeMetadataSchema,
  type CompanyTemplateArtifactContract,
  type CompanyTemplateCampaignPhaseDefinition,
  type CompanyTemplateDefinition,
  type CreateIssueWorkProduct,
  type ReadersBaseArtifactBridgeMetadata,
} from "@paperclipai/shared";

interface BuildReadersBaseArtifactWorkProductInputOptions {
  template: CompanyTemplateDefinition;
  campaignSlug: string;
  phaseSlug: string;
  readersbaseProjectId: string;
  readersbaseSeriesId?: string | null;
  readersbaseWorkId?: string | null;
  summary: string;
  nextAgentInstructions?: string;
  blockers?: string[];
}

function findCampaignPhase(
  template: CompanyTemplateDefinition,
  campaignSlug: string,
  phaseSlug: string,
): CompanyTemplateCampaignPhaseDefinition {
  const campaign = template.campaignTemplates.find(
    (candidate) => candidate.slug === campaignSlug,
  );
  if (!campaign) {
    throw new Error(`unknown ReadersBase campaign template: ${campaignSlug}`);
  }

  const phase = campaign.phases.find(
    (candidate) => candidate.slug === phaseSlug,
  );
  if (!phase) {
    throw new Error(
      `unknown ReadersBase campaign phase: ${campaignSlug}:${phaseSlug}`,
    );
  }

  return phase;
}

function requiredContractsForPhase(
  template: CompanyTemplateDefinition,
  phase: CompanyTemplateCampaignPhaseDefinition,
): CompanyTemplateArtifactContract[] {
  const requiredKeys = phase.requiredArtifactKeys ?? [];
  const contractsByKey = new Map(
    template.artifactContracts.map((contract) => [contract.key, contract]),
  );
  const missingKeys = requiredKeys.filter((key) => !contractsByKey.has(key));
  if (missingKeys.length > 0) {
    throw new Error(
      `missing artifact contracts for required keys: ${missingKeys.join(", ")}`,
    );
  }

  return requiredKeys.map(
    (key) => contractsByKey.get(key) as CompanyTemplateArtifactContract,
  );
}

function highestApprovalGate(
  contracts: CompanyTemplateArtifactContract[],
): CompanyTemplateArtifactContract["reviewGates"][number] | undefined {
  const gatePriority: CompanyTemplateArtifactContract["reviewGates"][number][] =
    [
      "board_approval",
      "final_acceptance",
      "bridge_validation",
      "ceo_review",
      "lead_review",
    ];
  return gatePriority.find((gate) =>
    contracts.some((contract) => contract.reviewGates.includes(gate)),
  );
}

function downstreamConsumerAgentSlugs(
  contracts: CompanyTemplateArtifactContract[],
): string[] {
  return Array.from(
    new Set(
      contracts.flatMap((contract) =>
        [contract.ownerAgentSlug, contract.metadata?.downstreamConsumer].filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        ),
      ),
    ),
  );
}

export function buildReadersBaseArtifactBridgeMetadata(
  options: BuildReadersBaseArtifactWorkProductInputOptions,
): ReadersBaseArtifactBridgeMetadata {
  const phase = findCampaignPhase(
    options.template,
    options.campaignSlug,
    options.phaseSlug,
  );
  const contracts = requiredContractsForPhase(options.template, phase);
  const metadata = {
    artifactContractVersion: READERSBASE_ARTIFACT_CONTRACT_VERSION,
    bridgeKind: "readersbase_phase_artifact_bridge",
    readersbaseProjectId: options.readersbaseProjectId,
    readersbaseSeriesId: options.readersbaseSeriesId ?? null,
    readersbaseWorkId: options.readersbaseWorkId ?? null,
    readersbasePhase: phase.slug,
    paperclipCampaignSlug: options.campaignSlug,
    paperclipCampaignPhaseSlug: phase.slug,
    artifactKeys: contracts.map((contract) => contract.key),
    artifactContracts: contracts.map((contract) => ({
      key: contract.key,
      title: contract.title,
      phaseSlug: contract.phaseSlug,
      projectSlug: contract.projectSlug,
      ownerAgentSlug: contract.ownerAgentSlug,
      kind: contract.kind,
      lifecycle: contract.lifecycle,
      reviewGates: contract.reviewGates,
      required: contract.required,
    })),
    sourceRefs: {
      paperclipTemplateSlug: options.template.slug,
      paperclipTemplateVersion: options.template.version,
      readersbaseArtifactInventoryPath:
        "plans/readersbase-artifact-phase-contract.md",
      taxonomyValidation: "future-bridge",
    },
    followUpContext: {
      summary: options.summary,
      nextAgentInstructions: options.nextAgentInstructions,
      requiredBeforeNextPhase: contracts.map((contract) => contract.key),
      downstreamConsumerAgentSlugs: downstreamConsumerAgentSlugs(contracts),
      blockers: options.blockers,
      approvalGate: highestApprovalGate(contracts),
    },
    noLiveReadersBaseMutation: true,
  };

  return readersBaseArtifactBridgeMetadataSchema.parse(
    metadata,
  ) as ReadersBaseArtifactBridgeMetadata;
}

export function buildReadersBaseArtifactWorkProductInput(
  options: BuildReadersBaseArtifactWorkProductInputOptions,
): CreateIssueWorkProduct {
  const metadata = buildReadersBaseArtifactBridgeMetadata(options);
  return {
    type: "artifact",
    provider: "readersbase",
    externalId: `${metadata.readersbaseProjectId}:${metadata.readersbasePhase}`,
    title: `ReadersBase ${metadata.readersbasePhase} phase artifacts`,
    status: "ready_for_review",
    reviewState:
      metadata.followUpContext.approvalGate === "board_approval"
        ? "needs_board_review"
        : "none",
    isPrimary: true,
    healthStatus: "unknown",
    summary: options.summary,
    metadata,
  };
}
