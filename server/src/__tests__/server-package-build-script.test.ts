import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageJsonPath = fileURLToPath(
  new URL("../../package.json", import.meta.url),
);
const copyBuildAssetsPath = fileURLToPath(
  new URL("../../scripts/copy-build-assets.mjs", import.meta.url),
);
const runnerShimPath = fileURLToPath(
  new URL("../vendor/paperclip-runner/index.ts", import.meta.url),
);
const evidenceClassifierPath = fileURLToPath(
  new URL("../services/native-runtime/evidence-classifier.ts", import.meta.url),
);
const workspaceDiffReprojectionPath = fileURLToPath(
  new URL("../services/provider-trace-workspace-diff-reprojection.ts", import.meta.url),
);

describe("server package build script", () => {
  it("builds the compiled package entry during prepack", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.prepack).toBe(
      "pnpm run prepare:ui-dist && pnpm run build",
    );
  });

  it("copies runtime assets and the vendored runner into dist", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.build).toContain(
      "node scripts/copy-build-assets.mjs",
    );

    const fixtureRoot = mkdtempSync(join(tmpdir(), "paperclip-build-assets-"));
    try {
      const serverRoot = join(fixtureRoot, "server");
      const scriptPath = join(serverRoot, "scripts", "copy-build-assets.mjs");
      mkdirSync(join(serverRoot, "scripts"), { recursive: true });
      copyFileSync(copyBuildAssetsPath, scriptPath);
      const directories = [
        ["server/src/onboarding-assets", "server/dist/onboarding-assets"],
        ["server/src/built-ins", "server/dist/built-ins"],
        ["server/src/services/scripts", "server/dist/services/scripts"],
        ["packages/paperclip-runner/dist", "server/dist/vendor/paperclip-runner"],
      ] as const;
      for (const [source] of directories) {
        mkdirSync(join(fixtureRoot, source, "nested"), { recursive: true });
        writeFileSync(join(fixtureRoot, source, "nested", "fixture.txt"), source);
      }

      const result = spawnSync(process.execPath, [scriptPath], {
        encoding: "utf8",
        timeout: 5_000,
      });
      expect(result.status, result.stderr).toBe(0);
      for (const [source, destination] of directories) {
        expect(
          readFileSync(
            join(fixtureRoot, destination, "nested", "fixture.txt"),
            "utf8",
          ),
        ).toBe(source);
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("vendors the private runner runtime without a production workspace dependency", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(
      packageJson.dependencies?.["@paperclipai/paperclip-runner"],
    ).toBeUndefined();
    expect(packageJson.devDependencies?.["@paperclipai/paperclip-runner"]).toBe(
      "workspace:*",
    );
    expect(packageJson.scripts?.["prepare:runner-vendor"]).toBe(
      "pnpm --filter @paperclipai/paperclip-runner build",
    );
  });

  it("verifies vendored runner dependencies are mirrored before building", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    // See scripts/verify-runner-vendor-dependencies.mjs: packages/paperclip-runner
    // is vendored by copy-build-assets.mjs from its compiled dist/, so every runtime
    // dependency it imports must also be a direct dependency of server. This
    // check derives that requirement from an esbuild scan of the vendored
    // entry points instead of relying on a human to have kept a hand-copied
    // list in sync (the smol-toml incident in #13110/#13116).
    expect(packageJson.scripts?.build).toContain(
      "node scripts/verify-runner-vendor-dependencies.mjs",
    );
  });

  it("loads runner source when the source server starts before workspace builds", () => {
    const shim = readFileSync(runnerShimPath, "utf8");

    expect(shim).toContain(
      '"../../../../packages/paperclip-runner/src/index.ts"',
    );
    expect(shim).not.toContain(
      'export * from "@paperclipai/paperclip-runner"',
    );
  });

  it("routes source-mode runtime imports through the runner shim", () => {
    for (const consumerPath of [
      evidenceClassifierPath,
      workspaceDiffReprojectionPath,
    ]) {
      const consumer = readFileSync(consumerPath, "utf8");

      expect(consumer).toContain('vendor/paperclip-runner/index.js"');
      expect(consumer).not.toContain('from "@paperclipai/paperclip-runner"');
    }
  });
});
