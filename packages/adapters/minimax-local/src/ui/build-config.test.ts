import { describe, expect, it } from "vitest";
import { buildMiniMaxLocalConfig } from "./index.js";

describe("buildMiniMaxLocalConfig", () => {
  it("uses minimax_local defaults and parses comma args", () => {
    const config = buildMiniMaxLocalConfig({
      adapterType: "minimax_local",
      cwd: "",
      promptTemplate: "",
      model: "MiniMax-M2",
      thinkingEffort: "",
      chrome: false,
      dangerouslySkipPermissions: false,
      search: false,
      fastMode: false,
      dangerouslyBypassSandbox: false,
      command: "mmx",
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
      model: "MiniMax-M2",
      command: "mmx",
      extraArgs: ["--json", "--verbose"],
    });
  });
});
