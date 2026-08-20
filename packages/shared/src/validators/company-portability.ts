import { z } from "zod";
import { PERMISSION_KEYS } from "../constants.js";
import { MAX_COMPANY_ATTACHMENT_MAX_BYTES } from "../constants.js";
import {
  issueCommentAuthorTypeSchema,
  issueCommentMetadataSchema,
  issueCommentPresentationSchema,
} from "./issue.js";
import { routineVariableSchema } from "./routine.js";

export const portabilitySpecialistRoleSchema = z.enum([
  "research",
  "growth",
  "content",
  "product_customer",
  "ops_finance",
  "security_risk",
  "engineering_release",
]);

const httpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Only HTTP(S) URLs are allowed");

const relativeSourcePathSchema = z.string().min(1).refine((value) => (
  !value.startsWith("/")
  && !value.startsWith("\\")
  && !/^[A-Za-z]:[\\/]/.test(value)
  && !value.toLowerCase().startsWith("file:")
), "Source paths must be relative local paths");

const maosSourceLinkSchema = z.object({
  system: z.enum(["readersbase", "sma", "vault", "other"]),
  label: z.string().min(1),
  url: httpUrlSchema.optional(),
  path: relativeSourcePathSchema.optional(),
}).refine((value) => value.url || value.path, "A source link needs url or path");

const companyMaosMetadataSchema = z.object({
  company_id: z.string().min(1).optional(),
  system_id: z.string().min(1).optional(),
  initiative_id: z.string().min(1).optional(),
  initiative_kind: z.literal("goal").optional(),
  milestone_id: z.string().min(1).optional(),
  milestone_kind: z.enum(["project", "issue"]).optional(),
  source_links: z.array(maosSourceLinkSchema).optional(),
  approval_boundary: z.string().min(1).optional(),
  kpis: z.array(z.object({
    name: z.string().min(1),
    unit: z.string().min(1).optional(),
    source_link: httpUrlSchema.optional(),
    target: z.union([z.string().min(1), z.number()]),
  })).optional(),
  specialist_ownership: z.array(portabilitySpecialistRoleSchema).min(1).optional(),
  handoff_contracts: z.array(z.object({
    from: portabilitySpecialistRoleSchema,
    to: portabilitySpecialistRoleSchema,
    deliverable: z.string().min(1),
    acceptance: z.string().min(1),
  })).optional(),
}).strict().superRefine((value, ctx) => {
  const requirePair = (idKey: "initiative_id" | "milestone_id", kindKey: "initiative_kind" | "milestone_kind") => {
    if ((value[idKey] === undefined) !== (value[kindKey] === undefined)) {
      ctx.addIssue({ code: "custom", path: [idKey], message: `${idKey} and ${kindKey} must be provided together` });
    }
  };
  requirePair("initiative_id", "initiative_kind");
  requirePair("milestone_id", "milestone_kind");
  const ownership = new Set(value.specialist_ownership ?? []);
  for (const [index, handoff] of (value.handoff_contracts ?? []).entries()) {
    if (handoff.from === handoff.to) {
      ctx.addIssue({ code: "custom", path: ["handoff_contracts", index], message: "Handoff roles must differ" });
    }
    if (!ownership.has(handoff.from) || !ownership.has(handoff.to)) {
      ctx.addIssue({ code: "custom", path: ["handoff_contracts", index], message: "Handoff roles must be declared in specialist_ownership" });
    }
  }
});

export const portabilityCompanyMetadataSchema = z.object({
  maos: companyMaosMetadataSchema.optional(),
}).passthrough();

export const portabilityAgentMetadataSchema = z.object({
  maos: z.object({
    specialist_role: portabilitySpecialistRoleSchema,
  }).strict().optional(),
}).passthrough();

export const portabilityIncludeSchema = z
  .object({
    company: z.boolean().optional(),
    agents: z.boolean().optional(),
    projects: z.boolean().optional(),
    issues: z.boolean().optional(),
    skills: z.boolean().optional(),
  })
  .partial();

export const portabilityEnvInputSchema = z.object({
  key: z.string().min(1),
  description: z.string().nullable(),
  agentSlug: z.string().min(1).nullable(),
  projectSlug: z.string().min(1).nullable(),
  kind: z.enum(["secret", "plain"]),
  requirement: z.enum(["required", "optional"]),
  defaultValue: z.string().nullable(),
  portability: z.enum(["portable", "system_dependent"]),
});

export const portabilityFileEntrySchema = z.union([
  z.string(),
  z.object({
    encoding: z.literal("base64"),
    data: z.string(),
    contentType: z.string().min(1).optional().nullable(),
  }),
]);

export const portabilityCompanyManifestEntrySchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  brandColor: z.string().nullable(),
  logoPath: z.string().nullable(),
  attachmentMaxBytes: z.number().int().min(1).max(MAX_COMPANY_ATTACHMENT_MAX_BYTES).nullable().default(null),
  requireBoardApprovalForNewAgents: z.boolean(),
  feedbackDataSharingEnabled: z.boolean().default(false),
  feedbackDataSharingConsentAt: z.string().datetime().nullable().default(null),
  feedbackDataSharingConsentByUserId: z.string().nullable().default(null),
  feedbackDataSharingTermsVersion: z.string().nullable().default(null),
  metadata: portabilityCompanyMetadataSchema.nullable().optional(),
});

export const portabilitySidebarOrderSchema = z.object({
  agents: z.array(z.string().min(1)).default([]),
  projects: z.array(z.string().min(1)).default([]),
});

export const portabilityAgentManifestEntrySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  skills: z.array(z.string().min(1)).default([]),
  role: z.string().min(1),
  title: z.string().nullable(),
  icon: z.string().nullable(),
  capabilities: z.string().nullable(),
  reportsToSlug: z.string().min(1).nullable(),
  adapterType: z.string().min(1),
  adapterConfig: z.record(z.string(), z.unknown()),
  runtimeConfig: z.record(z.string(), z.unknown()),
  permissions: z.record(z.string(), z.unknown()),
  permissionGrants: z.array(z.object({
    permissionKey: z.enum(PERMISSION_KEYS),
    scope: z.record(z.string(), z.unknown()).nullable().default(null),
  })).default([]),
  budgetMonthlyCents: z.number().int().nonnegative(),
  metadata: portabilityAgentMetadataSchema.nullable(),
});

export const portabilitySkillManifestEntrySchema = z.object({
  key: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().nullable(),
  sourceType: z.string().min(1),
  sourceLocator: z.string().nullable(),
  sourceRef: z.string().nullable(),
  trustLevel: z.string().nullable(),
  compatibility: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  fileInventory: z.array(z.object({
    path: z.string().min(1),
    kind: z.string().min(1),
  })).default([]),
});

export const portabilityProjectManifestEntrySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().nullable(),
  ownerAgentSlug: z.string().min(1).nullable(),
  leadAgentSlug: z.string().min(1).nullable(),
  targetDate: z.string().nullable(),
  color: z.string().nullable(),
  status: z.string().nullable(),
  executionWorkspacePolicy: z.record(z.string(), z.unknown()).nullable(),
  workspaces: z.array(z.object({
    key: z.string().min(1),
    name: z.string().min(1),
    sourceType: z.string().nullable(),
    repoUrl: z.string().nullable(),
    repoRef: z.string().nullable(),
    defaultRef: z.string().nullable(),
    visibility: z.string().nullable(),
    setupCommand: z.string().nullable(),
    cleanupCommand: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    isPrimary: z.boolean(),
  })).default([]),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const portabilityIssueRoutineTriggerManifestEntrySchema = z.object({
  kind: z.string().min(1),
  label: z.string().nullable(),
  enabled: z.boolean(),
  cronExpression: z.string().nullable(),
  timezone: z.string().nullable(),
  signingMode: z.string().nullable(),
  replayWindowSec: z.number().int().nullable(),
});

export const portabilityIssueRoutineManifestEntrySchema = z.object({
  concurrencyPolicy: z.string().nullable(),
  catchUpPolicy: z.string().nullable(),
  variables: z.array(routineVariableSchema).nullable().optional(),
  triggers: z.array(portabilityIssueRoutineTriggerManifestEntrySchema).default([]),
});

export const portabilityIssueCommentManifestEntrySchema = z.object({
  body: z.string().min(1),
  authorType: issueCommentAuthorTypeSchema,
  authorAgentSlug: z.string().min(1).nullable(),
  authorUserId: z.string().nullable(),
  presentation: issueCommentPresentationSchema.nullable(),
  metadata: issueCommentMetadataSchema.nullable(),
  createdAt: z.string().datetime().nullable(),
});

export const portabilityIssueManifestEntrySchema = z.object({
  slug: z.string().min(1),
  identifier: z.string().min(1).nullable(),
  title: z.string().min(1),
  path: z.string().min(1),
  projectSlug: z.string().min(1).nullable(),
  projectWorkspaceKey: z.string().min(1).nullable(),
  assigneeAgentSlug: z.string().min(1).nullable(),
  description: z.string().nullable(),
  recurring: z.boolean().default(false),
  routine: portabilityIssueRoutineManifestEntrySchema.nullable(),
  legacyRecurrence: z.record(z.string(), z.unknown()).nullable(),
  status: z.string().nullable(),
  priority: z.string().nullable(),
  labelIds: z.array(z.string().min(1)).default([]),
  billingCode: z.string().nullable(),
  executionWorkspaceSettings: z.record(z.string(), z.unknown()).nullable(),
  assigneeAdapterOverrides: z.record(z.string(), z.unknown()).nullable(),
  comments: z.array(portabilityIssueCommentManifestEntrySchema).default([]),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const portabilityManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  source: z
    .object({
      companyId: z.string().uuid(),
      companyName: z.string().min(1),
    })
    .nullable(),
  includes: z.object({
    company: z.boolean(),
    agents: z.boolean(),
    projects: z.boolean(),
    issues: z.boolean(),
    skills: z.boolean(),
  }),
  company: portabilityCompanyManifestEntrySchema.nullable(),
  sidebar: portabilitySidebarOrderSchema.nullable(),
  agents: z.array(portabilityAgentManifestEntrySchema),
  skills: z.array(portabilitySkillManifestEntrySchema).default([]),
  projects: z.array(portabilityProjectManifestEntrySchema).default([]),
  issues: z.array(portabilityIssueManifestEntrySchema).default([]),
  envInputs: z.array(portabilityEnvInputSchema).default([]),
});

export const portabilitySourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("inline"),
    rootPath: z.string().min(1).optional().nullable(),
    files: z.record(z.string(), portabilityFileEntrySchema),
  }),
  z.object({
    type: z.literal("github"),
    url: z.string().url(),
  }),
]);

export const portabilityTargetSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new_company"),
    newCompanyName: z.string().min(1).optional().nullable(),
  }),
  z.object({
    mode: z.literal("existing_company"),
    companyId: z.string().uuid(),
  }),
]);

export const portabilityAgentSelectionSchema = z.union([
  z.literal("all"),
  z.array(z.string().min(1)),
]);

export const portabilityCollisionStrategySchema = z.enum(["rename", "skip", "replace"]);

export const companyPortabilityExportSchema = z.object({
  include: portabilityIncludeSchema.optional(),
  agents: z.array(z.string().min(1)).optional(),
  skills: z.array(z.string().min(1)).optional(),
  projects: z.array(z.string().min(1)).optional(),
  issues: z.array(z.string().min(1)).optional(),
  projectIssues: z.array(z.string().min(1)).optional(),
  selectedFiles: z.array(z.string().min(1)).optional(),
  expandReferencedSkills: z.boolean().optional(),
  sidebarOrder: portabilitySidebarOrderSchema.partial().optional(),
});

export type CompanyPortabilityExport = z.infer<typeof companyPortabilityExportSchema>;

export const companyPortabilityPreviewSchema = z.object({
  source: portabilitySourceSchema,
  include: portabilityIncludeSchema.optional(),
  target: portabilityTargetSchema,
  agents: portabilityAgentSelectionSchema.optional(),
  collisionStrategy: portabilityCollisionStrategySchema.optional(),
  nameOverrides: z.record(z.string().min(1), z.string().min(1)).optional(),
  selectedFiles: z.array(z.string().min(1)).optional(),
});

export type CompanyPortabilityPreview = z.infer<typeof companyPortabilityPreviewSchema>;

export const portabilityAdapterOverrideSchema = z.object({
  adapterType: z.string().min(1),
  adapterConfig: z.record(z.string(), z.unknown()).optional(),
});

export const companyPortabilityImportSchema = companyPortabilityPreviewSchema.extend({
  adapterOverrides: z.record(z.string().min(1), portabilityAdapterOverrideSchema).optional(),
  secretValues: z.record(z.string().min(1), z.string()).optional(),
});

export type CompanyPortabilityImport = z.infer<typeof companyPortabilityImportSchema>;
