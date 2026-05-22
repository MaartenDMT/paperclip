/**
 * Mandatory Skill Instruction Hook.
 *
 * Pre-run hook that makes a configured runtime skill unavoidable in the
 * adapter prompt path. It forces the skill into paperclipSkillSync.desiredSkills
 * and wraps instructionsFilePath with a generated run-scoped instructions file.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  type PaperclipSkillEntry,
  readPaperclipSkillSyncPreference,
  writePaperclipSkillSyncPreference,
} from "@paperclipai/adapter-utils/server-utils";
import type { LifecycleContext, PreHookHandler } from "../lifecycle-hooks.js";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";

const DEFAULT_SKILL_REFERENCES = [
  "caveman",
  "karpathy-obsidian-memory",
  "para-memory-files",
] as const;
const DEFAULT_INSTRUCTIONS: Record<string, string> = {
  "caveman":
    "At the start of every run, read and apply the `caveman` skill. Use its compression and terse-output rules for all planning, execution notes, and closeout unless a higher-priority instruction explicitly overrides it.",
  "karpathy-obsidian-memory":
    "At the start of every run, read and apply the `karpathy-obsidian-memory` skill. Before starting work, search the memory graph for relevant prior work. Before declaring the run done, update the shared Obsidian issue memory with concise durable facts, decisions, blockers, and next steps.",
  "para-memory-files":
    "For any memory, planning, recall, daily-note, entity, or knowledge-organization operation, read and apply `para-memory-files`. Persist durable facts in the agent memory files instead of relying on session memory.",
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function skillMatchRank(entry: PaperclipSkillEntry, reference: string): number {
  const wanted = normalize(reference);
  const key = normalize(entry.key);
  const runtimeName = normalize(entry.runtimeName ?? "");
  const slug = key.split("/").pop() ?? key;
  if (key === wanted) return 0;
  if (runtimeName === wanted) return 1;
  if (slug === wanted) return 2;
  return Number.POSITIVE_INFINITY;
}

function findSkill(runtimeSkills: PaperclipSkillEntry[], reference: string): PaperclipSkillEntry | null {
  let best: { skill: PaperclipSkillEntry; rank: number } | null = null;
  for (const skill of runtimeSkills) {
    const rank = skillMatchRank(skill, reference);
    if (!Number.isFinite(rank)) continue;
    if (!best || rank < best.rank || (rank === best.rank && skill.key.localeCompare(best.skill.key) < 0)) {
      best = { skill, rank };
    }
  }
  return best?.skill ?? null;
}

function getRuntimeSkills(config: Record<string, unknown>): PaperclipSkillEntry[] {
  const raw = config.paperclipRuntimeSkills;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is PaperclipSkillEntry => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Record<string, unknown>;
    return (
      typeof candidate.key === "string" &&
      typeof candidate.runtimeName === "string" &&
      typeof candidate.source === "string"
    );
  });
}

async function readExistingInstructions(filePath: string | null): Promise<string> {
  if (!filePath) return "";
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function readMandatorySkillReferences() {
  const configured = asString(process.env.PAPERCLIP_MANDATORY_SKILLS)
    ?? asString(process.env.PAPERCLIP_MANDATORY_SKILL);
  if (!configured) return [...DEFAULT_SKILL_REFERENCES];
  return configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function instructionFor(reference: string, skill: PaperclipSkillEntry) {
  const configuredInstruction = asString(process.env.PAPERCLIP_MANDATORY_SKILL_INSTRUCTION);
  const base = configuredInstruction ?? DEFAULT_INSTRUCTIONS[normalize(reference)]
    ?? `At the start of every run, read and apply the \`${reference}\` skill when it is relevant.`;
  return base
    .replaceAll(`\`${reference}\``, `\`${skill.runtimeName ?? skill.key}\``)
    .replaceAll(reference, skill.runtimeName ?? skill.key);
}

function generatedInstructionPath(ctx: LifecycleContext): string {
  return path.resolve(
    resolvePaperclipInstanceRoot(),
    "runtime-hooks",
    "mandatory-skill-instructions",
    ctx.agent.companyId,
    ctx.run.id,
    "runtime-skills.md",
  );
}

export const mandatorySkillInstructionPreHook: PreHookHandler = async (ctx) => {
  const config = ctx.runtimeConfig;
  if (!config) return;

  const runtimeSkills = getRuntimeSkills(config);
  const selected = readMandatorySkillReferences()
    .map((reference) => ({ reference, skill: findSkill(runtimeSkills, reference) }))
    .filter((entry): entry is { reference: string; skill: PaperclipSkillEntry } => Boolean(entry.skill));
  if (selected.length === 0) return;

  const preference = readPaperclipSkillSyncPreference(config);
  const desiredSkills = Array.from(new Set([
    ...preference.desiredSkills,
    ...selected.map((entry) => entry.skill.key),
  ]));
  Object.assign(config, writePaperclipSkillSyncPreference(config, desiredSkills));

  const existingInstructionsPath = asString(config.instructionsFilePath);
  const existingInstructions = await readExistingInstructions(existingInstructionsPath);
  const targetPath = generatedInstructionPath(ctx);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(
    targetPath,
    [
      "# Paperclip Mandatory Runtime Instruction",
      "",
      ...selected.flatMap(({ reference, skill }) => [
        `## ${skill.runtimeName ?? skill.key}`,
        "",
        instructionFor(reference, skill),
        "",
        `Skill key: ${skill.key}`,
        `Skill runtime name: ${skill.runtimeName ?? skill.key}`,
        `Skill source: ${skill.source}`,
        "",
      ]),
      existingInstructions.trim()
        ? [
            "# Existing Agent Instructions",
            "",
            `The following instructions were originally loaded from ${existingInstructionsPath}.`,
            "",
            existingInstructions,
          ].join("\n")
        : "",
    ].filter(Boolean).join("\n") + "\n",
    "utf8",
  );

  config.instructionsFilePath = targetPath;
  if (ctx.contextSnapshot) {
    ctx.contextSnapshot.mandatorySkillInstructions = selected.map(({ skill }) => ({
      skillKey: skill.key,
      runtimeName: skill.runtimeName ?? skill.key,
      instructionsFilePath: targetPath,
      originalInstructionsFilePath: existingInstructionsPath,
    }));
    ctx.contextSnapshot.mandatorySkillInstruction = {
      skillKey: selected[0]!.skill.key,
      runtimeName: selected[0]!.skill.runtimeName ?? selected[0]!.skill.key,
      instructionsFilePath: targetPath,
      originalInstructionsFilePath: existingInstructionsPath,
    };
  }
};
