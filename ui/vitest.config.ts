import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const lexicalEntry = path.join(path.dirname(require.resolve("lexical")), "Lexical.mjs");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lexical: path.resolve(__dirname, "./node_modules/lexical/dist/Lexical.mjs"),
      lexical: lexicalEntry,
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
