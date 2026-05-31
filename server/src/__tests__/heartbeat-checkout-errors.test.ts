import { describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import { readBlockedCheckoutUnresolvedBlockerIssueIds } from "../services/heartbeat-checkout-errors.js";

describe("heartbeat checkout error classification", () => {
  it("extracts unresolved blocker ids from checkout guard errors", () => {
    const error = new HttpError(422, "Issue is blocked by unresolved blockers", {
      unresolvedBlockerIssueIds: ["blocker-1", "", "blocker-2"],
    });

    expect(readBlockedCheckoutUnresolvedBlockerIssueIds(error)).toEqual([
      "blocker-1",
      "blocker-2",
    ]);
  });

  it("ignores unrelated checkout failures", () => {
    expect(readBlockedCheckoutUnresolvedBlockerIssueIds(new HttpError(409, "Issue already checked out"))).toBeNull();
    expect(readBlockedCheckoutUnresolvedBlockerIssueIds(new Error("Issue is blocked by unresolved blockers"))).toBeNull();
  });
});
