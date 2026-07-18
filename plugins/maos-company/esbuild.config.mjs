import { build } from "esbuild";

await build({
  entryPoints: ["src/worker.ts"],
  outfile: "dist/worker.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  // Bundle workspace imports (e.g. @paperclipai/shared) so the standalone
  // worker resolves without a workspace node_modules; only the SDK stays
  // external (host links it into the plugin dir).
  external: ["@paperclipai/plugin-sdk"],
  sourcemap: true,
});
