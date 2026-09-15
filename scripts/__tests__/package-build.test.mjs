import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../package-build.mjs", import.meta.url));

function run(root, ...args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

function runFailure(root, ...args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0, "expected command to fail");
  assert.match(`${result.stdout}${result.stderr}`, /package-local dist|symlinked dist/);
}

test("copies directories and multiple files, then cleans a build directory", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "paperclip-package-build-"));
  try {
    mkdirSync(path.join(root, "src", "migrations", "meta"), { recursive: true });
    mkdirSync(path.join(root, "src", "server"), { recursive: true });
    writeFileSync(path.join(root, "src", "migrations", "001.sql"), "migration");
    writeFileSync(path.join(root, "src", "migrations", "meta", "_journal.json"), "journal");
    writeFileSync(path.join(root, "src", "server", "merge.cjs"), "merge");
    writeFileSync(path.join(root, "src", "server", "extract.sh"), "extract");

    run(root, "copy", "src/migrations", "dist/migrations");
    run(root, "copy", "src/migrations", "dist/migrations");
    run(root, "copy", "src/server/merge.cjs", "src/server/extract.sh", "dist/server");

    assert.equal(readFileSync(path.join(root, "dist", "migrations", "001.sql"), "utf8"), "migration");
    assert.equal(readFileSync(path.join(root, "dist", "migrations", "meta", "_journal.json"), "utf8"), "journal");
    assert.equal(existsSync(path.join(root, "dist", "migrations", "migrations")), false);
    assert.equal(readFileSync(path.join(root, "dist", "server", "merge.cjs"), "utf8"), "merge");
    assert.equal(readFileSync(path.join(root, "dist", "server", "extract.sh"), "utf8"), "extract");

    run(root, "chmod", "dist/server/merge.cjs");
    if (process.platform !== "win32") assert.equal(statSync(path.join(root, "dist", "server", "merge.cjs")).mode & 0o111, 0o111);
    runFailure(root, "clean", "../..");
    runFailure(root, "clean", path.join(root, "dist"));
    run(root, "clean", "dist");
    assert.equal(existsSync(path.join(root, "dist")), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("refuses a symlinked dist directory and its descendants", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "paperclip-package-build-link-"));
  try {
    writeFileSync(path.join(root, "package.json"), "preserve package");
    symlinkSync(root, path.join(root, "dist"), process.platform === "win32" ? "junction" : "dir");
    runFailure(root, "clean", "dist");
    runFailure(root, "clean", "dist/package.json");
    assert.equal(readFileSync(path.join(root, "package.json"), "utf8"), "preserve package");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
