import { describe, expect, it } from "vitest";
import {
  executeSimpleCliAdapter,
  hasSimpleCliTerminalResult,
  summarizeSimpleCliOutput,
  type SimpleCliAdapterDefinition,
} from "./simple-cli-server.js";

describe("summarizeSimpleCliOutput", () => {
  it("prefers assistant text from JSON content arrays over thinking text", () => {
    const stdout = JSON.stringify({
      id: "msg-1",
      type: "message",
      role: "assistant",
      content: [
        { type: "thinking", thinking: "internal reasoning" },
        { type: "text", text: "Fiction Director online." },
      ],
    });

    expect(summarizeSimpleCliOutput(stdout)).toBe("Fiction Director online.");
  });

  it("extracts nested delta content from JSON event streams", () => {
    const stdout = JSON.stringify({
      type: "assistant.message_delta",
      data: { deltaContent: "Audit complete" },
    });

    expect(summarizeSimpleCliOutput(stdout)).toBe("Audit complete");
  });

  it("summarizes thinking-only JSON without degrading into a literal brace summary", () => {
    const stdout = JSON.stringify({
      type: "message",
      content: [
        { type: "thinking", thinking: "internal reasoning only" },
      ],
    });

    expect(summarizeSimpleCliOutput(stdout)).toBe("Model produced only thinking output without a final response.");
  });

  it("summarizes thinking-only max-token JSON without exposing raw braces", () => {
    const stdout = JSON.stringify({
      id: "msg-1",
      type: "message",
      role: "assistant",
      content: [
        { type: "thinking", thinking: "internal reasoning only" },
      ],
      stop_reason: "max_tokens",
    }, null, 2);

    expect(summarizeSimpleCliOutput(stdout)).toBe("Model stopped at max tokens before producing a final response.");
  });

  it("extracts assistant text from pretty-printed JSON payloads", () => {
    const stdout = JSON.stringify({
      id: "msg-1",
      type: "message",
      role: "assistant",
      model: "MiniMax-M2.7",
      content: [
        { type: "thinking", thinking: "internal reasoning" },
        { type: "text", text: "Awaiting task assignment or checklist item to validate." },
      ],
    }, null, 2);

    expect(summarizeSimpleCliOutput(stdout)).toBe("Awaiting task assignment or checklist item to validate.");
  });

  it("falls back to the first plain-text line for non-JSON output", () => {
    expect(summarizeSimpleCliOutput("\nReady for work\nsecond line")).toBe("Ready for work");
  });
});

describe("hasSimpleCliTerminalResult", () => {
  it("detects final assistant text without treating tool-call messages as terminal", () => {
    const toolCallLine = JSON.stringify({
      type: "message",
      role: "assistant",
      content: [{ type: "thinking", thinking: "Need inspect file." }],
      tool_calls: [{ id: "tool_123", function: { name: "ReadFile", arguments: "{}" } }],
    });
    const finalLine = JSON.stringify({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "normal output" }],
    });

    expect(hasSimpleCliTerminalResult({ stdout: `${toolCallLine}\n` })).toBe(false);
    expect(hasSimpleCliTerminalResult({ stdout: `${toolCallLine}\n${finalLine}\n` })).toBe(true);
  });
});

describe("executeSimpleCliAdapter prompt", () => {
  it("includes scoped Paperclip task markdown in the CLI prompt", async () => {
    let prompt = "";
    let promptMetrics: Record<string, number> = {};
    const definition: SimpleCliAdapterDefinition = {
      type: "test_simple_cli",
      label: "Test CLI",
      defaultCommand: "node",
      buildArgs: () => ["-e", "process.exit(0)"],
    };

    await executeSimpleCliAdapter({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Test Agent",
        adapterType: "test_simple_cli",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {},
      context: {
        paperclipTaskMarkdown: "## Assigned Paperclip Issue\n\nREA-1: implement the actual task.",
      },
      onLog: async () => {},
      onMeta: async (meta) => {
        prompt = meta.prompt ?? "";
        promptMetrics = meta.promptMetrics ?? {};
      },
    }, definition);

    expect(prompt).toContain("## Assigned Paperclip Issue");
    expect(prompt).toContain("REA-1: implement the actual task.");
    expect(promptMetrics.taskContextChars).toBeGreaterThan(0);
  });

  it("cleans up a still-running CLI after terminal assistant output", async () => {
    const output = JSON.stringify({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "normal output" }],
    });
    const definition: SimpleCliAdapterDefinition = {
      type: "test_simple_cli",
      label: "Test CLI",
      defaultCommand: "node",
      defaultTimeoutSec: 1,
      defaultGraceSec: 1,
      buildArgs: () => [
        "-e",
        `process.stdout.write(${JSON.stringify(output + "\n")}); setInterval(() => {}, 1000);`,
      ],
      terminalResultCleanup: {
        graceMs: 0,
        hasTerminalResult: ({ stdout }) => stdout.includes('"type":"message"'),
      },
    };

    const result = await executeSimpleCliAdapter({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Test Agent",
        adapterType: "test_simple_cli",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {},
      context: {},
      onLog: async () => {},
    }, definition);

    expect(result.timedOut).toBe(false);
    expect(result.summary).toBe("normal output");
  });
});
