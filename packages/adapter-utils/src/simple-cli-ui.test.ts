import { describe, expect, it } from "vitest";
import { parseSimpleCliStdoutLine } from "./simple-cli-ui.js";

describe("parseSimpleCliStdoutLine", () => {
  it("parses Kimi and MiniMax content arrays", () => {
    const entries = parseSimpleCliStdoutLine(
      JSON.stringify({
        role: "assistant",
        content: [
          { type: "think", think: "reasoning" },
          { type: "text", text: "Hi" },
        ],
      }),
      "ts",
    );

    expect(entries).toEqual([
      { kind: "thinking", ts: "ts", text: "reasoning" },
      { kind: "assistant", ts: "ts", text: "Hi" },
    ]);
  });

  it("parses Copilot JSON events", () => {
    expect(parseSimpleCliStdoutLine(
      JSON.stringify({ type: "assistant.message_delta", data: { deltaContent: "Hi" } }),
      "ts",
    )).toEqual([{ kind: "assistant", ts: "ts", text: "Hi" }]);

    expect(parseSimpleCliStdoutLine(
      JSON.stringify({ type: "result", usage: { input_tokens: 1, output_tokens: 2 } }),
      "ts",
    )).toEqual([{
      kind: "result",
      ts: "ts",
      text: "Run completed",
      subtype: "success",
      inputTokens: 1,
      outputTokens: 2,
      cachedTokens: 0,
      costUsd: 0,
      isError: false,
      errors: [],
    }]);
  });
});
