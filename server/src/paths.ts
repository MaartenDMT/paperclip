import fs from "node:fs";
import path from "node:path";
import { resolveDefaultConfigPath } from "./home-paths.js";

const PAPERCLIP_CONFIG_BASENAME = "config.json";
const PAPERCLIP_ENV_FILENAME = ".env";

function findConfigFileFromAncestors(startDir: string): string | null {
  const absoluteStartDir = path.resolve(startDir);
  let currentDir = absoluteStartDir;

  while (true) {
    const candidate = path.resolve(currentDir, ".paperclip", PAPERCLIP_CONFIG_BASENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const nextDir = path.resolve(currentDir, "..");
    if (nextDir === currentDir) break;
    currentDir = nextDir;
  }

  return null;
}

function resolveExistingPath(candidatePath: string): string {
  const resolvedPath = path.resolve(candidatePath);
  try {
    if (fs.existsSync(resolvedPath)) {
      return fs.realpathSync.native(resolvedPath);
    }
  } catch {
    // Fall back to the normalized path when realpath is unavailable.
  }
  return resolvedPath;
}

export function resolvePaperclipConfigPath(overridePath?: string): string {
  if (overridePath) return resolveExistingPath(overridePath);
  if (process.env.PAPERCLIP_CONFIG) return resolveExistingPath(process.env.PAPERCLIP_CONFIG);
  const discoveredPath = findConfigFileFromAncestors(process.cwd()) ?? resolveDefaultConfigPath();
  return resolveExistingPath(discoveredPath);
}

export function resolvePaperclipEnvPath(overrideConfigPath?: string): string {
  return path.resolve(path.dirname(resolvePaperclipConfigPath(overrideConfigPath)), PAPERCLIP_ENV_FILENAME);
}
