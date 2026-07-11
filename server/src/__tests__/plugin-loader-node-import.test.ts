import path from "node:path";

import { describe, expect, it } from "vitest";

import { createNodeImportSpecifier } from "../services/plugin-loader.js";

describe("createNodeImportSpecifier", () => {
  it("formats local paths for Node --import", () => {
    const specifier = createNodeImportSpecifier(
      path.resolve("cli", "node_modules", "tsx", "dist", "loader.mjs"),
    );

    expect(specifier).toMatch(/^file:\/\//);
    expect(specifier).not.toMatch(/^[A-Za-z]:/);
  });
});
