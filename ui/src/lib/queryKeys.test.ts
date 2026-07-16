import { describe, expect, it } from "vitest";
import { queryKeys } from "./queryKeys";

describe("campaign query keys", () => {
  it("exposes stable campaign list, detail, phase, and review keys", () => {
    expect(queryKeys.campaigns.list("company-1")).toEqual(["campaigns", "company-1"]);
    expect(queryKeys.campaigns.detail("campaign-1")).toEqual(["campaigns", "detail", "campaign-1"]);
    expect(queryKeys.campaigns.phases("campaign-1")).toEqual(["campaigns", "phases", "campaign-1"]);
    expect(queryKeys.campaigns.phase("phase-1")).toEqual(["campaigns", "phase", "phase-1"]);
    expect(queryKeys.campaigns.plan("phase-1")).toEqual(["campaigns", "phase", "phase-1", "plan"]);
    expect(queryKeys.campaigns.planReview("phase-1")).toEqual([
      "campaigns",
      "phase",
      "phase-1",
      "plan-review",
    ]);
  });
});
