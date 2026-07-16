import { buildSimpleCliConfig, parseSimpleCliStdoutLine } from "@paperclipai/adapter-utils/simple-cli-ui";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { DEFAULT_KIMI_LOCAL_MODEL } from "../index.js";

export const parseKimiStdoutLine = parseSimpleCliStdoutLine;

export function buildKimiLocalConfig(v: CreateConfigValues): Record<string, unknown> {
  return buildSimpleCliConfig(v, { model: DEFAULT_KIMI_LOCAL_MODEL, timeoutSec: 0, graceSec: 20 });
}
