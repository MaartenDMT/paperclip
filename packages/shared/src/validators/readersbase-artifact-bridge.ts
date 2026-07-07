import { z } from "zod";
import {
  companyTemplateArtifactKindSchema,
  companyTemplateArtifactLifecycleStatusSchema,
  companyTemplateArtifactReviewGateSchema,
} from "./company-template.js";

export const READERSBASE_ARTIFACT_CONTRACT_VERSION = 1;

const artifactKeySchema = z.string().min(1);

export const readersBaseArtifactBridgeContractRefSchema = z.object({
  key: artifactKeySchema,
  title: z.string().min(1),
  phaseSlug: z.string().min(1),
  projectSlug: z.string().min(1).optional(),
  ownerAgentSlug: z.string().min(1).optional(),
  kind: companyTemplateArtifactKindSchema,
  lifecycle: companyTemplateArtifactLifecycleStatusSchema,
  reviewGates: z.array(companyTemplateArtifactReviewGateSchema).min(1),
  required: z.boolean(),
});

export const readersBaseArtifactBridgeMetadataSchema = z
  .object({
    artifactContractVersion: z.literal(READERSBASE_ARTIFACT_CONTRACT_VERSION),
    bridgeKind: z.literal("readersbase_phase_artifact_bridge"),
    readersbaseProjectId: z.string().min(1),
    readersbaseSeriesId: z.string().min(1).nullable().optional(),
    readersbaseWorkId: z.string().min(1).nullable().optional(),
    readersbasePhase: z.string().min(1),
    paperclipCampaignSlug: z.string().min(1),
    paperclipCampaignPhaseSlug: z.string().min(1),
    artifactKeys: z.array(artifactKeySchema).min(1),
    artifactContracts: z
      .array(readersBaseArtifactBridgeContractRefSchema)
      .min(1),
    sourceRefs: z.object({
      paperclipTemplateSlug: z.string().min(1),
      paperclipTemplateVersion: z.string().min(1),
      readersbaseArtifactInventoryPath: z.literal(
        "plans/readersbase-artifact-phase-contract.md",
      ),
      taxonomyValidation: z.enum(["future-bridge", "readersbase-runtime"]),
    }),
    followUpContext: z.object({
      summary: z.string().min(1),
      nextAgentInstructions: z.string().min(1).optional(),
      requiredBeforeNextPhase: z.array(artifactKeySchema),
      downstreamConsumerAgentSlugs: z.array(z.string().min(1)),
      blockers: z.array(z.string().min(1)).optional(),
      approvalGate: companyTemplateArtifactReviewGateSchema.optional(),
    }),
    noLiveReadersBaseMutation: z.literal(true),
  })
  .superRefine((metadata, ctx) => {
    const contractKeys = new Set(
      metadata.artifactContracts.map((contract) => contract.key),
    );
    metadata.artifactKeys.forEach((key, index) => {
      if (!contractKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `artifactKeys entry has no matching artifact contract: ${key}`,
          path: ["artifactKeys", index],
        });
      }
    });
  });

export type ReadersBaseArtifactBridgeMetadataInput = z.input<
  typeof readersBaseArtifactBridgeMetadataSchema
>;
