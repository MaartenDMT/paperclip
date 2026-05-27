import type { UIAdapterModule } from "../types";
import { parseZaiStdoutLine, buildZaiLocalConfig } from "@paperclipai/adapter-zai-local/ui";
import { SimpleLocalCliConfigFields } from "../simple-local-cli-config-fields";

export const zaiLocalUIAdapter: UIAdapterModule = {
  type: "zai_local",
  label: "Z.AI CLI (local)",
  parseStdoutLine: parseZaiStdoutLine,
  ConfigFields: SimpleLocalCliConfigFields,
  buildAdapterConfig: buildZaiLocalConfig,
};
