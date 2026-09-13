import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const assetDirectories = [
  ["src/onboarding-assets", "dist/onboarding-assets"],
  ["src/built-ins", "dist/built-ins"],
  ["src/services/scripts", "dist/services/scripts"],
  ["../packages/paperclip-runner/dist", "dist/vendor/paperclip-runner"],
];

for (const [sourceRelative, destinationRelative] of assetDirectories) {
  const source = path.resolve(serverRoot, sourceRelative);
  const destination = path.resolve(serverRoot, destinationRelative);
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source)) {
    cpSync(path.join(source, entry), path.join(destination, entry), {
      recursive: true,
      force: true,
    });
  }
}
