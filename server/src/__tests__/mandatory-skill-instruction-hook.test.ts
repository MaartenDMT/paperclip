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
  it("forces default mandatory skills into desired skills and wraps existing instructions", async () => {
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
        {
          key: "company/caveman-copy",
          runtimeName: "caveman--4573ebe2fc",
          source: path.join(home, "skills", "caveman-copy"),
        },
        {
          key: "company/karpathy-obsidian-memory",
          runtimeName: "karpathy-obsidian-memory",
          source: path.join(home, "skills", "karpathy-obsidian-memory"),
        },
        {
          key: "paperclipai/paperclip/para-memory-files",
          runtimeName: "para-memory-files",
          source: path.join(home, "skills", "para-memory-files"),
        },
        {
          key: "paperclipai/paperclip/paperclip",
          runtimeName: "paperclip",
          source: path.join(home, "skills", "paperclip"),
        },
        {
          key: "paperclipai/paperclip/diagnose-why-work-stopped",
          runtimeName: "diagnose-why-work-stopped",
          source: path.join(home, "skills", "diagnose-why-work-stopped"),
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
      desiredSkills: [
        "paperclipai/paperclip/paperclip",
        "company/caveman",
        "company/karpathy-obsidian-memory",
        "paperclipai/paperclip/para-memory-files",
        "paperclipai/paperclip/diagnose-why-work-stopped",
      ],
    });
    expect(runtimeConfig.instructionsFilePath).not.toBe(existingInstructionsPath);
    const generated = await fs.readFile(String(runtimeConfig.instructionsFilePath), "utf8");
    expect(generated).toContain("read and apply the `caveman` skill");
    expect(generated).toContain("read and apply the `karpathy-obsidian-memory` skill");
    expect(generated).toContain("read and apply `para-memory-files`");
    expect(generated).toContain("read and apply the `paperclip` skill");
    expect(generated).toContain("read and apply the `diagnose-why-work-stopped` skill");
    expect(generated).toContain("Skill key: company/caveman");
    expect(generated).toContain("Use the skill named `caveman` in adapter Skill tools.");
    expect(generated).toContain("The materialized runtime directory is `caveman`; do not treat the original source path as the runtime skill root.");
    expect(generated).toContain(`Original skill source: ${path.join(home, "skills", "caveman")}`);
    expect(generated).not.toContain(`Skill source: ${path.join(home, "skills", "caveman")}`);
    expect(generated).not.toContain("caveman--4573ebe2fc");
    expect(generated).toContain("Keep issue context tight.");
    expect(contextSnapshot.mandatorySkillInstructions).toEqual([
      expect.objectContaining({
        skillKey: "company/caveman",
        runtimeName: "caveman",
      }),
      expect.objectContaining({
        skillKey: "company/karpathy-obsidian-memory",
        runtimeName: "karpathy-obsidian-memory",
      }),
      expect.objectContaining({
        skillKey: "paperclipai/paperclip/para-memory-files",
        runtimeName: "para-memory-files",
      }),
      expect.objectContaining({
        skillKey: "paperclipai/paperclip/paperclip",
        runtimeName: "paperclip",
      }),
      expect.objectContaining({
        skillKey: "paperclipai/paperclip/diagnose-why-work-stopped",
        runtimeName: "diagnose-why-work-stopped",
      }),
    ]);
    expect(contextSnapshot.mandatorySkillInstruction).toMatchObject({
      skillKey: "company/caveman",
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

  it("uses SKILL.md frontmatter names for adapter Skill tool invocation when runtime names are hashed", async () => {
    const home = await tempHome();
    process.env.PAPERCLIP_HOME = home;
    process.env.PAPERCLIP_INSTANCE_ID = "test";
    process.env.PAPERCLIP_MANDATORY_SKILL = "caveman";

    const cavemanDir = path.join(home, "skills", "caveman--4573ebe2fc");
    await fs.mkdir(cavemanDir, { recursive: true });
    await fs.writeFile(
      path.join(cavemanDir, "SKILL.md"),
      "---\nname: caveman\n---\n# Caveman\n",
      "utf8",
    );

    const runtimeConfig: Record<string, unknown> = {
      paperclipRuntimeSkills: [
        {
          key: "juliusbrussee/caveman/caveman",
          runtimeName: "caveman--4573ebe2fc",
          source: cavemanDir,
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

    const generated = await fs.readFile(String(runtimeConfig.instructionsFilePath), "utf8");
    expect(generated).toContain("## caveman");
    expect(generated).toContain("Skill invocation name: caveman");
    expect(generated).toContain("Skill runtime name: caveman--4573ebe2fc");
    expect(generated).toContain("Use the skill named `caveman` in adapter Skill tools.");
    expect(contextSnapshot.mandatorySkillInstructions).toEqual([
      expect.objectContaining({
        skillKey: "juliusbrussee/caveman/caveman",
        runtimeName: "caveman--4573ebe2fc",
        invocationName: "caveman",
      }),
    ]);
  });
});
