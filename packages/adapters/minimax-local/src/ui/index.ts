import { buildSimpleCliConfig, parseSimpleCliStdoutLine } from "@paperclipai/adapter-utils/simple-cli-ui";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { DEFAULT_MINIMAX_LOCAL_MODEL } from "../index.js";

export const parseMiniMaxStdoutLine = parseSimpleCliStdoutLine;

export function buildMiniMaxLocalConfig(v: CreateConfigValues): Record<string, unknown> {
  return buildSimpleCliConfig(v, { model: DEFAULT_MINIMAX_LOCAL_MODEL, timeoutSec: 0, graceSec: 20 });
}
