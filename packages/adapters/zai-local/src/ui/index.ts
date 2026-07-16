import { buildSimpleCliConfig } from "@paperclipai/adapter-utils/simple-cli-ui";
import { parseOpenCodeStdoutLine } from "@paperclipai/adapter-opencode-local/ui";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { DEFAULT_ZAI_LOCAL_MODEL } from "../index.js";

export const parseZaiStdoutLine = parseOpenCodeStdoutLine;

export function buildZaiLocalConfig(v: CreateConfigValues): Record<string, unknown> {
  return {
    ...buildSimpleCliConfig(v, { model: DEFAULT_ZAI_LOCAL_MODEL, timeoutSec: 6 * 60 * 60, graceSec: 20 }),
    command: v.command || "opencode",
    dangerouslySkipPermissions: true,
  };
}
