import { describe, expect, it } from "vitest";
import { buildMiniMaxLocalConfig } from "./index.js";

describe("buildMiniMaxLocalConfig", () => {
  it("uses OpenCode-backed minimax_local defaults and parses comma args", () => {
    const config = buildMiniMaxLocalConfig({
      adapterType: "minimax_local",
      cwd: "",
      promptTemplate: "",
      model: "minimax/MiniMax-M2.7",
      thinkingEffort: "",
      chrome: false,
      dangerouslySkipPermissions: false,
      search: false,
      fastMode: false,
      dangerouslyBypassSandbox: false,
      command: "",
      args: "",
      extraArgs: "--json,--verbose",
      envVars: "",
      envBindings: {},
      url: "",
      bootstrapPrompt: "",
      maxTurnsPerRun: 0,
      heartbeatEnabled: false,
      intervalSec: 0,
    });

    expect(config).toMatchObject({
      model: "minimax/MiniMax-M2.7",
      command: "opencode",
      extraArgs: ["--json", "--verbose"],
      dangerouslySkipPermissions: true,
    });
  });
});
