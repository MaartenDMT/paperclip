export function printSimpleCliStreamEvent(raw: string, _debug: boolean): void {
  const line = raw.trim();
  if (!line) return;
  try {
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      const content =
        typeof rec.content === "string"
          ? rec.content
          : typeof rec.text === "string"
            ? rec.text
            : typeof rec.message === "string"
              ? rec.message
              : "";
      if (content) {
        console.log(content);
        return;
      }
    }
  } catch {
    // Plain text output is expected.
  }
  console.log(line);
}
