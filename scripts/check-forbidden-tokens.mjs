#!/usr/bin/env node
import forbiddenTokens from "./check-forbidden-tokens.cjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const {
  main,
  readForbiddenTokensFile,
  resolveDynamicForbiddenTokens,
  resolveForbiddenTokens,
  resolveRepoPaths,
  runForbiddenTokenCheck,
} = forbiddenTokens;

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main();
}
