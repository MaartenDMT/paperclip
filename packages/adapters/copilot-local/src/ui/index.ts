import { buildSimpleCliConfig, parseSimpleCliStdoutLine } from "@paperclipai/adapter-utils/simple-cli-ui";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { DEFAULT_COPILOT_SDK_MODEL } from "../index.js";

export const parseCopilotLocalStdoutLine = parseSimpleCliStdoutLine;

export function buildCopilotLocalConfig(v: CreateConfigValues): Record<string, unknown> {
  return buildSimpleCliConfig(v, { model: DEFAULT_COPILOT_SDK_MODEL, timeoutSec: 0, graceSec: 20 });
}
