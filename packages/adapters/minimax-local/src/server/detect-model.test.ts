import { afterEach, describe, expect, it } from "vitest";
import { modelProfiles, models } from "../index.js";
import {
  detectModel,
  listMiniMaxModelsFromOpenCode,
  mapMiniMaxQuotaShowOutput,
  normalizeMiniMaxOpenCodeConfig,
} from "./index.js";

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

  it("advertises OpenCode-routable MiniMax models", () => {
    expect(models.map((model) => model.id)).toEqual([
      "minimax/MiniMax-M2",
      "minimax/MiniMax-M2.1",
      "minimax/MiniMax-M2.5",
      "minimax/MiniMax-M2.7",
    ]);
  });

  it("merges discovered MiniMax provider-routed models with safe defaults", () => {
    expect(listMiniMaxModelsFromOpenCode([
      { id: "opencode/minimax-m2.5-free", label: "OpenCode MiniMax M2.5 free" },
      { id: "openrouter/minimax/minimax-m2.7", label: "OpenRouter MiniMax M2.7" },
      { id: "minimax/MiniMax-M2.7-highspeed", label: "MiniMax M2.7 highspeed" },
      { id: "openai/gpt-5.2", label: "OpenAI GPT-5.2" },
      { id: "minimax/MiniMax-M2.7", label: "Duplicate MiniMax M2.7" },
    ])).toEqual([
      { id: "minimax/MiniMax-M2", label: "minimax/MiniMax-M2" },
      { id: "minimax/MiniMax-M2.1", label: "minimax/MiniMax-M2.1" },
      { id: "minimax/MiniMax-M2.5", label: "minimax/MiniMax-M2.5" },
      { id: "minimax/MiniMax-M2.7", label: "minimax/MiniMax-M2.7" },
      { id: "opencode/minimax-m2.5-free", label: "OpenCode MiniMax M2.5 free" },
      { id: "openrouter/minimax/minimax-m2.7", label: "OpenRouter MiniMax M2.7" },
    ]);
  });

  it("declares MiniMax M2.1 as the cheap profile default", () => {
    expect(modelProfiles).toEqual([
      expect.objectContaining({
        key: "cheap",
        adapterConfig: { model: "minimax/MiniMax-M2.1" },
      }),
      expect.objectContaining({
        key: "fallback",
        adapterConfig: {
          adapterType: "codex_local",
          command: "codex",
          provider: "openai",
          model: "gpt-5.4-mini",
          modelReasoningEffort: "low",
        },
      }),
    ]);
  });

  it("normalizes legacy mmx config into unattended OpenCode config", () => {
    expect(normalizeMiniMaxOpenCodeConfig({
      command: "mmx",
      model: "MiniMax-M2.5",
      dangerouslySkipPermissions: false,
    })).toMatchObject({
      command: "opencode",
      model: "minimax/MiniMax-M2.5",
      dangerouslySkipPermissions: true,
    });
  });

  it("keeps explicit OpenCode-compatible model ids", () => {
    expect(normalizeMiniMaxOpenCodeConfig({
      model: "github-copilot/gpt-5-mini",
    })).toMatchObject({
      command: "opencode",
      model: "github-copilot/gpt-5-mini",
    });
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
