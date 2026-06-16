// Skill-activation helpers extracted from heartbeat.ts.
//
// Two related concerns live here:
//   1. Normalizing the skill activations an adapter reports after a run, mapping
//      loosely-specified keys back to the company's canonical runtime skill keys.
//   2. Resolving which company skills an issue's text "mentions", and writing
//      those as run-scoped desired skills into the adapter config.
// All functions are pure except resolveRunScopedMentionedSkillKeys, which only
// reads from the passed-in Db and holds no heartbeat state.

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companySkills as companySkillsTable, issueComments, issues } from "@paperclipai/db";
import { extractSkillMentionIds } from "@paperclipai/shared";
import {
  readPaperclipSkillSyncPreference,
  writePaperclipSkillSyncPreference,
} from "@paperclipai/adapter-utils/server-utils";
import type { AdapterExecutionResult } from "../../adapters/index.js";

type NormalizedSkillActivation = {
  skillKey: string;
  skillName: string;
  activatedAt: Date;
  source: string;
};

type RuntimeSkillReference = {
  key: string;
  runtimeName?: string | null;
};

function normalizeSkillActivationKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, 160);
}

function canonicalizeSkillActivationKey(
  value: string,
  runtimeSkills: RuntimeSkillReference[],
): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return value;

  const exactKey = runtimeSkills.find((skill) => skill.key.trim().toLowerCase() === normalized);
  if (exactKey) return exactKey.key;

  const exactRuntimeName = runtimeSkills.find((skill) =>
    typeof skill.runtimeName === "string" && skill.runtimeName.trim().toLowerCase() === normalized,
  );
  if (exactRuntimeName) return exactRuntimeName.key;

  const slugMatches = runtimeSkills.filter((skill) =>
    skill.key.trim().toLowerCase().split("/").pop() === normalized,
  );
  if (slugMatches.length === 1) return slugMatches[0]!.key;

  return value;
}

export function normalizeAdapterSkillActivations(
  value: AdapterExecutionResult["skillActivations"],
  runtimeSkills: RuntimeSkillReference[] = [],
  now = new Date(),
): NormalizedSkillActivation[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const result: NormalizedSkillActivation[] = [];
  for (const activation of value) {
    const rawSkillKey = normalizeSkillActivationKey(activation?.skillKey);
    if (!rawSkillKey) continue;
    const skillKey = canonicalizeSkillActivationKey(rawSkillKey, runtimeSkills);
    const skillName = normalizeSkillActivationKey(activation.skillName) ?? rawSkillKey;
    const source = normalizeSkillActivationKey(activation.source) ?? "adapter";
    const parsedActivatedAt = activation.activatedAt ? new Date(activation.activatedAt) : null;
    result.push({
      skillKey,
      skillName,
      source,
      activatedAt: parsedActivatedAt && !Number.isNaN(parsedActivatedAt.getTime()) ? parsedActivatedAt : now,
    });
  }
  return result;
}

export function extractMentionedSkillIdsFromSources(
  sources: Array<string | null | undefined>,
): string[] {
  const mentionedIds = new Set<string>();
  for (const source of sources) {
    if (typeof source !== "string" || source.length === 0) continue;
    for (const skillId of extractSkillMentionIds(source)) {
      mentionedIds.add(skillId);
    }
  }
  return [...mentionedIds];
}

export function applyRunScopedMentionedSkillKeys(
  config: Record<string, unknown>,
  skillKeys: string[],
): Record<string, unknown> {
  const normalizedSkillKeys = Array.from(
    new Set(
      skillKeys
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  if (normalizedSkillKeys.length === 0) return config;

  const existingPreference = readPaperclipSkillSyncPreference(config);
  return writePaperclipSkillSyncPreference(config, [
    ...existingPreference.desiredSkills,
    ...normalizedSkillKeys,
  ]);
}

export async function resolveRunScopedMentionedSkillKeys(input: {
  db: Db;
  companyId: string;
  issueId: string | null;
}): Promise<string[]> {
  if (!input.issueId) return [];

  const issue = await input.db
    .select({
      title: issues.title,
      description: issues.description,
    })
    .from(issues)
    .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)))
    .then((rows) => rows[0] ?? null);
  if (!issue) return [];

  const comments = await input.db
    .select({ body: issueComments.body })
    .from(issueComments)
    .where(
      and(
        eq(issueComments.issueId, input.issueId),
        eq(issueComments.companyId, input.companyId),
      ),
    );
  const mentionedSkillIds = extractMentionedSkillIdsFromSources([
    issue.title,
    issue.description ?? "",
    ...comments.map((comment) => comment.body),
  ]);
  if (mentionedSkillIds.length === 0) return [];

  const skillRows = await input.db
    .select({
      id: companySkillsTable.id,
      key: companySkillsTable.key,
    })
    .from(companySkillsTable)
    .where(
      and(
        eq(companySkillsTable.companyId, input.companyId),
        inArray(companySkillsTable.id, mentionedSkillIds),
      ),
    );
  const skillKeyById = new Map(skillRows.map((row) => [row.id, row.key]));
  return mentionedSkillIds
    .map((skillId) => skillKeyById.get(skillId) ?? null)
    .filter((skillKey): skillKey is string => Boolean(skillKey));
}
