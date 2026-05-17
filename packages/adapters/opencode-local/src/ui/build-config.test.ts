import { describe, expect, it } from "vitest";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import {
  DEFAULT_OPENCODE_LOCAL_TIMEOUT_SEC,
  DEFAULT_OPENCODE_TERMINAL_RESULT_CLEANUP_GRACE_SEC,
} from "../index.js";
import { buildOpenCodeLocalConfig } from "./build-config.js";

function makeValues(overrides: Partial<CreateConfigValues> = {}): CreateConfigValues {
  return {
    adapterType: "opencode_local",
    cwd: "",
    instructionsFilePath: "",
    promptTemplate: "",
    model: "openai/gpt-5.2-codex",
    thinkingEffort: "",
    chrome: false,
    dangerouslySkipPermissions: true,
    search: false,
    fastMode: false,
    dangerouslyBypassSandbox: false,
    command: "",
    args: "",
    extraArgs: "",
    envVars: "",
    envBindings: {},
    url: "",
    bootstrapPrompt: "",
    payloadTemplateJson: "",
    workspaceStrategyType: "project_primary",
    workspaceBaseRef: "",
    workspaceBranchTemplate: "",
    worktreeParentDir: "",
    runtimeServicesJson: "",
    maxTurnsPerRun: 1000,
    heartbeatEnabled: false,
    intervalSec: 300,
    ...overrides,
  };
}

describe("buildOpenCodeLocalConfig", () => {
  it("uses bounded runtime and terminal cleanup defaults", () => {
    expect(buildOpenCodeLocalConfig(makeValues())).toMatchObject({
      model: "openai/gpt-5.2-codex",
      timeoutSec: DEFAULT_OPENCODE_LOCAL_TIMEOUT_SEC,
      terminalResultCleanupGraceSec: DEFAULT_OPENCODE_TERMINAL_RESULT_CLEANUP_GRACE_SEC,
      graceSec: 20,
    });
  });
});
