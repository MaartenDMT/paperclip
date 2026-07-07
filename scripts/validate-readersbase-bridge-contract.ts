import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  READERSBASE_DEEP_FICTION_PILOT,
  READERSBASE_PUBLISHING_FORMATS,
  READERSBASE_PUBLISHING_TEMPLATE,
  READERSBASE_SHARED_TYPES_CATALOG_CONTRACT,
  validateReadersBaseBridgeContract,
} from "../packages/db/src/templates/index.js";

interface ReadersBaseReaderTaxonomyModule {
  READER_FILTERABLE_WORK_TYPE_OPTIONS: readonly string[];
}

interface ReadersBaseGenreTaxonomyModule {
  GENRE_SUBGENRE_MAP: Record<string, readonly string[]>;
}

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function diffValues(label: string, expected: readonly string[], actual: readonly string[]): string[] {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((value) => !actualSet.has(value));
  const extra = actual.filter((value) => !expectedSet.has(value));
  const issues: string[] = [];

  if (missing.length > 0) {
    issues.push(`${label} missing from live ReadersBase shared-types: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    issues.push(`${label} not present in Paperclip bridge contract: ${extra.join(", ")}`);
  }

  return issues;
}

async function importReadersBaseModule<T>(repoPath: string, relativePath: string): Promise<T> {
  const absolutePath = resolve(repoPath, relativePath);
  return (await import(pathToFileURL(absolutePath).href)) as T;
}

async function main(): Promise<void> {
  const readersBaseRepoPath = process.env.READERSBASE_REPO_PATH ?? resolve("..", "base");
  const readerTaxonomy = await importReadersBaseModule<ReadersBaseReaderTaxonomyModule>(
    readersBaseRepoPath,
    "packages/shared-types/src/reader-taxonomy.ts",
  );
  const genreTaxonomy = await importReadersBaseModule<ReadersBaseGenreTaxonomyModule>(
    readersBaseRepoPath,
    "packages/shared-types/src/genre-taxonomy.ts",
  );
  const liveWorkTypes = sortedUnique(readerTaxonomy.READER_FILTERABLE_WORK_TYPE_OPTIONS);
  const liveGenres = sortedUnique(Object.values(genreTaxonomy.GENRE_SUBGENRE_MAP).flat());
  const contractWorkTypes = sortedUnique(READERSBASE_SHARED_TYPES_CATALOG_CONTRACT.readerWorkTypes);
  const contractGenres = sortedUnique(READERSBASE_SHARED_TYPES_CATALOG_CONTRACT.genres);
  const issues = [
    ...diffValues("work type", contractWorkTypes, liveWorkTypes),
    ...diffValues("genre", contractGenres, liveGenres),
  ];
  const bridgeValidation = validateReadersBaseBridgeContract({
    template: READERSBASE_PUBLISHING_TEMPLATE,
    publishingFormats: READERSBASE_PUBLISHING_FORMATS,
    pilot: READERSBASE_DEEP_FICTION_PILOT,
    catalog: READERSBASE_SHARED_TYPES_CATALOG_CONTRACT,
  });

  issues.push(...bridgeValidation.issues);

  if (issues.length > 0) {
    console.error("ReadersBase bridge validation failed:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `ReadersBase bridge validation passed: ${contractWorkTypes.length} work types, ${contractGenres.length} genres, ${READERSBASE_SHARED_TYPES_CATALOG_CONTRACT.bridgePhaseSlugs.length} bridge phases.`,
  );
  console.log(`ReadersBase repo: ${readersBaseRepoPath}`);
}

await main();
