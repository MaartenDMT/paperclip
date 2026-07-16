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

  it("parses Kimi tool calls without exposing raw JSON", () => {
    const entries = parseSimpleCliStdoutLine(
      JSON.stringify({
        role: "assistant",
        content: [{ type: "think", think: "Need inspect file." }],
        tool_calls: [{
          type: "function",
          id: "tool_123",
          function: {
            name: "ReadFile",
            arguments: "{\"path\":\"A:\\\\Programming\\\\projects\\\\base\\\\package.json\"}",
          },
        }],
      }),
      "ts",
    );

    expect(entries).toEqual([
      { kind: "thinking", ts: "ts", text: "Need inspect file." },
      {
        kind: "tool_call",
        ts: "ts",
        name: "ReadFile",
        input: "{\"path\":\"A:\\\\Programming\\\\projects\\\\base\\\\package.json\"}",
        toolUseId: "tool_123",
      },
    ]);
  });

  it("parses Kimi tool results without exposing raw JSON", () => {
    const entries = parseSimpleCliStdoutLine(
      JSON.stringify({
        role: "tool",
        content: "file contents",
        tool_call_id: "tool_123",
      }),
      "ts",
    );

    expect(entries).toEqual([
      {
        kind: "tool_result",
        ts: "ts",
        toolUseId: "tool_123",
        toolName: undefined,
        content: "file contents",
        isError: false,
      },
    ]);
  });

  it("parses Kimi tool result content arrays as tool results", () => {
    const entries = parseSimpleCliStdoutLine(
      JSON.stringify({
        role: "tool",
        content: [
          { type: "text", text: "<system>145 lines read from file.</system>" },
          { type: "text", text: "file line 1\nfile line 2" },
        ],
        tool_call_id: "tool_123",
      }),
      "ts",
    );

    expect(entries).toEqual([
      {
        kind: "tool_result",
        ts: "ts",
        toolUseId: "tool_123",
        toolName: undefined,
        content: "<system>145 lines read from file.</system>\n\nfile line 1\nfile line 2",
        isError: false,
      },
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
