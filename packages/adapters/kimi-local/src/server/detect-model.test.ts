import path from "node:path";
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
    // Inject a deterministic config instead of reading the developer's real
    // ~/.kimi config, which made this assertion machine-dependent.
    const config = JSON.stringify({
      default_model: "kimi-code/kimi-for-coding",
      providers: { moonshot: { model: "kimi-k2-0711-preview" } },
    });
    const configFile = path.join(".kimi", "config.json");

    await expect(detectModel({
      env: {},
      homeDir: path.join(path.sep, "home", "kimi-test"),
      readFile: async (filePath: string) => {
        if (filePath.endsWith(configFile)) return config;
        throw new Error(`unexpected read: ${filePath}`);
      },
    })).resolves.toMatchObject({
      model: "kimi-code/kimi-for-coding",
      provider: "kimi",
    });
  });

  it("builds the non-interactive Kimi command without permission flags", () => {
    // `--prompt` cannot be combined with `--yolo`/`--auto`/`--plan`; prompt mode
    // already auto-approves, so dangerouslySkipPermissions must not add a flag.
    expect(kimiDefinition.buildArgs({
      prompt: "do work",
      model: "kimi-k2-0711-preview",
      extraArgs: ["--debug"],
      config: { dangerouslySkipPermissions: true },
    })).toEqual([
      "--output-format",
      "stream-json",
      "--model",
      "kimi-k2-0711-preview",
      "--debug",
      "--prompt",
      "do work",
    ]);
  });

  it("lists the local coding model detected by current Kimi config", () => {
    expect(models.map((model) => model.id)).toContain("kimi-code/kimi-for-coding");
  });
});
