import type { AdapterModelProfileDefinition } from "@paperclipai/adapter-utils";

export const type = "minimax_local";
export const label = "MiniMax CLI (local)";
export const DEFAULT_MINIMAX_LOCAL_MODEL = "minimax/MiniMax-M2.7";
export const DEFAULT_MINIMAX_LOCAL_CHEAP_MODEL = "minimax/MiniMax-M2.1";
export const SANDBOX_INSTALL_COMMAND = "npm install -g opencode-ai";

export const models: Array<{ id: string; label: string }> = [
  { id: "minimax/MiniMax-M2", label: "minimax/MiniMax-M2" },
  { id: DEFAULT_MINIMAX_LOCAL_CHEAP_MODEL, label: "minimax/MiniMax-M2.1" },
  { id: "minimax/MiniMax-M2.5", label: "minimax/MiniMax-M2.5" },
  { id: "minimax/MiniMax-M2.5-highspeed", label: "minimax/MiniMax-M2.5-highspeed" },
  { id: DEFAULT_MINIMAX_LOCAL_MODEL, label: "minimax/MiniMax-M2.7" },
  { id: "minimax/MiniMax-M2.7-highspeed", label: "minimax/MiniMax-M2.7-highspeed" },
];

export const modelProfiles: AdapterModelProfileDefinition[] = [
  {
    key: "cheap",
    label: "MiniMax cheap lane",
    description: "Use MiniMax M2.1 for low-cost scheduled and routine runs.",
    adapterConfig: {
      model: DEFAULT_MINIMAX_LOCAL_CHEAP_MODEL,
    },
    source: "adapter_default",
  },
  {
    key: "fallback",
    label: "Codex fallback",
    description: "Retry quota or transient provider failures through Codex on GPT-5.4 Mini.",
    adapterConfig: {
      adapterType: "codex_local",
      command: "codex",
      provider: "openai",
      model: "gpt-5.4-mini",
      modelReasoningEffort: "low",
    },
    source: "adapter_default",
  },
];

export const agentConfigurationDoc = `# minimax_local agent configuration

Adapter: minimax_local

Runs MiniMax models through OpenCode locally or in a Paperclip execution environment.

Core fields:
- cwd: working directory for the CLI process
- instructionsFilePath: markdown instructions prepended to the run prompt
- model: OpenCode model id; defaults to "minimax/MiniMax-M2.7"; supported picker defaults mirror the current OpenCode MiniMax list
- command: defaults to "opencode"
- extraArgs: extra CLI args appended after Paperclip's default args
- env: CLI authentication/environment variables

Notes:
- Default execution uses OpenCode's non-interactive agent mode.
- Legacy MiniMax model ids such as "MiniMax-M2.7" are normalized to "minimax/MiniMax-M2.7".
- The cheap model profile defaults to "minimax/MiniMax-M2.1".
- Model detection checks MINIMAX_MODEL, MMX_MODEL, and common mmx/MiniMax config files.
- The adapter ships a Codex fallback profile for quota and transient provider failures.
- Install command for sandbox environments: npm install -g opencode-ai
`;
