import type { AdapterModelProfileDefinition } from "@paperclipai/adapter-utils";

export const type = "kimi_local";
export const label = "Kimi CLI (local)";
export const DEFAULT_KIMI_LOCAL_MODEL = "auto";
export const SANDBOX_INSTALL_COMMAND =
  "if command -v uv >/dev/null 2>&1; then uv tool install --python 3.13 kimi-cli; else curl -LsSf https://code.kimi.com/install.sh | bash; fi";

export const models: Array<{ id: string; label: string }> = [
  { id: DEFAULT_KIMI_LOCAL_MODEL, label: "Kimi default" },
  { id: "kimi-code/kimi-for-coding", label: "Kimi for Coding" },
  { id: "kimi-k2-0711-preview", label: "kimi-k2-0711-preview" },
];

export const modelProfiles: AdapterModelProfileDefinition[] = [];

export const agentConfigurationDoc = `# kimi_local agent configuration

Adapter: kimi_local

Runs the Kimi CLI locally or in a Paperclip execution environment.

Core fields:
- cwd: working directory for the CLI process
- instructionsFilePath: markdown instructions prepended to the run prompt
- model: Kimi model id; use "auto" to let the CLI choose
- command: defaults to "kimi"
- extraArgs: extra CLI args appended after Paperclip's default args
- env: CLI authentication/environment variables

Notes:
- Default execution uses Kimi's print mode with stream JSON output.
- Model detection checks KIMI_MODEL, KIMI_MODEL_NAME, MOONSHOT_MODEL, and common Kimi config files.
- Install command for sandbox environments follows Kimi's official installer: uv tool install kimi-cli when uv is present, otherwise https://code.kimi.com/install.sh.
`;
