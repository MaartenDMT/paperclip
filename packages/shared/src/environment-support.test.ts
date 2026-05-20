import { describe, expect, it } from "vitest";
import {
  AGENT_ADAPTER_TYPES,
  supportedEnvironmentDriversForAdapter,
} from "./index.js";

describe("adapter environment support", () => {
  it("treats minimax_local as a first-class remote-managed local adapter", () => {
    expect(AGENT_ADAPTER_TYPES).toContain("minimax_local");
    expect(supportedEnvironmentDriversForAdapter("minimax_local")).toEqual([
      "local",
      "ssh",
      "sandbox",
    ]);
  });
});
