import { describe, expect, it } from "vitest";
import { detectSimpleCliModel } from "./simple-cli-model-detection.js";

describe("detectSimpleCliModel", () => {
  it("prefers explicit environment model settings", async () => {
    await expect(
      detectSimpleCliModel(
        {
          provider: "example",
          envKeys: ["EXAMPLE_MODEL"],
          configPaths: [],
        },
        { env: { EXAMPLE_MODEL: "model-from-env" } },
      ),
    ).resolves.toEqual({
      model: "model-from-env",
      provider: "example",
      source: "env:EXAMPLE_MODEL",
      candidates: ["model-from-env"],
    });
  });

  it("detects model values from JSON config files", async () => {
    const result = await detectSimpleCliModel(
      {
        provider: "example",
        envKeys: [],
        configPaths: ["~/.example/config.json"],
      },
      {
        env: {},
        homeDir: "C:/Users/Test",
        readFile: async (filePath) => {
          expect(filePath.replace(/\\/g, "/")).toContain(".example/config.json");
          return JSON.stringify({ defaults: { model: "model-from-json" } });
        },
      },
    );

    expect(result).toMatchObject({
      model: "model-from-json",
      provider: "example",
      candidates: ["model-from-json"],
    });
  });

  it("detects model values from text config files", async () => {
    const result = await detectSimpleCliModel(
      {
        provider: "example",
        envKeys: [],
        configPaths: ["~/.example/config.toml"],
      },
      {
        env: {},
        homeDir: "C:/Users/Test",
        readFile: async () => 'model_name = "model-from-toml"\n',
      },
    );

    expect(result).toMatchObject({
      model: "model-from-toml",
      provider: "example",
      candidates: ["model-from-toml"],
    });
  });

  it("falls back to the adapter default model when no configured model is found", async () => {
    await expect(
      detectSimpleCliModel(
        {
          provider: "example",
          envKeys: ["EXAMPLE_MODEL"],
          configPaths: ["~/.example/missing.json"],
          defaultModel: "auto",
        },
        {
          env: {},
          homeDir: "C:/Users/Test",
          readFile: async () => {
            throw new Error("missing");
          },
        },
      ),
    ).resolves.toEqual({
      model: "auto",
      provider: "example",
      source: "adapter_default",
      candidates: ["auto"],
    });
  });
});
