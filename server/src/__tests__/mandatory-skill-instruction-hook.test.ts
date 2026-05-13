import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mandatorySkillInstructionPreHook } from "../services/lifecycle-hooks/mandatory-skill-instruction-hook.ts";

const originalHome = process.env.PAPERCLIP_HOME;
const originalInstance = process.env.PAPERCLIP_INSTANCE_ID;
const originalSkill = process.env.PAPERCLIP_MANDATORY_SKILL;
const originalInstruction = process.env.PAPERCLIP_MANDATORY_SKILL_INSTRUCTION;
const cleanupDirs = new Set<string>();

async function tempHome() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-mandatory-skill-"));
  cleanupDirs.add(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  cleanupDirs.clear();
  process.env.PAPERCLIP_HOME = originalHome;
  process.env.PAPERCLIP_INSTANCE_ID = originalInstance;
  process.env.PAPERCLIP_MANDATORY_SKILL = originalSkill;
  process.env.PAPERCLIP_MANDATORY_SKILL_INSTRUCTION = originalInstruction;
});

describe("mandatorySkillInstructionPreHook", () => {
  it("forces the configured skill into desired skills and wraps existing instructions", async () => {
    const home = await tempHome();
    process.env.PAPERCLIP_HOME = home;
    process.env.PAPERCLIP_INSTANCE_ID = "test";

    const existingInstructionsPath = path.join(home, "base-instructions.md");
    await fs.writeFile(existingInstructionsPath, "Keep issue context tight.\n", "utf8");

    const runtimeConfig: Record<string, unknown> = {
      instructionsFilePath: existingInstructionsPath,
      paperclipSkillSync: { desiredSkills: ["paperclipai/paperclip/paperclip"] },
      paperclipRuntimeSkills: [
        {
          key: "company/caveman",
          runtimeName: "caveman",
          source: path.join(home, "skills", "caveman"),
        },
      ],
    };
    const contextSnapshot: Record<string, unknown> = {};

    await mandatorySkillInstructionPreHook({
      db: {} as never,
      agent: {
        id: "agent-1",
        companyId: "company-1",
      } as never,
      run: {
        id: "run-1",
      } as never,
      runtimeConfig,
      contextSnapshot,
    });

    expect(runtimeConfig.paperclipSkillSync).toEqual({
      desiredSkills: ["paperclipai/paperclip/paperclip", "company/caveman"],
    });
    expect(runtimeConfig.instructionsFilePath).not.toBe(existingInstructionsPath);
    const generated = await fs.readFile(String(runtimeConfig.instructionsFilePath), "utf8");
    expect(generated).toContain("read and apply the `caveman` skill");
    expect(generated).toContain("Skill key: company/caveman");
    expect(generated).toContain("Keep issue context tight.");
    expect(contextSnapshot.mandatorySkillInstruction).toMatchObject({
      skillKey: "company/caveman",
      runtimeName: "caveman",
      originalInstructionsFilePath: existingInstructionsPath,
    });
  });

  it("leaves runtime config unchanged when the skill is unavailable", async () => {
    const runtimeConfig: Record<string, unknown> = {
      paperclipSkillSync: { desiredSkills: ["paperclipai/paperclip/paperclip"] },
      paperclipRuntimeSkills: [],
    };

    await mandatorySkillInstructionPreHook({
      db: {} as never,
      agent: {
        id: "agent-1",
        companyId: "company-1",
      } as never,
      run: {
        id: "run-1",
      } as never,
      runtimeConfig,
    });

    expect(runtimeConfig).toEqual({
      paperclipSkillSync: { desiredSkills: ["paperclipai/paperclip/paperclip"] },
      paperclipRuntimeSkills: [],
    });
  });
});
