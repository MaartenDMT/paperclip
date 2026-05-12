import { beforeEach, describe, expect, it, vi } from "vitest";
import { models as codexFallbackModels } from "@paperclipai/adapter-codex-local";
import { models as cursorFallbackModels } from "@paperclipai/adapter-cursor-local";
import { models as opencodeFallbackModels } from "@paperclipai/adapter-opencode-local";
import { resetOpenCodeModelsCacheForTests } from "@paperclipai/adapter-opencode-local/server";
import { listAdapterModels, listServerAdapters, refreshAdapterModels } from "../adapters/index.js";
import { resetCodexModelsCacheForTests, setCodexModelsFetcherForTests } from "../adapters/codex-models.js";
import { resetCursorModelsCacheForTests, setCursorModelsRunnerForTests } from "../adapters/cursor-models.js";

vi.mock("acpx/runtime", () => ({
  createAcpRuntime: vi.fn(),
  createAgentRegistry: vi.fn(),
  createRuntimeStore: vi.fn(),
  isAcpRuntimeError: vi.fn(() => false),
}));

describe("adapter model listing", () => {
  beforeEach(() => {
    delete process.env.PAPERCLIP_OPENCODE_COMMAND;
    resetCodexModelsCacheForTests();
    setCodexModelsFetcherForTests(null);
    resetCursorModelsCacheForTests();
    setCursorModelsRunnerForTests(null);
    resetOpenCodeModelsCacheForTests();
    vi.restoreAllMocks();
  });

  it("returns an empty list for unknown adapters", async () => {
    const models = await listAdapterModels("unknown_adapter");
    expect(models).toEqual([]);
  });

  it("uses provider-prefixed ACPX fallback model labels", () => {
    const adapter = listServerAdapters().find((candidate) => candidate.type === "acpx_local");

    expect(adapter?.models?.some((model) => model.label.startsWith("Claude: "))).toBe(true);
    expect(adapter?.models?.some((model) => model.label.startsWith("Codex: "))).toBe(true);
  });

  it("returns codex fallback models when local Codex model discovery is unavailable", async () => {
    setCodexModelsFetcherForTests(async () => []);
    const models = await listAdapterModels("codex_local");

    expect(models).toEqual(codexFallbackModels);
  });

  it("loads codex models dynamically and merges fallback options", async () => {
    const fetcher = vi.fn(async () => [
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
    ]);
    setCodexModelsFetcherForTests(fetcher);

    const first = await listAdapterModels("codex_local");
    const second = await listAdapterModels("codex_local");

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.some((model) => model.id === "gpt-5.5")).toBe(true);
    expect(first.some((model) => model.id === "gpt-5.4-mini")).toBe(true);
    expect(first.some((model) => model.id === "codex-mini-latest")).toBe(true);
  });

  it("refreshes cached codex models on demand", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce([{ id: "gpt-5.4", label: "gpt-5.4" }])
      .mockResolvedValueOnce([{ id: "gpt-5.5", label: "GPT-5.5" }]);
    setCodexModelsFetcherForTests(fetcher);

    const initial = await listAdapterModels("codex_local");
    const refreshed = await refreshAdapterModels("codex_local");

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(initial.some((model) => model.id === "gpt-5.4")).toBe(true);
    expect(refreshed.some((model) => model.id === "gpt-5.5")).toBe(true);
  });

  it("falls back to static codex models when local Codex model discovery returns nothing", async () => {
    setCodexModelsFetcherForTests(async () => []);
    const models = await listAdapterModels("codex_local");
    expect(models).toEqual(codexFallbackModels);
  });

  it("returns cursor fallback models when CLI discovery is unavailable", async () => {
    setCursorModelsRunnerForTests(() => ({
      status: null,
      stdout: "",
      stderr: "",
      hasError: true,
    }));

    const models = await listAdapterModels("cursor");
    expect(models).toEqual(cursorFallbackModels);
  });

  it("returns opencode fallback models including gpt-5.4", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND = "__paperclip_missing_opencode_command__";

    const models = await listAdapterModels("opencode_local");

    expect(models).toEqual(opencodeFallbackModels);
  });

  it("loads cursor models dynamically and caches them", async () => {
    const runner = vi.fn(() => ({
      status: 0,
      stdout: "Available models: auto, composer-1.5, gpt-5.3-codex-high, sonnet-4.6",
      stderr: "",
      hasError: false,
    }));
    setCursorModelsRunnerForTests(runner);

    const first = await listAdapterModels("cursor");
    const second = await listAdapterModels("cursor");

    expect(runner).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.some((model) => model.id === "auto")).toBe(true);
    expect(first.some((model) => model.id === "gpt-5.3-codex-high")).toBe(true);
    expect(first.some((model) => model.id === "composer-1")).toBe(true);
  });

});
