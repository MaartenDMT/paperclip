import type { AgentRole } from "@paperclipai/shared";

export const CODEX_LOCAL_FALLBACK_PROVIDER = "openai";

export type CodexModelUseCase = "strong" | "middle" | "weaker";

export interface CodexModelDefaults {
  useCase: CodexModelUseCase;
  primaryModel: string;
  fallbackAdapterType: "codex_local";
  fallbackCommand: "codex";
  fallbackProvider: typeof CODEX_LOCAL_FALLBACK_PROVIDER;
  fallbackModel: string;
  fallbackReasoningEffort: "low" | "medium" | "high";
}

const CODEX_MODEL_DEFAULTS_BY_USE_CASE: Record<CodexModelUseCase, CodexModelDefaults> = {
  strong: {
    useCase: "strong",
    primaryModel: "gpt-5.4",
    fallbackAdapterType: "codex_local",
    fallbackCommand: "codex",
    fallbackProvider: CODEX_LOCAL_FALLBACK_PROVIDER,
    fallbackModel: "gpt-5.3-codex",
    fallbackReasoningEffort: "high",
  },
  middle: {
    useCase: "middle",
    primaryModel: "gpt-5.3-codex",
    fallbackAdapterType: "codex_local",
    fallbackCommand: "codex",
    fallbackProvider: CODEX_LOCAL_FALLBACK_PROVIDER,
    fallbackModel: "gpt-5.2",
    fallbackReasoningEffort: "medium",
  },
  weaker: {
    useCase: "weaker",
    primaryModel: "gpt-5.2",
    fallbackAdapterType: "codex_local",
    fallbackCommand: "codex",
    fallbackProvider: CODEX_LOCAL_FALLBACK_PROVIDER,
    fallbackModel: "gpt-5.4-mini",
    fallbackReasoningEffort: "low",
  },
};

const CODEX_ROLE_USE_CASES: Record<AgentRole, CodexModelUseCase> = {
  ceo: "strong",
  cto: "strong",
  cmo: "weaker",
  cfo: "weaker",
  security: "strong",
  engineer: "middle",
  designer: "weaker",
  pm: "middle",
  qa: "weaker",
  devops: "strong",
  researcher: "middle",
  general: "weaker",
};

export const CODEX_LOCAL_ROLE_DEFAULT_PRIMARY_MODELS = Array.from(
  new Set(Object.values(CODEX_MODEL_DEFAULTS_BY_USE_CASE).map((entry) => entry.primaryModel)),
);

export function codexModelDefaultsForUseCase(useCase: string | null | undefined): CodexModelDefaults {
  if (useCase === "strong" || useCase === "middle" || useCase === "weaker") {
    return CODEX_MODEL_DEFAULTS_BY_USE_CASE[useCase];
  }
  return CODEX_MODEL_DEFAULTS_BY_USE_CASE.middle;
}

export function codexModelDefaultsForRole(role: string | null | undefined): CodexModelDefaults {
  const normalized = typeof role === "string" ? role.trim() : "";
  const useCase = CODEX_ROLE_USE_CASES[normalized as AgentRole] ?? "middle";
  return codexModelDefaultsForUseCase(useCase);
}
