import { describe, expect, it } from "vitest";
import { READERSBASE_DEEP_FICTION_PILOT } from "./readersbase-deep-fiction-pilot.js";
import {
  READERSBASE_PUBLISHING_FORMATS,
  READERSBASE_PUBLISHING_TEMPLATE,
} from "./readersbase-publishing.js";
import {
  READERSBASE_SHARED_TYPES_CATALOG_CONTRACT,
  validateReadersBaseBridgeContract,
} from "./readersbase-contract-validation.js";

describe("validateReadersBaseBridgeContract", () => {
  it("accepts the ReadersBase publishing template against the shared-types catalog contract", () => {
    const result = validateReadersBaseBridgeContract({
      template: READERSBASE_PUBLISHING_TEMPLATE,
      publishingFormats: READERSBASE_PUBLISHING_FORMATS,
      pilot: READERSBASE_DEEP_FICTION_PILOT,
      catalog: READERSBASE_SHARED_TYPES_CATALOG_CONTRACT,
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects stale ReadersBase taxonomy and bridge artifact keys before live mutation exists", () => {
    const result = validateReadersBaseBridgeContract({
      template: {
        ...READERSBASE_PUBLISHING_TEMPLATE,
        artifactContracts: [
          ...READERSBASE_PUBLISHING_TEMPLATE.artifactContracts,
          {
            ...READERSBASE_PUBLISHING_TEMPLATE.artifactContracts[0],
            key: "stale-artifact-key",
            phaseSlug: "ghost-phase",
          },
        ],
        campaignTemplates: [
          {
            ...READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates[0],
            phases: [
              ...READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates[0].phases,
              {
                ...READERSBASE_PUBLISHING_TEMPLATE.campaignTemplates[0].phases[0],
                slug: "ghost-phase",
                sequence: 99,
                requiredArtifactKeys: ["stale-artifact-key"],
              },
            ],
          },
        ],
        metadata: {
          ...READERSBASE_PUBLISHING_TEMPLATE.metadata,
          priorityRouting: {
            ...(READERSBASE_PUBLISHING_TEMPLATE.metadata?.priorityRouting as Record<
              string,
              unknown
            >),
            primaryFormats: ["novel", "dead-format"],
            priorityGenres: ["fantasy", "dead-genre"],
          },
        },
      },
      publishingFormats: [...READERSBASE_PUBLISHING_FORMATS, "dead-format"],
      pilot: {
        ...READERSBASE_DEEP_FICTION_PILOT,
        format: "dead-format" as "novel",
        genre: "dead-genre" as "fantasy",
      },
      catalog: READERSBASE_SHARED_TYPES_CATALOG_CONTRACT,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "unknown ReadersBase work type in publishingFormats: dead-format",
        "unknown ReadersBase work type in template priorityRouting.primaryFormats: dead-format",
        "unknown ReadersBase genre in template priorityRouting.priorityGenres: dead-genre",
        "unknown ReadersBase work type in pilot format: dead-format",
        "unknown ReadersBase genre in pilot genre: dead-genre",
        "artifact contract stale-artifact-key uses unknown ReadersBase bridge phase: ghost-phase",
      ]),
    );
  });
});