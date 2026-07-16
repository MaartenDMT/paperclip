import { describe, expect, it } from "vitest";
import {
  computeLocalActiveRunExecutionsMax,
  computeLocalAvailableRunExecutionSlots,
  computeLocalQueuedRunsMax,
} from "../services/heartbeat-capacity.ts";

describe("computeLocalActiveRunExecutionsMax", () => {
  it("prefers the explicit environment override when provided", () => {
    expect(computeLocalActiveRunExecutionsMax("5", 16, 20)).toBe(5);
  });

  it("defaults local launch capacity to five unless explicitly overridden", () => {
    expect(computeLocalActiveRunExecutionsMax(undefined, 16, 20)).toBe(5);
    expect(computeLocalActiveRunExecutionsMax(undefined, 32, 20)).toBe(5);
  });

  it("keeps the default stable when host parallelism is small or unknown", () => {
    expect(computeLocalActiveRunExecutionsMax(undefined, 2, 20)).toBe(5);
    expect(computeLocalActiveRunExecutionsMax(undefined, Number.NaN, 20)).toBe(5);
    expect(computeLocalActiveRunExecutionsMax("invalid", 32, 20)).toBe(5);
  });

  it("does not exceed a lower global running ceiling by default", () => {
    expect(computeLocalActiveRunExecutionsMax(undefined, 32, 3)).toBe(3);
  });
});

describe("computeLocalQueuedRunsMax", () => {
  it("defaults queued launch backlog to five so live local runs stay capped at ten", () => {
    expect(computeLocalQueuedRunsMax(undefined)).toBe(5);
    expect(computeLocalQueuedRunsMax("invalid")).toBe(5);
  });

  it("accepts a positive environment override", () => {
    expect(computeLocalQueuedRunsMax("5")).toBe(5);
    expect(computeLocalQueuedRunsMax("20")).toBe(20);
  });
});

describe("computeLocalAvailableRunExecutionSlots", () => {
  it("counts persisted running runs after restart when in-memory executions are empty", () => {
    expect(
      computeLocalAvailableRunExecutionSlots({
        maxLocalActiveRunExecutions: 5,
        inMemoryActiveRunExecutions: 0,
        persistedRunningRuns: 5,
      }),
    ).toBe(0);
  });

  it("uses the larger of in-memory and persisted running counts", () => {
    expect(
      computeLocalAvailableRunExecutionSlots({
        maxLocalActiveRunExecutions: 5,
        inMemoryActiveRunExecutions: 3,
        persistedRunningRuns: 1,
      }),
    ).toBe(2);
  });
});
