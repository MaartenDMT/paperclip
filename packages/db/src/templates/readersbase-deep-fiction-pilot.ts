import type { CreateIssueWorkProduct } from "@paperclipai/shared";
import { buildReadersBaseArtifactWorkProductInput } from "./readersbase-artifact-bridge.js";
import { READERSBASE_PUBLISHING_TEMPLATE } from "./readersbase-publishing.js";

export type ReadersBasePilotPhaseSlug =
  | "research"
  | "analysis"
  | "story-design"
  | "draft"
  | "editorial"
  | "publishing";

interface ReadersBasePilotPhaseRunbook {
  phaseSlug: ReadersBasePilotPhaseSlug;
  assignedRoleSlug: string;
  objective: string;
  requiredArtifactKeys: string[];
  approvalPoints: string[];
  gate: string;
  nextAgentInstructions: string;
}

interface ReadersBaseDeepFictionPilot {
  slug: string;
  title: string;
  format: "novel";
  genre: "fantasy" | "sci-fi";
  subgenre: string;
  campaignTemplateSlug: string;
  readersbaseProjectId: string;
  readersbaseSeriesId: string | null;
  readersbaseWorkId: string | null;
  safety: {
    noExternalPublication: true;
    noMassBookGeneration: true;
    noLiveReadersBaseMutation: true;
  };
  premise: string;
  readerPromise: string;
  firstRunSequence: ReadersBasePilotPhaseSlug[];
  phaseRunbook: ReadersBasePilotPhaseRunbook[];
}

function phaseRequiredArtifactKeys(phaseSlug: ReadersBasePilotPhaseSlug): string[] {
  const phase = READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates[0].phases.find(
    (candidate) => candidate.slug === phaseSlug,
  );
  if (!phase) {
    throw new Error(`unknown ReadersBase pilot phase: ${phaseSlug}`);
  }
  return [...(phase.requiredArtifactKeys ?? [])];
}

export const READERSBASE_DEEP_FICTION_PILOT: ReadersBaseDeepFictionPilot = {
  slug: "ashen-observatory-sci-fi-mystery-novel",
  title: "The Ashen Observatory",
  format: "novel",
  genre: "sci-fi",
  subgenre: "science-fantasy mystery",
  campaignTemplateSlug: "fiction-production",
  readersbaseProjectId: "pilot-readersbase-ashen-observatory",
  readersbaseSeriesId: null,
  readersbaseWorkId: null,
  safety: {
    noExternalPublication: true,
    noMassBookGeneration: true,
    noLiveReadersBaseMutation: true,
  },
  premise:
    "A disgraced orbital archivist investigates impossible star charts that predict murders inside a decaying monastery-observatory, uncovering a vanished civilization's memory engine before it rewrites the witnesses.",
  readerPromise:
    "Deliver an atmospheric sci-fi mystery novel with deep lore, fair-play clues, emotionally costly revelations, and a governed stop before any external publication or ReadersBase catalog mutation.",
  firstRunSequence: ["research", "analysis", "story-design"],
  phaseRunbook: [
    {
      phaseSlug: "research",
      assignedRoleSlug: "head-of-research",
      objective:
        "Collect market, audience, comparable-works, orbital-archive setting, memory-technology, monastery culture, mystery-structure, and sensitivity-risk evidence before story decisions.",
      requiredArtifactKeys: phaseRequiredArtifactKeys("research"),
      approvalPoints: ["Research lead completeness review", "Genre lead source-key review"],
      gate: "Research and Genre leads accept the research brief before analysis starts.",
      nextAgentInstructions:
        "Create the research brief first. Include comparable works, reader promise evidence, taxonomy source refs, setting/domain notes, confidence labels, risks, and open questions. Do not draft story scenes.",
    },
    {
      phaseSlug: "analysis",
      assignedRoleSlug: "head-of-genre",
      objective:
        "Turn research into a production thesis, genre-reader promise, format fit, taxonomy bridge manifest, and budget/scope decision for one novel only.",
      requiredArtifactKeys: phaseRequiredArtifactKeys("analysis"),
      approvalPoints: ["Production lead scope review", "Genre lead promise review", "Bridge validation"],
      gate: "Production, Genre, and Format leads agree the pilot is worth designing and bridge metadata remains metadata-only.",
      nextAgentInstructions:
        "Use the research brief as input. Produce classification-bridge-manifest and genre-reader-promise-gate artifacts. Confirm this remains a single sci-fi mystery novel pilot with no live ReadersBase mutation.",
    },
    {
      phaseSlug: "story-design",
      assignedRoleSlug: "head-of-story-architecture",
      objective:
        "Lock premise, mystery engine, character arcs, world rules, continuity ledger, clue/reveal structure, and format design before any drafting.",
      requiredArtifactKeys: phaseRequiredArtifactKeys("story-design"),
      approvalPoints: ["Story Architecture lead continuity signoff", "Format lead novel-fit signoff", "CEO story-lock review"],
      gate: "CEO approves story lock before draft issues are created.",
      nextAgentInstructions:
        "Build story-bible and format-design-spec artifacts from approved analysis only. Include fair-play mystery clue map, continuity ledger, setting rules, cast arcs, target length range, and draft readiness criteria.",
    },
    {
      phaseSlug: "draft",
      assignedRoleSlug: "head-of-drafting",
      objective:
        "Draft the manuscript only after story lock, then run deep-fiction QA against continuity, plot, character, conflict, setting, and pacing.",
      requiredArtifactKeys: phaseRequiredArtifactKeys("draft"),
      approvalPoints: ["Drafting lead review", "Continuity QA review", "CEO deep-fiction quality gate"],
      gate: "Deep-fiction quality gate is approved before editorial starts.",
      nextAgentInstructions:
        "Do not begin until story-design is approved. Produce draft-manuscript and deep-fiction-quality-gate artifacts as reviewable work products.",
    },
    {
      phaseSlug: "editorial",
      assignedRoleSlug: "head-of-editorial",
      objective:
        "Complete developmental, line, copy, sensitivity, rights, and risk review with traceable revision instructions.",
      requiredArtifactKeys: phaseRequiredArtifactKeys("editorial"),
      approvalPoints: ["Editorial lead acceptance", "Final acceptance reviewer readiness check"],
      gate: "Editorial review report is approved before publishing package work starts.",
      nextAgentInstructions:
        "Review the approved manuscript and QA output. Return an editorial-review-report with required revisions, accepted risks, and no-publication status.",
    },
    {
      phaseSlug: "publishing",
      assignedRoleSlug: "head-of-publishing",
      objective:
        "Prepare metadata, packaging, launch copy, bridge manifest, and board approval manifest without publishing externally.",
      requiredArtifactKeys: phaseRequiredArtifactKeys("publishing"),
      approvalPoints: ["Bridge validation", "CEO review", "Board approval", "Final acceptance"],
      gate: "Board approval is required before any external publication or ReadersBase catalog mutation, both of which are out of scope for this pilot.",
      nextAgentInstructions:
        "Prepare publishing-package and publishing-approval-manifest only. Mark the package needs_board_review and preserve noLiveReadersBaseMutation=true.",
    },
  ],
};

export function buildReadersBaseDeepFictionPilotWorkProducts(): CreateIssueWorkProduct[] {
  return READERSBASE_DEEP_FICTION_PILOT.phaseRunbook.map((phase) =>
    buildReadersBaseArtifactWorkProductInput({
      template: READERSBASE_PUBLISHING_TEMPLATE,
      campaignSlug: READERSBASE_DEEP_FICTION_PILOT.campaignTemplateSlug,
      phaseSlug: phase.phaseSlug,
      readersbaseProjectId: READERSBASE_DEEP_FICTION_PILOT.readersbaseProjectId,
      readersbaseSeriesId: READERSBASE_DEEP_FICTION_PILOT.readersbaseSeriesId,
      readersbaseWorkId: READERSBASE_DEEP_FICTION_PILOT.readersbaseWorkId,
      summary: `${READERSBASE_DEEP_FICTION_PILOT.title} ${phase.phaseSlug} phase artifact handoff.`,
      nextAgentInstructions: phase.nextAgentInstructions,
      blockers:
        phase.phaseSlug === "publishing"
          ? ["External publication is out of scope until explicit board approval and a future live ReadersBase bridge exist."]
          : undefined,
    }),
  );
}
