import type { CompanyTemplateDefinition } from "@paperclipai/shared";

export interface ReadersBaseSharedTypesCatalogContract {
  source: {
    repository: "ReadersBase";
    package: "@ai-book/shared-types";
    files: string[];
    commit: string;
  };
  noLiveReadersBaseMutation: true;
  readerWorkTypes: readonly string[];
  genres: readonly string[];
  bridgePhaseSlugs: readonly string[];
}

export interface ReadersBaseBridgeValidationPilot {
  format: string;
  genre: string;
  subgenre?: string;
  safety: {
    noLiveReadersBaseMutation: true;
  };
}

export interface ValidateReadersBaseBridgeContractInput {
  template: CompanyTemplateDefinition;
  publishingFormats: readonly string[];
  pilot?: ReadersBaseBridgeValidationPilot;
  catalog: ReadersBaseSharedTypesCatalogContract;
}

export interface ReadersBaseBridgeContractValidationResult {
  ok: boolean;
  issues: string[];
}

// Stable read-only catalog generated from ReadersBase @ai-book/shared-types.
// Source files:
// - packages/shared-types/src/reader-taxonomy.ts
// - packages/shared-types/src/genre-taxonomy.ts
// Refresh this snapshot from ReadersBase before adding any live bridge mutation path.
export const READERSBASE_SHARED_TYPES_CATALOG_CONTRACT: ReadersBaseSharedTypesCatalogContract = {
  source: {
    repository: "ReadersBase",
    package: "@ai-book/shared-types",
    files: [
      "packages/shared-types/src/reader-taxonomy.ts",
      "packages/shared-types/src/genre-taxonomy.ts",
    ],
    commit: "3fcd462cc",
  },
  noLiveReadersBaseMutation: true,
  readerWorkTypes: [
    "novel",
    "novella",
    "short-story",
    "graphic-novel",
    "storybook",
    "interactive-novel",
    "interactive-novella",
    "interactive-short-story",
  ],
  genres: [
    "fantasy",
    "sci-fi",
    "mystery",
    "romance",
    "thriller",
    "horror",
    "literary",
    "historical",
    "urban_fantasy",
    "epic_fantasy",
    "dark_fantasy",
    "high_fantasy",
    "grimdark",
    "sword_and_sorcery",
    "portal_fantasy",
    "isekai",
    "cozy_fantasy",
    "romantasy",
    "space_opera",
    "space_western",
    "cyberpunk",
    "steampunk",
    "military_sci_fi",
    "hard_sci_fi",
    "soft_sci_fi",
    "science_fantasy",
    "climate_fiction",
    "solarpunk",
    "biopunk",
    "nanopunk",
    "posthuman",
    "cozy_mystery",
    "procedural",
    "police_procedural",
    "paranormal_romance",
    "romantic_suspense",
    "rom_com",
    "young_adult",
    "middle_grade",
    "new_adult",
    "contemporary",
    "book_club_fiction",
    "upmarket_fiction",
    "womens_fiction",
    "dystopian",
    "post_apocalyptic",
    "alternate_history",
    "psychological_thriller",
    "domestic_thriller",
    "legal_thriller",
    "techno_thriller",
    "espionage_thriller",
    "crime",
    "noir",
    "western",
    "adventure",
    "gothic_horror",
    "cosmic_horror",
    "folk_horror",
    "slasher",
    "satire",
    "magical_realism",
    "biography",
    "memoir",
    "autobiography",
    "self_help",
    "business",
    "economics",
    "politics",
    "psychology",
    "philosophy",
    "religion",
    "spirituality",
    "science",
    "technology",
    "travel",
    "cooking",
    "health",
    "other",
  ],
  bridgePhaseSlugs: [
    "research",
    "analysis",
    "story-design",
    "draft",
    "editorial",
    "publishing",
  ],
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function validateKnownValues(
  issues: string[],
  values: readonly string[],
  knownValues: ReadonlySet<string>,
  label: string,
): void {
  for (const value of values) {
    if (!knownValues.has(value)) {
      issues.push(`unknown ReadersBase ${label}: ${value}`);
    }
  }
}

export function validateReadersBaseBridgeContract(
  input: ValidateReadersBaseBridgeContractInput,
): ReadersBaseBridgeContractValidationResult {
  const issues: string[] = [];
  const knownWorkTypes = new Set(input.catalog.readerWorkTypes);
  const knownGenres = new Set(input.catalog.genres);
  const knownBridgePhases = new Set(input.catalog.bridgePhaseSlugs);
  const bridgeBoundary = input.template.metadata?.bridgeBoundary;
  const priorityRouting = input.template.metadata?.priorityRouting as
    | Record<string, unknown>
    | undefined;
  const contractKeys = new Set(
    input.template.artifactContracts.map((contract) => contract.key),
  );

  if (input.catalog.noLiveReadersBaseMutation !== true) {
    issues.push("ReadersBase catalog contract must be read-only");
  }

  if (
    typeof bridgeBoundary !== "string" ||
    !bridgeBoundary.includes("metadata-only") ||
    !bridgeBoundary.includes("mutation is deferred")
  ) {
    issues.push(
      "template metadata.bridgeBoundary must keep ReadersBase mutation deferred and metadata-only",
    );
  }

  validateKnownValues(
    issues,
    input.publishingFormats,
    knownWorkTypes,
    "work type in publishingFormats",
  );
  validateKnownValues(
    issues,
    asStringArray(priorityRouting?.primaryFormats),
    knownWorkTypes,
    "work type in template priorityRouting.primaryFormats",
  );
  validateKnownValues(
    issues,
    asStringArray(priorityRouting?.priorityGenres),
    knownGenres,
    "genre in template priorityRouting.priorityGenres",
  );

  for (const contract of input.template.artifactContracts) {
    if (!knownBridgePhases.has(contract.phaseSlug)) {
      issues.push(
        `artifact contract ${contract.key} uses unknown ReadersBase bridge phase: ${contract.phaseSlug}`,
      );
    }
  }

  for (const campaign of input.template.campaignTemplates) {
    for (const phase of campaign.phases) {
      if (!knownBridgePhases.has(phase.slug)) {
        issues.push(`unknown ReadersBase bridge phase in campaign ${campaign.slug}: ${phase.slug}`);
      }
      for (const artifactKey of phase.requiredArtifactKeys ?? []) {
        if (!contractKeys.has(artifactKey)) {
          issues.push(
            `campaign ${campaign.slug} phase ${phase.slug} requires unknown bridge artifact key: ${artifactKey}`,
          );
        }
      }
    }
  }

  if (input.pilot) {
    validateKnownValues(
      issues,
      [input.pilot.format],
      knownWorkTypes,
      "work type in pilot format",
    );
    validateKnownValues(
      issues,
      [input.pilot.genre],
      knownGenres,
      "genre in pilot genre",
    );
    if (input.pilot.subgenre) {
      validateKnownValues(
        issues,
        [input.pilot.subgenre],
        knownGenres,
        "genre in pilot subgenre",
      );
    }
    if (input.pilot.safety.noLiveReadersBaseMutation !== true) {
      issues.push("pilot safety must keep noLiveReadersBaseMutation=true");
    }
  }

  return { ok: issues.length === 0, issues };
}

export function assertValidReadersBaseBridgeContract(
  input: ValidateReadersBaseBridgeContractInput,
): void {
  const result = validateReadersBaseBridgeContract(input);
  if (!result.ok) {
    throw new Error(`invalid ReadersBase bridge contract: ${result.issues.join("; ")}`);
  }
}
