import { describe, expect, it } from "vitest";
import {
  adapterSupportsRemoteManagedEnvironments,
  getEnvironmentCapabilities,
  isSandboxProviderSupportedForAdapter,
  supportedEnvironmentDriversForAdapter,
} from "./environment-support.js";
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

  it("treats zai_local as a first-class remote-managed local adapter", () => {
    expect(AGENT_ADAPTER_TYPES).toContain("zai_local");
    expect(supportedEnvironmentDriversForAdapter("zai_local")).toEqual([
      "local",
      "ssh",
      "sandbox",
    ]);
  });

  it("treats grok_local as a remote-managed local adapter", () => {
    expect(adapterSupportsRemoteManagedEnvironments("grok_local")).toBe(true);
    expect(supportedEnvironmentDriversForAdapter("grok_local")).toEqual(["local", "ssh", "sandbox"]);
    expect(
      isSandboxProviderSupportedForAdapter("grok_local", "fake-plugin", ["fake-plugin"]),
    ).toBe(true);
  });

  it("includes grok_local sandbox support in environment capabilities", () => {
    const capabilities = getEnvironmentCapabilities(["grok_local"], {
      sandboxProviders: {
        "fake-plugin": { displayName: "Fake Plugin" },
      },
    });

    expect(capabilities.adapters).toEqual([
      expect.objectContaining({
        adapterType: "grok_local",
        drivers: expect.objectContaining({ sandbox: "supported", ssh: "supported" }),
        sandboxProviders: expect.objectContaining({ "fake-plugin": "supported" }),
      }),
    ]);
  });
});
