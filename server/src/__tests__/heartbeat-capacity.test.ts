import { describe, expect, it } from "vitest";
import { computeLocalActiveRunExecutionsMax } from "../services/heartbeat-capacity.ts";

describe("computeLocalActiveRunExecutionsMax", () => {
  it("prefers the explicit environment override when provided", () => {
    expect(computeLocalActiveRunExecutionsMax("5", 16, 20)).toBe(5);
  });

  it("scales the default launch capacity up to the global running ceiling", () => {
    expect(computeLocalActiveRunExecutionsMax(undefined, 16, 20)).toBe(16);
    expect(computeLocalActiveRunExecutionsMax(undefined, 32, 20)).toBe(20);
  });

  it("keeps a safe minimum when host parallelism is small or unknown", () => {
    expect(computeLocalActiveRunExecutionsMax(undefined, 2, 20)).toBe(6);
    expect(computeLocalActiveRunExecutionsMax(undefined, Number.NaN, 20)).toBe(6);
    expect(computeLocalActiveRunExecutionsMax("invalid", 32, 20)).toBe(20);
  });
});
