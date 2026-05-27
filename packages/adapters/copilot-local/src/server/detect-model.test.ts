import { afterEach, describe, expect, it } from "vitest";
import { modelProfiles, models } from "../index.js";
import { copilotLocalDefinition, detectModel } from "./index.js";

describe("copilot_local server adapter", () => {
  const originalCopilotModel = process.env.COPILOT_MODEL;
  const originalProviderType = process.env.COPILOT_PROVIDER_TYPE;

  afterEach(() => {
    if (originalCopilotModel === undefined) delete process.env.COPILOT_MODEL;
    else process.env.COPILOT_MODEL = originalCopilotModel;
    if (originalProviderType === undefined) delete process.env.COPILOT_PROVIDER_TYPE;
    else process.env.COPILOT_PROVIDER_TYPE = originalProviderType;
  });

  it("detects the configured model from Copilot env", async () => {
    process.env.COPILOT_MODEL = "gpt-5.2";
    process.env.COPILOT_PROVIDER_TYPE = "openai";

    await expect(detectModel()).resolves.toMatchObject({
      model: "gpt-5.2",
      provider: "openai",
      source: "env:COPILOT_MODEL",
    });
  });

  it("builds the non-interactive Copilot CLI command", () => {
    expect(copilotLocalDefinition.buildArgs({
      prompt: "do work",
      model: "gpt-5.2",
      extraArgs: ["--no-color"],
      config: { dangerouslySkipPermissions: true },
    })).toEqual([
      "--output-format",
      "json",
      "--model",
      "gpt-5.2",
      "--allow-all-tools",
      "--no-color",
      "--prompt",
      "do work",
    ]);
  });

  it("lists the models exposed by Copilot CLI config help", () => {
    expect(models.map((model) => model.id)).toEqual([
      "auto",
      "claude-sonnet-4.6",
      "claude-sonnet-4.5",
      "claude-haiku-4.5",
      "claude-opus-4.7",
      "claude-opus-4.6",
      "claude-opus-4.6-fast",
      "claude-opus-4.5",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-5.2-codex",
      "gpt-5.2",
      "gpt-5.4-mini",
      "gpt-5-mini",
      "gpt-4.1",
    ]);
  });

  it("declares Copilot GPT-5 mini as the cheap profile default", () => {
    expect(modelProfiles).toEqual([
      expect.objectContaining({
        key: "cheap",
        adapterConfig: { model: "gpt-5-mini" },
      }),
    ]);
  });
});
