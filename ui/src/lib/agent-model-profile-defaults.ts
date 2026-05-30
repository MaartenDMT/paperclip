import type { AgentRole } from "@paperclipai/shared";
import {
  DEFAULT_MINIMAX_LOCAL_CHEAP_MODEL,
} from "@paperclipai/adapter-minimax-local";
import { codexModelDefaultsForRole } from "./codex-agent-model-defaults";

const CODEX_FALLBACK_MODEL = "gpt-5.4-mini";

type AgentProfileDefaults = {
  primaryModel?: string;
  cheap: {
    adapterType: "codex_local" | "minimax_local";
    command: "codex" | "opencode";
    provider?: string;
    model: string;
    reasoningEffort?: "low" | "medium" | "high";
  };
  fallback: {
    adapterType: "codex_local" | "minimax_local";
    command: "codex" | "opencode";
    provider?: string;
    model: string;
    reasoningEffort?: "low" | "medium" | "high";
  };
};

const CODEX_DEFAULT_ROLES = new Set<AgentRole>([
  "ceo",
  "cto",
  "security",
  "devops",
  "engineer",
  "qa",
  "pm",
]);
const MINIMAX_DEFAULT_ROLES = new Set<AgentRole>([
  "designer",
  "researcher",
  "general",
]);
const MINIMAX_TITLE_MARKERS = [
  "content",
  "writer",
  "copy",
  "editor",
  "marketing",
  "social",
  "research",
  "design",
  "analyst",
  "support",
  "triage",
];

const MINIMAX_LOWER_AGENT_DEFAULTS: AgentProfileDefaults = {
  cheap: {
    adapterType: "minimax_local",
    command: "opencode",
    model: DEFAULT_MINIMAX_LOCAL_CHEAP_MODEL,
  },
  fallback: {
    adapterType: "codex_local",
    command: "codex",
    provider: "openai",
    model: CODEX_FALLBACK_MODEL,
    reasoningEffort: "low",
  },
};

export function agentModelProfileDefaultsForRole(role: string | null | undefined): AgentProfileDefaults {
  const normalized = typeof role === "string" ? role.trim() : "";
  if (MINIMAX_DEFAULT_ROLES.has(normalized as AgentRole)) {
    return MINIMAX_LOWER_AGENT_DEFAULTS;
  }

  const codex = codexModelDefaultsForRole(normalized);
  return {
    primaryModel: codex.primaryModel,
    cheap: {
      adapterType: codex.fallbackAdapterType,
      command: codex.fallbackCommand,
      provider: codex.fallbackProvider,
      model: codex.fallbackModel,
      reasoningEffort: codex.fallbackReasoningEffort,
    },
    fallback: {
      adapterType: codex.fallbackAdapterType,
      command: codex.fallbackCommand,
      provider: codex.fallbackProvider,
      model: codex.fallbackModel,
      reasoningEffort: codex.fallbackReasoningEffort,
    },
  };
}

export function shouldDefaultNewAgentToMiniMax(input: {
  role: string | null | undefined;
  name?: string | null;
  title?: string | null;
  isFirstAgent?: boolean;
}) {
  if (input.isFirstAgent) return false;
  const normalizedRole = typeof input.role === "string" ? input.role.trim() : "";
  if (CODEX_DEFAULT_ROLES.has(normalizedRole as AgentRole)) return false;
  if (MINIMAX_DEFAULT_ROLES.has(normalizedRole as AgentRole)) return true;

  const searchable = `${input.name ?? ""} ${input.title ?? ""}`.toLowerCase();
  return MINIMAX_TITLE_MARKERS.some((marker) => searchable.includes(marker));
}

export function minimaxCurrentAdapterFallbackDefaults() {
  return {
    cheapModel: DEFAULT_MINIMAX_LOCAL_CHEAP_MODEL,
    cheapModelEnabled: true,
    cheapModelAdapterType: "",
    cheapModelCommand: "",
    cheapModelProvider: "",
    cheapModelReasoningEffort: "",
    fallbackModel: CODEX_FALLBACK_MODEL,
    fallbackModelEnabled: true,
    fallbackModelAdapterType: "codex_local",
    fallbackModelCommand: "codex",
    fallbackModelProvider: "openai",
    fallbackModelReasoningEffort: "low",
  };
}
