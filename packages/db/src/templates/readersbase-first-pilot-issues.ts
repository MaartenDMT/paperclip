import type { CreateIssueWorkProduct } from "@paperclipai/shared";
import {
  READERSBASE_DEEP_FICTION_PILOT,
  type ReadersBasePilotPhaseSlug,
  buildReadersBaseDeepFictionPilotWorkProducts,
} from "./readersbase-deep-fiction-pilot.js";
import { READERSBASE_PUBLISHING_TEMPLATE } from "./readersbase-publishing.js";

export type ReadersBaseFirstPilotIssuePhaseSlug = Extract<
  ReadersBasePilotPhaseSlug,
  "research" | "analysis" | "story-design"
>;

export interface ReadersBaseFirstPilotArtifactRequirement {
  key: string;
  title: string;
  kind: string;
  ownerAgentSlug?: string;
  projectSlug?: string;
  reviewGates: string[];
  required: true;
}

export interface ReadersBaseFirstPilotIssueSpec {
  slug: string;
  title: string;
  phaseSlug: ReadersBaseFirstPilotIssuePhaseSlug;
  sequence: number;
  status: "backlog";
  priority: "high" | "medium";
  assigneeRoleSlug: string;
  projectSlug?: string;
  goalSlug: "company-mission";
  campaignSlug: string;
  pilotSlug: string;
  description: string;
  artifactRequirements: ReadersBaseFirstPilotArtifactRequirement[];
  approvalPoints: string[];
  exitGate: string;
  blockedByPhaseSlugs: ReadersBaseFirstPilotIssuePhaseSlug[];
  followUpContext: {
    allowedNextPhaseSlug: ReadersBaseFirstPilotIssuePhaseSlug | null;
    stopBeforePhaseSlug: "draft";
    nextAgentInstructions: string;
    requiredBeforeNextPhase: string[];
  };
  executionPolicy: {
    noExternalPublication: true;
    noMassBookGeneration: true;
    noLiveReadersBaseMutation: true;
    stopBeforeDraft: true;
    requiredArtifactKeys: string[];
    approvalPoints: string[];
  };
  workProductSeed: CreateIssueWorkProduct;
}

interface ArtifactContractShape {
  key: string;
  title: string;
  kind: string;
  ownerAgentSlug?: string;
  projectSlug?: string;
  reviewGates: string[];
}

const FIRST_PILOT_PHASES = READERSBASE_DEEP_FICTION_PILOT.firstRunSequence as ReadersBaseFirstPilotIssuePhaseSlug[];
const CAMPAIGN = READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates.find(
  (candidate) => candidate.slug === READERSBASE_DEEP_FICTION_PILOT.campaignTemplateSlug,
);

if (!CAMPAIGN) {
  throw new Error(`unknown ReadersBase first pilot campaign: ${READERSBASE_DEEP_FICTION_PILOT.campaignTemplateSlug}`);
}

const artifactContractByKey = new Map<string, ArtifactContractShape>(
  READERSBASE_PUBLISHING_TEMPLATE.artifactContracts.map((contract) => [
    String(contract.key),
    contract as ArtifactContractShape,
  ]),
);

function phaseRunbook(phaseSlug: ReadersBaseFirstPilotIssuePhaseSlug) {
  const phase = READERSBASE_DEEP_FICTION_PILOT.phaseRunbook.find(
    (candidate) => candidate.phaseSlug === phaseSlug,
  );
  if (!phase) {
    throw new Error(`missing ReadersBase pilot phase runbook: ${phaseSlug}`);
  }
  return phase;
}

function campaignPhase(phaseSlug: ReadersBaseFirstPilotIssuePhaseSlug) {
  const phase = CAMPAIGN?.phases.find((candidate) => candidate.slug === phaseSlug);
  if (!phase) {
    throw new Error(`missing ReadersBase campaign phase: ${phaseSlug}`);
  }
  return phase;
}

function artifactRequirements(requiredArtifactKeys: string[]): ReadersBaseFirstPilotArtifactRequirement[] {
  return requiredArtifactKeys.map((key) => {
    const contract = artifactContractByKey.get(key);
    if (!contract) {
      throw new Error(`missing ReadersBase artifact contract: ${key}`);
    }
    return {
      key: contract.key,
      title: contract.title,
      kind: contract.kind,
      ownerAgentSlug: contract.ownerAgentSlug,
      projectSlug: contract.projectSlug,
      reviewGates: [...contract.reviewGates],
      required: true,
    };
  });
}

function descriptionForIssue(phase: ReturnType<typeof phaseRunbook>, requirements: ReadersBaseFirstPilotArtifactRequirement[]): string {
  return [
    `${READERSBASE_DEEP_FICTION_PILOT.title} governed pilot ${phase.phaseSlug} issue.`,
    "",
    `Objective: ${phase.objective}`,
    "",
    `Required artifacts: ${requirements.map((requirement) => requirement.key).join(", ")}.`,
    `Approval points: ${phase.approvalPoints.join("; ")}.`,
    `Exit gate: ${phase.gate}`,
    "",
    `Instructions: ${phase.nextAgentInstructions}`,
    "",
    "Safety boundaries: do not start Draft, Editorial, or Publishing; do not publish externally; do not start mass book generation; do not mutate ReadersBase.",
  ].join("\n");
}

const workProductsByPhase = new Map(
  buildReadersBaseDeepFictionPilotWorkProducts().map((workProduct) => [
    String(workProduct.metadata?.paperclipCampaignPhaseSlug),
    workProduct,
  ]),
);

export const READERSBASE_FIRST_PILOT_ISSUE_SPECS: ReadersBaseFirstPilotIssueSpec[] = FIRST_PILOT_PHASES.map(
  (phaseSlug, index) => {
    const runbook = phaseRunbook(phaseSlug);
    const templatePhase = campaignPhase(phaseSlug);
    const requirements = artifactRequirements(runbook.requiredArtifactKeys);
    const workProductSeed = workProductsByPhase.get(phaseSlug);
    if (!workProductSeed) {
      throw new Error(`missing ReadersBase work product seed for phase: ${phaseSlug}`);
    }
    return {
      slug: `${READERSBASE_DEEP_FICTION_PILOT.slug}:${phaseSlug}`,
      title: `${READERSBASE_DEEP_FICTION_PILOT.title}: ${templatePhase.title}`,
      phaseSlug,
      sequence: index + 1,
      status: "backlog",
      priority: phaseSlug === "story-design" ? "high" : "medium",
      assigneeRoleSlug: runbook.assignedRoleSlug,
      projectSlug: templatePhase.projectSlug,
      goalSlug: "company-mission",
      campaignSlug: READERSBASE_DEEP_FICTION_PILOT.campaignTemplateSlug,
      pilotSlug: READERSBASE_DEEP_FICTION_PILOT.slug,
      description: descriptionForIssue(runbook, requirements),
      artifactRequirements: requirements,
      approvalPoints: [...runbook.approvalPoints],
      exitGate: runbook.gate,
      blockedByPhaseSlugs: FIRST_PILOT_PHASES.slice(0, index),
      followUpContext: {
        allowedNextPhaseSlug: FIRST_PILOT_PHASES[index + 1] ?? null,
        stopBeforePhaseSlug: "draft",
        nextAgentInstructions: runbook.nextAgentInstructions,
        requiredBeforeNextPhase: [...runbook.requiredArtifactKeys],
      },
      executionPolicy: {
        noExternalPublication: true,
        noMassBookGeneration: true,
        noLiveReadersBaseMutation: true,
        stopBeforeDraft: true,
        requiredArtifactKeys: [...runbook.requiredArtifactKeys],
        approvalPoints: [...runbook.approvalPoints],
      },
      workProductSeed,
    };
  },
);

export function buildReadersBaseFirstPilotIssueSpecs(): ReadersBaseFirstPilotIssueSpec[] {
  return READERSBASE_FIRST_PILOT_ISSUE_SPECS.map((spec) => ({
    ...spec,
    artifactRequirements: spec.artifactRequirements.map((requirement) => ({ ...requirement })),
    approvalPoints: [...spec.approvalPoints],
    blockedByPhaseSlugs: [...spec.blockedByPhaseSlugs],
    followUpContext: {
      ...spec.followUpContext,
      requiredBeforeNextPhase: [...spec.followUpContext.requiredBeforeNextPhase],
    },
    executionPolicy: {
      ...spec.executionPolicy,
      requiredArtifactKeys: [...spec.executionPolicy.requiredArtifactKeys],
      approvalPoints: [...spec.executionPolicy.approvalPoints],
    },
    workProductSeed: {
      ...spec.workProductSeed,
      metadata: spec.workProductSeed.metadata ? { ...spec.workProductSeed.metadata } : spec.workProductSeed.metadata,
    },
  }));
}
