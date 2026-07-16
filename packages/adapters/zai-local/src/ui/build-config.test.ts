import { describe, expect, it } from "vitest";
import { buildZaiLocalConfig } from "./index.js";

describe("zai_local UI config", () => {
  it("uses Z.AI OpenCode-backed defaults and preserves overrides", () => {
    expect(buildZaiLocalConfig({
      adapterType: "zai_local",
      model: "",
      command: "",
      cwd: "/repo",
      instructionsFilePath: "",
      promptTemplate: "",
      extraArgs: "--debug",
      envVars: "",
    } as any)).toMatchObject({
      model: "zai-coding-plan/glm-4.7",
      command: "opencode",
      cwd: "/repo",
      extraArgs: ["--debug"],
      dangerouslySkipPermissions: true,
    });
  });
});
