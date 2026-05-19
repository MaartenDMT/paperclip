import type { AdapterModelProfileDefinition } from "@paperclipai/adapter-utils";

export const type = "minimax_local";
export const label = "MiniMax CLI (local)";
export const DEFAULT_MINIMAX_LOCAL_MODEL = "auto";
export const SANDBOX_INSTALL_COMMAND = "npm install -g mmx-cli";

export const models: Array<{ id: string; label: string }> = [
  { id: DEFAULT_MINIMAX_LOCAL_MODEL, label: "MiniMax default" },
  { id: "MiniMax-M2.1", label: "MiniMax-M2.1" },
  { id: "MiniMax-M2.5", label: "MiniMax-M2.5" },
  { id: "MiniMax-M2.7", label: "MiniMax-M2.7" },
];

export const modelProfiles: AdapterModelProfileDefinition[] = [];

export const agentConfigurationDoc = `# minimax_local agent configuration

Adapter: minimax_local

Runs MiniMax's mmx CLI locally or in a Paperclip execution environment.

Core fields:
- cwd: working directory for the CLI process
- instructionsFilePath: markdown instructions prepended to the run prompt
- model: MiniMax model id; use "auto" to let the CLI choose
- command: defaults to "mmx"
- extraArgs: extra CLI args appended after Paperclip's default args
- env: CLI authentication/environment variables

Notes:
- Default execution uses mmx text chat with a single message.
- Model detection checks MINIMAX_MODEL, MMX_MODEL, and common mmx/MiniMax config files.
- Install command for sandbox environments: npm install -g mmx-cli
`;
