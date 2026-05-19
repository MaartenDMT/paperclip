import type { UIAdapterModule } from "../types";
import { parseCopilotLocalStdoutLine, buildCopilotLocalConfig } from "@paperclipai/adapter-copilot-local/ui";
import { SimpleLocalCliConfigFields } from "../simple-local-cli-config-fields";

export const copilotLocalUIAdapter: UIAdapterModule = {
  type: "copilot_local",
  label: "GitHub Copilot (local)",
  parseStdoutLine: parseCopilotLocalStdoutLine,
  ConfigFields: SimpleLocalCliConfigFields,
  buildAdapterConfig: buildCopilotLocalConfig,
};
