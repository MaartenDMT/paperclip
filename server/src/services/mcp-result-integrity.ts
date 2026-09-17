const READERSBASE_DRAFT_CONTENT_TOOL_NAME = "readersbase_draft_content_get";
const READERSBASE_DRAFT_CONTENT_PATH = [
  "data",
  "structuredContent",
  "output",
  "content",
] as const;
const LOWERCASE_SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function isTrustedReadersBaseEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      url.hostname === "api.readersbase.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname.replace(/\/+$/, "") === "/mcp"
    );
  } catch {
    return false;
  }
}

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function preservedMcpResultPaths(input: {
  endpoint?: string;
  upstreamToolName: string;
  result: unknown;
}): readonly (readonly string[])[] | undefined {
  if (
    input.upstreamToolName !== READERSBASE_DRAFT_CONTENT_TOOL_NAME ||
    !isTrustedReadersBaseEndpoint(input.endpoint)
  ) {
    return undefined;
  }

  const record = asRecord(input.result);
  const structuredContent = asRecord(record?.structuredContent);
  const output = asRecord(structuredContent?.output);
  if (
    !record ||
    (record.isError !== undefined && record.isError !== false) ||
    structuredContent?.actionId !== "draft.content.get" ||
    structuredContent.status !== "completed" ||
    structuredContent.actionVersion !== "1.0.0" ||
    !isBoundedId(output?.projectId) ||
    !isBoundedId(output.workId) ||
    !isBoundedId(output.draftId) ||
    typeof output?.content !== "string" ||
    typeof output.offset !== "number" ||
    !Number.isSafeInteger(output.offset) ||
    output.offset < 0 ||
    !isBoundedId(output.revision) ||
    typeof output.contentHash !== "string" ||
    !LOWERCASE_SHA256_HEX_PATTERN.test(output.contentHash)
  ) {
    return undefined;
  }

  const nextOffset = output.nextOffset;
  if (
    nextOffset !== null &&
    (typeof nextOffset !== "number" ||
      !Number.isSafeInteger(nextOffset) ||
      nextOffset < output.offset ||
      output.content.length !== nextOffset - output.offset)
  ) {
    return undefined;
  }
  if (output.hasMore !== (nextOffset !== null)) return undefined;

  return [READERSBASE_DRAFT_CONTENT_PATH];
}
