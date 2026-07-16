import { describe, expect, it } from "vitest";
import {
  countConsecutiveAdapterFailures,
  decideDeadAdapterCircuitBreaker,
  DEFAULT_DEAD_ADAPTER_FAILURE_THRESHOLD,
  isAdapterLevelFailureRun,
} from "./dead-adapter-circuit-breaker.js";

describe("isAdapterLevelFailureRun", () => {
  it("treats adapter_failed and process_lost terminal runs as adapter failures", () => {
    expect(isAdapterLevelFailureRun({ status: "failed", errorCode: "adapter_failed" })).toBe(true);
    expect(isAdapterLevelFailureRun({ status: "failed", errorCode: "process_lost" })).toBe(true);
    expect(isAdapterLevelFailureRun({ status: "timed_out", errorCode: "adapter_failed" })).toBe(true);
  });

  it("does not count successes, intentional cancels, or non-adapter failures", () => {
    expect(isAdapterLevelFailureRun({ status: "succeeded", errorCode: null })).toBe(false);
    expect(isAdapterLevelFailureRun({ status: "cancelled", errorCode: "adapter_failed" })).toBe(false);
    expect(isAdapterLevelFailureRun({ status: "failed", errorCode: "missing_issue_disposition" })).toBe(false);
    expect(isAdapterLevelFailureRun({ status: "failed", errorCode: null })).toBe(false);
    expect(isAdapterLevelFailureRun(null)).toBe(false);
  });
});

describe("countConsecutiveAdapterFailures", () => {
  it("counts the leading run of adapter failures", () => {
    expect(
      countConsecutiveAdapterFailures([
        { status: "failed", errorCode: "adapter_failed" },
        { status: "failed", errorCode: "process_lost" },
        { status: "failed", errorCode: "adapter_failed" },
      ]),
    ).toBe(3);
  });

  it("stops at the first non-adapter-failure run (a recent success resets it)", () => {
    expect(
      countConsecutiveAdapterFailures([
        { status: "failed", errorCode: "adapter_failed" },
        { status: "succeeded", errorCode: null },
        { status: "failed", errorCode: "adapter_failed" },
        { status: "failed", errorCode: "adapter_failed" },
      ]),
    ).toBe(1);
  });

  it("returns 0 when the newest run is a success", () => {
    expect(
      countConsecutiveAdapterFailures([
        { status: "succeeded", errorCode: null },
        { status: "failed", errorCode: "adapter_failed" },
      ]),
    ).toBe(0);
  });
});

describe("decideDeadAdapterCircuitBreaker", () => {
  it("trips once the consecutive adapter failures reach the threshold", () => {
    const decision = decideDeadAdapterCircuitBreaker({
      runs: [
        { status: "failed", errorCode: "adapter_failed" },
        { status: "failed", errorCode: "process_lost" },
        { status: "failed", errorCode: "adapter_failed" },
      ],
    });
    expect(decision.tripped).toBe(true);
    expect(decision.consecutiveAdapterFailures).toBe(3);
    expect(decision.threshold).toBe(DEFAULT_DEAD_ADAPTER_FAILURE_THRESHOLD);
  });

  it("does not trip below the threshold", () => {
    const decision = decideDeadAdapterCircuitBreaker({
      runs: [
        { status: "failed", errorCode: "adapter_failed" },
        { status: "failed", errorCode: "adapter_failed" },
      ],
    });
    expect(decision.tripped).toBe(false);
    expect(decision.consecutiveAdapterFailures).toBe(2);
  });

  it("does not trip when a recent success interrupts the failure streak", () => {
    const decision = decideDeadAdapterCircuitBreaker({
      runs: [
        { status: "succeeded", errorCode: null },
        { status: "failed", errorCode: "adapter_failed" },
        { status: "failed", errorCode: "adapter_failed" },
        { status: "failed", errorCode: "adapter_failed" },
      ],
    });
    expect(decision.tripped).toBe(false);
    expect(decision.consecutiveAdapterFailures).toBe(0);
  });

  it("honors a custom threshold", () => {
    const decision = decideDeadAdapterCircuitBreaker({
      runs: [{ status: "failed", errorCode: "process_lost" }],
      threshold: 1,
    });
    expect(decision.tripped).toBe(true);
  });
});
