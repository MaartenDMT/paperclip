import { describe, expect, it } from "vitest";
import {
  createCompatibleDevServiceIdentities,
  createDevServiceIdentity,
} from "../../../scripts/dev-service-profile.ts";

describe("dev-service-profile", () => {
  it("returns both compatible runner modes with the requested mode first", () => {
    const identities = createCompatibleDevServiceIdentities({
      mode: "dev",
      forwardedArgs: ["--bind", "loopback"],
      networkProfile: "default",
      port: 3100,
    });

    expect(identities).toHaveLength(2);
    expect(identities[0]?.serviceName).toBe("paperclip-dev-once");
    expect(identities[1]?.serviceName).toBe("paperclip-dev-watch");
    expect(identities[0]?.serviceKey).not.toBe(identities[1]?.serviceKey);
  });

  it("keeps legacy single-mode identity creation stable", () => {
    const devIdentity = createDevServiceIdentity({
      mode: "dev",
      forwardedArgs: [],
      networkProfile: "default",
      port: 3100,
    });
    const watchIdentity = createDevServiceIdentity({
      mode: "watch",
      forwardedArgs: [],
      networkProfile: "default",
      port: 3100,
    });

    expect(devIdentity.serviceName).toBe("paperclip-dev-once");
    expect(watchIdentity.serviceName).toBe("paperclip-dev-watch");
    expect(devIdentity.serviceKey).not.toBe(watchIdentity.serviceKey);
    expect(devIdentity.envFingerprint).not.toBe(watchIdentity.envFingerprint);
  });
});
