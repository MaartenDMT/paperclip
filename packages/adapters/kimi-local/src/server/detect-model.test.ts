import { afterEach, describe, expect, it } from "vitest";
import { models } from "../index.js";
import { detectModel, kimiDefinition } from "./index.js";

describe("kimi_local server adapter", () => {
  const originalKimiModel = process.env.KIMI_MODEL;

  afterEach(() => {
    if (originalKimiModel === undefined) delete process.env.KIMI_MODEL;
    else process.env.KIMI_MODEL = originalKimiModel;
  });

  it("detects the configured model from Kimi env", async () => {
    process.env.KIMI_MODEL = "kimi-k2-0711-preview";

    await expect(detectModel()).resolves.toMatchObject({
      model: "kimi-k2-0711-preview",
      provider: "kimi",
      source: "env:KIMI_MODEL",
    });
  });

  it("prefers the executable default_model from Kimi config over nested provider aliases", async () => {
    delete process.env.KIMI_MODEL;

    await expect(detectModel()).resolves.toMatchObject({
      model: "kimi-code/kimi-for-coding",
      provider: "kimi",
    });
  });

  it("builds the non-interactive Kimi command", () => {
    expect(kimiDefinition.buildArgs({
      prompt: "do work",
      model: "kimi-k2-0711-preview",
      extraArgs: ["--debug"],
      config: { dangerouslySkipPermissions: true },
    })).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--model",
      "kimi-k2-0711-preview",
      "--yolo",
      "--debug",
      "--prompt",
      "do work",
    ]);
  });

  it("lists the local coding model detected by current Kimi config", () => {
    expect(models.map((model) => model.id)).toContain("kimi-code/kimi-for-coding");
  });
});
