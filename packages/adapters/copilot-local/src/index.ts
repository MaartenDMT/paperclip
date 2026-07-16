import type { AdapterModelProfileDefinition } from "@paperclipai/adapter-utils";

export const type = "copilot_local";
export const label = "GitHub Copilot (local)";
export const DEFAULT_COPILOT_SDK_MODEL = "auto";
export const DEFAULT_COPILOT_LOCAL_CHEAP_MODEL = "gpt-5-mini";
export const SANDBOX_INSTALL_COMMAND = "";

export const models: Array<{ id: string; label: string }> = [
  { id: DEFAULT_COPILOT_SDK_MODEL, label: "Copilot default" },
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "claude-opus-4.7", label: "Claude Opus 4.7" },
  { id: "claude-opus-4.6", label: "Claude Opus 4.6" },
  { id: "claude-opus-4.6-fast", label: "Claude Opus 4.6 Fast" },
  { id: "claude-opus-4.5", label: "Claude Opus 4.5" },
  { id: "gpt-5.5", label: "gpt-5.5" },
  { id: "gpt-5.4", label: "gpt-5.4" },
  { id: "gpt-5.3-codex", label: "gpt-5.3-codex" },
  { id: "gpt-5.2-codex", label: "gpt-5.2-codex" },
  { id: "gpt-5.2", label: "gpt-5.2" },
  { id: "gpt-5.4-mini", label: "gpt-5.4-mini" },
  { id: "gpt-5-mini", label: "gpt-5-mini" },
  { id: "gpt-4.1", label: "gpt-4.1" },
];

export const modelProfiles: AdapterModelProfileDefinition[] = [
  {
    key: "cheap",
    label: "Copilot cheap lane",
    description: "Use Copilot GPT-5 mini for low-cost scheduled and routine runs.",
    adapterConfig: {
      model: DEFAULT_COPILOT_LOCAL_CHEAP_MODEL,
    },
    source: "adapter_default",
  },
];

export const agentConfigurationDoc = `# copilot_local agent configuration

Adapter: copilot_local

Runs the local GitHub Copilot CLI. The default command is "copilot" and the adapter invokes non-interactive mode with --prompt.

Core fields:
- cwd: working directory for the command
- instructionsFilePath: markdown instructions prepended to the run prompt
- model: Copilot model id; use "auto" to let the CLI choose
- command: defaults to "copilot"
- extraArgs: extra command args
- env: Copilot SDK bridge environment variables

Notes:
- Model detection checks COPILOT_MODEL, GITHUB_COPILOT_MODEL, and common Copilot config files.
- The cheap model profile defaults to "gpt-5-mini".
- Set dangerouslySkipPermissions when the run should pass --allow-all-tools for non-interactive agent work.
`;
