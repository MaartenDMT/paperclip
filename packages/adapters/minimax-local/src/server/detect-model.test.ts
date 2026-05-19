import { afterEach, describe, expect, it } from "vitest";
import { models } from "../index.js";
import { detectModel, mapMiniMaxQuotaShowOutput, minimaxDefinition } from "./index.js";

describe("minimax_local server adapter", () => {
  const originalMiniMaxModel = process.env.MINIMAX_MODEL;

  afterEach(() => {
    if (originalMiniMaxModel === undefined) delete process.env.MINIMAX_MODEL;
    else process.env.MINIMAX_MODEL = originalMiniMaxModel;
  });

  it("detects the configured model from MiniMax env", async () => {
    process.env.MINIMAX_MODEL = "MiniMax-M2.7";

    await expect(detectModel()).resolves.toMatchObject({
      model: "MiniMax-M2.7",
      provider: "minimax",
      source: "env:MINIMAX_MODEL",
    });
  });

  it("advertises executable non-highspeed MiniMax models", () => {
    expect(models.map((model) => model.id)).toEqual([
      "auto",
      "MiniMax-M2.1",
      "MiniMax-M2.5",
      "MiniMax-M2.7",
    ]);
  });

  it("builds the MiniMax text chat command", () => {
    expect(minimaxDefinition.buildArgs({
      prompt: "do work",
      model: "MiniMax-M2.7-highspeed",
      extraArgs: ["--output", "json"],
      config: {},
    })).toEqual([
      "text",
      "chat",
      "--model",
      "MiniMax-M2.7-highspeed",
      "--output",
      "json",
      "--message",
      "do work",
    ]);
  });

  it("maps mmx quota output into provider quota windows", () => {
    const result = mapMiniMaxQuotaShowOutput(JSON.stringify({
      model_remains: [
        {
          model_name: "MiniMax-M*",
          current_interval_total_count: 4500,
          current_interval_usage_count: 7,
          current_weekly_total_count: 45000,
          current_weekly_usage_count: 676,
          end_time: 1779134400000,
          weekly_end_time: 1779667200000,
        },
      ],
    }));

    expect(result).toMatchObject({
      provider: "minimax",
      source: "mmx-cli",
      ok: true,
    });
    expect(result.windows).toEqual([
      {
        label: "MiniMax-M* · current window",
        usedPercent: 0,
        resetsAt: "2026-05-18T20:00:00.000Z",
        valueLabel: "4493 / 4500 remaining",
        detail: "7 used in current quota window",
      },
      {
        label: "MiniMax-M* · weekly",
        usedPercent: 2,
        resetsAt: "2026-05-25T00:00:00.000Z",
        valueLabel: "44324 / 45000 remaining",
        detail: "676 used in weekly quota window",
      },
    ]);
  });
});
