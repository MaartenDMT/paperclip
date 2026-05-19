import { describe, expect, it } from "vitest";
import { buildCopilotLocalConfig } from "./index.js";

describe("buildCopilotLocalConfig", () => {
  it("uses copilot_local defaults", () => {
    const config = buildCopilotLocalConfig({
      adapterType: "copilot_local",
      cwd: "C:/work",
      promptTemplate: "",
      model: "",
      thinkingEffort: "",
      chrome: false,
      dangerouslySkipPermissions: false,
      search: false,
      fastMode: false,
      dangerouslyBypassSandbox: false,
      command: "node",
      args: "",
      extraArgs: "bridge.js",
      envVars: "GITHUB_TOKEN=token",
      envBindings: {},
      url: "",
      bootstrapPrompt: "",
      maxTurnsPerRun: 0,
      heartbeatEnabled: false,
      intervalSec: 0,
    });

    expect(config).toMatchObject({
      cwd: "C:/work",
      model: "auto",
      command: "node",
      extraArgs: ["bridge.js"],
      env: { GITHUB_TOKEN: { type: "plain", value: "token" } },
    });
  });
});
