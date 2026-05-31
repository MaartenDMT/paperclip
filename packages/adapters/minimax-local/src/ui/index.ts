import { buildSimpleCliConfig } from "@paperclipai/adapter-utils/simple-cli-ui";
import { parseOpenCodeStdoutLine } from "@paperclipai/adapter-opencode-local";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { DEFAULT_MINIMAX_LOCAL_MODEL } from "../index.js";

export const parseMiniMaxStdoutLine = parseOpenCodeStdoutLine;

export function buildMiniMaxLocalConfig(v: CreateConfigValues): Record<string, unknown> {
  return {
    ...buildSimpleCliConfig(v, { model: DEFAULT_MINIMAX_LOCAL_MODEL, timeoutSec: 6 * 60 * 60, graceSec: 20 }),
    command: v.command || "opencode",
    dangerouslySkipPermissions: true,
  };
}
