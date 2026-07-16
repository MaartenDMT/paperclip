import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_RECOVERY_RESUME_CYCLES,
  decideRecoveryCycleBudget,
} from "./recovery-cycle-budget.js";

describe("decideRecoveryCycleBudget", () => {
  it("does not exhaust below the threshold", () => {
    const decision = decideRecoveryCycleBudget({ priorResumeCycles: 2 });
    expect(decision.exhausted).toBe(false);
    expect(decision.threshold).toBe(DEFAULT_MAX_RECOVERY_RESUME_CYCLES);
  });

  it("exhausts once prior resume cycles reach the threshold", () => {
    expect(decideRecoveryCycleBudget({ priorResumeCycles: 3 }).exhausted).toBe(true);
    expect(decideRecoveryCycleBudget({ priorResumeCycles: 9 }).exhausted).toBe(true);
  });

  it("allows the configured number of auto-resumes before parking", () => {
    // Threshold 3 => resumes at depth 0,1,2 are permitted; depth 3 parks.
    expect(decideRecoveryCycleBudget({ priorResumeCycles: 0 }).exhausted).toBe(false);
    expect(decideRecoveryCycleBudget({ priorResumeCycles: 1 }).exhausted).toBe(false);
    expect(decideRecoveryCycleBudget({ priorResumeCycles: 2 }).exhausted).toBe(false);
    expect(decideRecoveryCycleBudget({ priorResumeCycles: 3 }).exhausted).toBe(true);
  });

  it("honors a custom threshold", () => {
    expect(decideRecoveryCycleBudget({ priorResumeCycles: 1, threshold: 1 }).exhausted).toBe(true);
    expect(decideRecoveryCycleBudget({ priorResumeCycles: 0, threshold: 1 }).exhausted).toBe(false);
  });
});
