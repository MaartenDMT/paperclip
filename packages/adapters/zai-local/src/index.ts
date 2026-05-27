import type { AdapterModelProfileDefinition } from "@paperclipai/adapter-utils";

export const type = "zai_local";
export const label = "Z.AI CLI (local)";
export const DEFAULT_ZAI_LOCAL_MODEL = "zai-coding-plan/glm-4.7";
export const DEFAULT_ZAI_LOCAL_CHEAP_MODEL = "zai-coding-plan/glm-4.5-air";
export const SANDBOX_INSTALL_COMMAND = "npm install -g opencode-ai";

export const models: Array<{ id: string; label: string }> = [
  { id: DEFAULT_ZAI_LOCAL_MODEL, label: "zai-coding-plan/glm-4.7" },
  { id: "zai-coding-plan/glm-4.5", label: "zai-coding-plan/glm-4.5" },
  { id: DEFAULT_ZAI_LOCAL_CHEAP_MODEL, label: "zai-coding-plan/glm-4.5-air" },
];

export const modelProfiles: AdapterModelProfileDefinition[] = [
  {
    key: "cheap",
    label: "Z.AI cheap lane",
    description: "Use GLM 4.5 Air for low-cost scheduled and routine runs.",
    adapterConfig: {
      model: DEFAULT_ZAI_LOCAL_CHEAP_MODEL,
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

export const agentConfigurationDoc = `# zai_local agent configuration

Adapter: zai_local

Runs Z.AI coding models through OpenCode locally or in a Paperclip execution environment.

Core fields:
- cwd: working directory for the CLI process
- instructionsFilePath: markdown instructions prepended to the run prompt
- model: OpenCode model id; supported defaults are "zai-coding-plan/glm-4.7", "zai-coding-plan/glm-4.5", and "zai-coding-plan/glm-4.5-air"
- command: defaults to "opencode"
- extraArgs: extra CLI args appended after Paperclip's default args
- env: CLI authentication/environment variables

Notes:
- Default execution uses OpenCode's non-interactive agent mode.
- Z.AI is intended for weaker/cheaper coding agents; use GLM 4.7, GLM 4.5, or GLM 4.5 Air only.
- The cheap model profile defaults to "zai-coding-plan/glm-4.5-air".
- The adapter ships Codex fallback profiles for quota and transient provider failures.
- Install command for sandbox environments: npm install -g opencode-ai
`;
