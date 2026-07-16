import type { UIAdapterModule } from "../types";
import { parseMiniMaxStdoutLine, buildMiniMaxLocalConfig } from "@paperclipai/adapter-minimax-local/ui";
import { SimpleLocalCliConfigFields } from "../simple-local-cli-config-fields";

export const minimaxLocalUIAdapter: UIAdapterModule = {
  type: "minimax_local",
  label: "MiniMax CLI (local)",
  parseStdoutLine: parseMiniMaxStdoutLine,
  ConfigFields: SimpleLocalCliConfigFields,
  buildAdapterConfig: buildMiniMaxLocalConfig,
};
