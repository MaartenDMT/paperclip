import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const workspaceYaml = readFileSync(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8");
const lockfileYaml = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");

test("dev runner pnpm config stays in current pnpm-supported locations", () => {
  assert.equal(packageJson.packageManager, "pnpm@9.15.4");
  assert.equal(packageJson.pnpm, undefined);
  assert.equal(packageJson.devDependencies?.tsx, "^4.19.2");

  assert.match(workspaceYaml, /^node-linker: hoisted$/m);
  assert.match(workspaceYaml, /^overrides:\r?\n  rollup: ">=4\.59\.0"$/m);
  assert.match(
    workspaceYaml,
    /^patchedDependencies:\r?\n  embedded-postgres@18\.1\.0-beta\.16: patches\/embedded-postgres@18\.1\.0-beta\.16\.patch$/m,
  );

  assert.doesNotMatch(lockfileYaml, /^overrides:/m);
  assert.doesNotMatch(lockfileYaml, /^patchedDependencies:/m);
  assert.doesNotMatch(lockfileYaml, /patch_hash=/);
});
