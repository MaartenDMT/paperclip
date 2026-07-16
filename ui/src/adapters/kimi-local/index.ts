import type { UIAdapterModule } from "../types";
import { parseKimiStdoutLine, buildKimiLocalConfig } from "@paperclipai/adapter-kimi-local/ui";
import { SimpleLocalCliConfigFields } from "../simple-local-cli-config-fields";

export const kimiLocalUIAdapter: UIAdapterModule = {
  type: "kimi_local",
  label: "Kimi CLI (local)",
  parseStdoutLine: parseKimiStdoutLine,
  ConfigFields: SimpleLocalCliConfigFields,
  buildAdapterConfig: buildKimiLocalConfig,
};
