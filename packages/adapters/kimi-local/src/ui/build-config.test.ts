import { describe, expect, it } from "vitest";
import { buildKimiLocalConfig } from "./index.js";

describe("buildKimiLocalConfig", () => {
  it("uses kimi_local defaults and preserves local CLI overrides", () => {
    const config = buildKimiLocalConfig({
      adapterType: "kimi_local",
      cwd: "A:/work",
      instructionsFilePath: "AGENTS.md",
      promptTemplate: "",
      model: "",
      thinkingEffort: "",
      chrome: false,
      dangerouslySkipPermissions: true,
      search: false,
      fastMode: false,
      dangerouslyBypassSandbox: false,
      command: "kimi",
      args: "",
      extraArgs: "--foo,bar",
      envVars: "KIMI_API_KEY=secret",
      envBindings: {},
      url: "",
      bootstrapPrompt: "",
      maxTurnsPerRun: 0,
      heartbeatEnabled: false,
      intervalSec: 0,
    });

    expect(config).toMatchObject({
      cwd: "A:/work",
      instructionsFilePath: "AGENTS.md",
      model: "auto",
      command: "kimi",
      extraArgs: ["--foo", "bar"],
      env: { KIMI_API_KEY: { type: "plain", value: "secret" } },
    });
  });
});
