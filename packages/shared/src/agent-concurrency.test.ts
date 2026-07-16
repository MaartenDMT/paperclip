import { describe, expect, it } from "vitest";
import {
  AGENT_COORDINATION_MAX_CONCURRENT_RUNS,
  AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
  defaultAgentMaxConcurrentRuns,
} from "./index.js";

describe("agent concurrency defaults", () => {
  it("defaults specialist agents to one active run", () => {
    expect(defaultAgentMaxConcurrentRuns({ role: "engineer", name: "ClaudeCoder" })).toBe(
      AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
    );
  });

  it("defaults CEO and management signals to two active runs", () => {
    expect(defaultAgentMaxConcurrentRuns({ role: "ceo", name: "CEO" })).toBe(
      AGENT_COORDINATION_MAX_CONCURRENT_RUNS,
    );
    expect(defaultAgentMaxConcurrentRuns({ role: "agent", title: "Chief Marketing Officer", name: "CMO" })).toBe(
      AGENT_COORDINATION_MAX_CONCURRENT_RUNS,
    );
    expect(defaultAgentMaxConcurrentRuns({ role: "general", title: "Coordinator", name: "Delivery Coordinator" })).toBe(
      AGENT_COORDINATION_MAX_CONCURRENT_RUNS,
    );
  });
});
