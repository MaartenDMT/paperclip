import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { preservedMcpResultPaths } from "../services/mcp-result-integrity.js";

const content = "A bearer abcdefghi crossed the bridge.";
const fullManuscript = `${content} The road continued beyond the ridge.`;
const contentHash = createHash("sha256").update(fullManuscript, "utf8").digest("hex");

function draftResult(overrides: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text", text: "draft chunk" }],
    structuredContent: {
      actionId: "draft.content.get",
      actionVersion: "1.0.0",
      status: "completed",
      output: {
        projectId: "project-1",
        workId: "work-1",
        draftId: "draft-1",
        content,
        offset: 0,
        nextOffset: content.length,
        hasMore: true,
        contentHash,
        revision: "2026-09-17T00:00:00.000Z",
        ...overrides,
      },
    },
  };
}

function preserve(result: unknown, endpoint = "https://api.readersbase.com/mcp") {
  return preservedMcpResultPaths({
    endpoint,
    upstreamToolName: "readersbase_draft_content_get",
    result,
  });
}

describe("MCP result integrity", () => {
  it("preserves only a coherent ReadersBase draft-content result", () => {
    expect(preserve(draftResult())).toEqual([
      ["data", "structuredContent", "output", "content"],
    ]);
  });

  it("rejects a draft chunk whose offsets do not match its content", () => {
    expect(
      preserve(draftResult({ nextOffset: content.length + 1 })),
    ).toBeUndefined();
  });

  it("does not preserve content from another tool or an error result", () => {
    expect(preservedMcpResultPaths({
      endpoint: "https://api.readersbase.com/mcp",
      upstreamToolName: "other_tool",
      result: draftResult(),
    })).toBeUndefined();
    expect(preserve({ ...draftResult(), isError: true })).toBeUndefined();
  });

  it("rejects an impersonating connector and an incomplete result", () => {
    expect(preserve(draftResult(), "https://mcp.example.test/mcp")).toBeUndefined();
    expect(preserve(draftResult({ draftId: undefined }))).toBeUndefined();
  });
});
