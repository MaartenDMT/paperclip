import { describe, expect, it } from "vitest";
import { effectiveMaxConcurrentRunsForQueuedBacklog } from "../services/heartbeat-backlog-concurrency.ts";

describe("effectiveMaxConcurrentRunsForQueuedBacklog", () => {
  it("keeps a single-run agent at one slot below three queued runs", () => {
    expect(effectiveMaxConcurrentRunsForQueuedBacklog(1, 0)).toBe(1);
    expect(effectiveMaxConcurrentRunsForQueuedBacklog(1, 1)).toBe(1);
    expect(effectiveMaxConcurrentRunsForQueuedBacklog(1, 2)).toBe(1);
  });

  it("bursts a single-run agent to two slots at three queued runs", () => {
    expect(effectiveMaxConcurrentRunsForQueuedBacklog(1, 3)).toBe(2);
    expect(effectiveMaxConcurrentRunsForQueuedBacklog(1, 5)).toBe(2);
  });

  it("does not reduce agents already configured above the burst limit", () => {
    expect(effectiveMaxConcurrentRunsForQueuedBacklog(3, 3)).toBe(3);
  });
});
