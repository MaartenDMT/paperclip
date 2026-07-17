import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@paperclipai/plugin-sdk/testing": fileURLToPath(new URL("../../packages/plugins/sdk/src/testing.ts", import.meta.url)),
      "@paperclipai/plugin-sdk": fileURLToPath(new URL("../../packages/plugins/sdk/src/index.ts", import.meta.url)),
      "@paperclipai/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
  },
});
