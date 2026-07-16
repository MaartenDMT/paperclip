import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalServiceKey } from "../server/src/services/local-service-supervisor.ts";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type DevRunnerMode = "watch" | "dev";

type DevServiceIdentityInput = {
  mode: DevRunnerMode;
  forwardedArgs: string[];
  networkProfile: string;
  port: number;
};

export function createDevServiceIdentity(input: DevServiceIdentityInput) {
  const envFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        mode: input.mode,
        forwardedArgs: input.forwardedArgs,
        networkProfile: input.networkProfile,
        port: input.port,
      }),
    )
    .digest("hex");

  const serviceName = input.mode === "watch" ? "paperclip-dev-watch" : "paperclip-dev-once";
  const serviceKey = createLocalServiceKey({
    profileKind: "paperclip-dev",
    serviceName,
    cwd: repoRoot,
    command: "dev-runner.ts",
    envFingerprint,
    port: input.port,
    scope: {
      repoRoot,
      mode: input.mode,
    },
  });

  return {
    serviceKey,
    serviceName,
    envFingerprint,
  };
}

export function createCompatibleDevServiceIdentities(input: DevServiceIdentityInput) {
  const alternateMode: DevRunnerMode = input.mode === "watch" ? "dev" : "watch";
  return [input.mode, alternateMode].map((mode) =>
    createDevServiceIdentity({
      ...input,
      mode,
    }),
  );
}
