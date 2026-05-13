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

const DEFAULT_SKILL_REFERENCE = "caveman";
const DEFAULT_INSTRUCTION =
  "At the start of every run, read and apply the `caveman` skill. Use its compression and terse-output rules for all planning, execution notes, and closeout unless a higher-priority instruction explicitly overrides it.";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function skillMatches(entry: PaperclipSkillEntry, reference: string): boolean {
  const wanted = normalize(reference);
  const key = normalize(entry.key);
  const runtimeName = normalize(entry.runtimeName ?? "");
  const slug = key.split("/").pop() ?? key;
  return key === wanted || runtimeName === wanted || slug === wanted;
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

function generatedInstructionPath(ctx: LifecycleContext, skillReference: string): string {
  const safeSkill = normalize(skillReference).replace(/[^a-z0-9._-]+/g, "-") || "skill";
  return path.resolve(
    resolvePaperclipInstanceRoot(),
    "runtime-hooks",
    "mandatory-skill-instructions",
    ctx.agent.companyId,
    ctx.run.id,
    `${safeSkill}.md`,
  );
}

export const mandatorySkillInstructionPreHook: PreHookHandler = async (ctx) => {
  const config = ctx.runtimeConfig;
  if (!config) return;

  const skillReference = asString(process.env.PAPERCLIP_MANDATORY_SKILL) ?? DEFAULT_SKILL_REFERENCE;
  const instruction = asString(process.env.PAPERCLIP_MANDATORY_SKILL_INSTRUCTION) ?? DEFAULT_INSTRUCTION;
  const runtimeSkills = getRuntimeSkills(config);
  const skill = runtimeSkills.find((entry) => skillMatches(entry, skillReference));
  if (!skill) return;

  const preference = readPaperclipSkillSyncPreference(config);
  const desiredSkills = Array.from(new Set([...preference.desiredSkills, skill.key]));
  Object.assign(config, writePaperclipSkillSyncPreference(config, desiredSkills));

  const existingInstructionsPath = asString(config.instructionsFilePath);
  const existingInstructions = await readExistingInstructions(existingInstructionsPath);
  const targetPath = generatedInstructionPath(ctx, skillReference);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(
    targetPath,
    [
      "# Paperclip Mandatory Runtime Instruction",
      "",
      instruction.replaceAll("`caveman`", `\`${skill.runtimeName ?? skill.key}\``),
      "",
      `Skill key: ${skill.key}`,
      `Skill runtime name: ${skill.runtimeName ?? skill.key}`,
      `Skill source: ${skill.source}`,
      "",
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
    ctx.contextSnapshot.mandatorySkillInstruction = {
      skillKey: skill.key,
      runtimeName: skill.runtimeName ?? skill.key,
      instructionsFilePath: targetPath,
      originalInstructionsFilePath: existingInstructionsPath,
    };
  }
};
