import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { agentsApi } from "../api/agents";
import { companySkillsApi } from "../api/companySkills";
import { queryKeys } from "../lib/queryKeys";
import { AGENT_ROLES, type AdapterEnvironmentTestResult } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Shield } from "lucide-react";
import { cn, agentUrl } from "../lib/utils";
import { roleLabels } from "../components/agent-config-primitives";
import {
  AgentConfigForm,
  AdapterEnvironmentResult,
  type CreateConfigValues,
} from "../components/AgentConfigForm";
import { defaultCreateValues } from "../components/agent-config-defaults";
import { getUIAdapter, listUIAdapters } from "../adapters";
import { useDisabledAdaptersSync } from "../adapters/use-disabled-adapters";
import { isValidAdapterType } from "../adapters/metadata";
import { ReportsToPicker } from "../components/ReportsToPicker";
import { buildNewAgentHirePayload } from "../lib/new-agent-hire-payload";
import {
  agentModelProfileDefaultsForRole,
  minimaxCurrentAdapterFallbackDefaults,
  shouldDefaultNewAgentToMiniMax,
} from "../lib/agent-model-profile-defaults";
import {
  CODEX_LOCAL_ROLE_DEFAULT_PRIMARY_MODELS,
  codexModelDefaultsForRole,
} from "../lib/codex-agent-model-defaults";
import {
  DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
  DEFAULT_CODEX_LOCAL_MODEL,
} from "@paperclipai/adapter-codex-local";
import { DEFAULT_CURSOR_LOCAL_MODEL } from "@paperclipai/adapter-cursor-local";
import { DEFAULT_GEMINI_LOCAL_MODEL } from "@paperclipai/adapter-gemini-local";
import { DEFAULT_KIMI_LOCAL_MODEL } from "@paperclipai/adapter-kimi-local";
import {
  DEFAULT_MINIMAX_LOCAL_MODEL,
} from "@paperclipai/adapter-minimax-local";
import { DEFAULT_OPENCODE_LOCAL_MODEL, isValidOpenCodeModelId } from "@paperclipai/adapter-opencode-local";
import {
  DEFAULT_ZAI_LOCAL_CHEAP_MODEL,
  DEFAULT_ZAI_LOCAL_MODEL,
} from "@paperclipai/adapter-zai-local";
import {
  DEFAULT_COPILOT_LOCAL_CHEAP_MODEL,
  DEFAULT_COPILOT_SDK_MODEL,
} from "@paperclipai/adapter-copilot-local";

function applyProfileDefaults(
  values: CreateConfigValues,
  role?: string,
) {
  const defaults = agentModelProfileDefaultsForRole(role);
  values.cheapModel = defaults.cheap.model;
  values.cheapModelEnabled = true;
  values.cheapModelAdapterType = defaults.cheap.adapterType;
  values.cheapModelCommand = defaults.cheap.command;
  values.cheapModelProvider = defaults.cheap.provider ?? "";
  values.cheapModelReasoningEffort = defaults.cheap.reasoningEffort ?? "";
  values.fallbackModel = defaults.fallback.model;
  values.fallbackModelEnabled = true;
  values.fallbackModelAdapterType = defaults.fallback.adapterType;
  values.fallbackModelCommand = defaults.fallback.command;
  values.fallbackModelProvider = defaults.fallback.provider ?? "";
  values.fallbackModelReasoningEffort = defaults.fallback.reasoningEffort ?? "";
}

function applyFallbackProfileDefaults(
  values: CreateConfigValues,
  role?: string,
) {
  const defaults = agentModelProfileDefaultsForRole(role);
  values.fallbackModel = defaults.fallback.model;
  values.fallbackModelEnabled = true;
  values.fallbackModelAdapterType = defaults.fallback.adapterType;
  values.fallbackModelCommand = defaults.fallback.command;
  values.fallbackModelProvider = defaults.fallback.provider ?? "";
  values.fallbackModelReasoningEffort = defaults.fallback.reasoningEffort ?? "";
}

function createValuesForAdapterType(
  adapterType: CreateConfigValues["adapterType"],
  role?: string,
): CreateConfigValues {
  const { adapterType: _discard, ...defaults } = defaultCreateValues;
  const nextValues: CreateConfigValues = { ...defaults, adapterType };
  if (adapterType === "codex_local") {
    const codexDefaults = codexModelDefaultsForRole(role);
    nextValues.model = codexDefaults.primaryModel;
    nextValues.cheapModel = codexDefaults.fallbackModel;
    nextValues.cheapModelEnabled = true;
    nextValues.cheapModelAdapterType = codexDefaults.fallbackAdapterType;
    nextValues.cheapModelCommand = codexDefaults.fallbackCommand;
    nextValues.cheapModelProvider = codexDefaults.fallbackProvider;
    nextValues.cheapModelReasoningEffort = codexDefaults.fallbackReasoningEffort;
    nextValues.fallbackModel = codexDefaults.fallbackModel;
    nextValues.fallbackModelEnabled = true;
    nextValues.fallbackModelAdapterType = codexDefaults.fallbackAdapterType;
    nextValues.fallbackModelCommand = codexDefaults.fallbackCommand;
    nextValues.fallbackModelProvider = codexDefaults.fallbackProvider;
    nextValues.fallbackModelReasoningEffort = codexDefaults.fallbackReasoningEffort;
    nextValues.dangerouslyBypassSandbox =
      DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX;
  } else if (adapterType === "gemini_local") {
    nextValues.model = DEFAULT_GEMINI_LOCAL_MODEL;
    applyProfileDefaults(nextValues, role);
  } else if (adapterType === "kimi_local") {
    nextValues.model = DEFAULT_KIMI_LOCAL_MODEL;
    applyProfileDefaults(nextValues, role);
  } else if (adapterType === "minimax_local") {
    nextValues.model = DEFAULT_MINIMAX_LOCAL_MODEL;
    Object.assign(nextValues, minimaxCurrentAdapterFallbackDefaults());
  } else if (adapterType === "zai_local") {
    nextValues.model = DEFAULT_ZAI_LOCAL_MODEL;
    nextValues.cheapModel = DEFAULT_ZAI_LOCAL_CHEAP_MODEL;
    nextValues.cheapModelEnabled = true;
    nextValues.cheapModelAdapterType = "";
    nextValues.cheapModelCommand = "";
    nextValues.cheapModelProvider = "";
    nextValues.cheapModelReasoningEffort = "";
    applyFallbackProfileDefaults(nextValues, role);
  } else if (adapterType === "copilot_local") {
    nextValues.model = DEFAULT_COPILOT_SDK_MODEL;
    nextValues.cheapModel = DEFAULT_COPILOT_LOCAL_CHEAP_MODEL;
    nextValues.cheapModelEnabled = true;
    nextValues.cheapModelAdapterType = "";
    nextValues.cheapModelCommand = "";
    nextValues.cheapModelProvider = "";
    nextValues.cheapModelReasoningEffort = "";
    applyFallbackProfileDefaults(nextValues, role);
  } else if (adapterType === "cursor") {
    nextValues.model = DEFAULT_CURSOR_LOCAL_MODEL;
    applyProfileDefaults(nextValues, role);
  } else if (adapterType === "opencode_local") {
    nextValues.model = DEFAULT_OPENCODE_LOCAL_MODEL;
    applyProfileDefaults(nextValues, role);
  }
  return nextValues;
}

export function NewAgent() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetAdapterType = searchParams.get("adapterType");

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState("general");
  const [reportsTo, setReportsTo] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<CreateConfigValues>(defaultCreateValues);
  const [selectedSkillKeys, setSelectedSkillKeys] = useState<string[]>([]);
  const [hasInitializedSkillSelection, setHasInitializedSkillSelection] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testAgentAction, setTestAgentAction] = useState<(() => void) | null>(null);
  const [testAgentState, setTestAgentState] = useState({ disabled: true, pending: false });
  const [testAgentFeedback, setTestAgentFeedback] = useState<{
    errorMessage: string | null;
    result: AdapterEnvironmentTestResult | null;
  }>({
    errorMessage: null,
    result: null,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: companySkills } = useQuery({
    queryKey: queryKeys.companySkills.list(selectedCompanyId ?? ""),
    queryFn: () => companySkillsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const isFirstAgent = !agents || agents.length === 0;
  const effectiveRole = isFirstAgent ? "ceo" : role;
  const availableSkills = useMemo(
    () => (companySkills ?? []).filter((skill) => !skill.key.startsWith("paperclipai/paperclip/")),
    [companySkills],
  );

  useEffect(() => {
    setBreadcrumbs([
      { label: "Agents", href: "/agents" },
      { label: "New Agent" },
    ]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (isFirstAgent) {
      if (!name) setName("CEO");
      if (!title) setTitle("CEO");
    }
  }, [isFirstAgent]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const requested = presetAdapterType;
    if (!requested) return;
    if (!isValidAdapterType(requested)) return;
    setConfigValues((prev) => {
      if (prev.adapterType === requested) return prev;
      return createValuesForAdapterType(requested as CreateConfigValues["adapterType"], effectiveRole);
    });
  }, [presetAdapterType, effectiveRole]);

  useEffect(() => {
    if (presetAdapterType) return;
    if (!shouldDefaultNewAgentToMiniMax({ role: effectiveRole, name, title, isFirstAgent })) return;
    setConfigValues((prev) => {
      if (prev.adapterType !== defaultCreateValues.adapterType) return prev;
      return createValuesForAdapterType("minimax_local", effectiveRole);
    });
  }, [effectiveRole, isFirstAgent, name, presetAdapterType, title]);

  useEffect(() => {
    if (configValues.adapterType !== "codex_local") return;
    const codexDefaults = codexModelDefaultsForRole(effectiveRole);
    setConfigValues((prev) => {
      if (prev.adapterType !== "codex_local") return prev;
      const currentModel = prev.model || DEFAULT_CODEX_LOCAL_MODEL;
      const canUpdatePrimary = CODEX_LOCAL_ROLE_DEFAULT_PRIMARY_MODELS.includes(currentModel);
      if (
        (!canUpdatePrimary || currentModel === codexDefaults.primaryModel) &&
        prev.cheapModel === codexDefaults.fallbackModel &&
        prev.cheapModelEnabled === true &&
        prev.cheapModelAdapterType === codexDefaults.fallbackAdapterType &&
        prev.cheapModelCommand === codexDefaults.fallbackCommand &&
        prev.cheapModelProvider === codexDefaults.fallbackProvider &&
        prev.cheapModelReasoningEffort === codexDefaults.fallbackReasoningEffort &&
        prev.fallbackModel === codexDefaults.fallbackModel &&
        prev.fallbackModelEnabled === true &&
        prev.fallbackModelAdapterType === codexDefaults.fallbackAdapterType &&
        prev.fallbackModelCommand === codexDefaults.fallbackCommand &&
        prev.fallbackModelProvider === codexDefaults.fallbackProvider &&
        prev.fallbackModelReasoningEffort === codexDefaults.fallbackReasoningEffort
      ) {
        return prev;
      }
      return {
        ...prev,
        ...(canUpdatePrimary ? { model: codexDefaults.primaryModel } : {}),
        cheapModel: codexDefaults.fallbackModel,
        cheapModelEnabled: true,
        cheapModelAdapterType: codexDefaults.fallbackAdapterType,
        cheapModelCommand: codexDefaults.fallbackCommand,
        cheapModelProvider: codexDefaults.fallbackProvider,
        cheapModelReasoningEffort: codexDefaults.fallbackReasoningEffort,
        fallbackModel: codexDefaults.fallbackModel,
        fallbackModelEnabled: true,
        fallbackModelAdapterType: codexDefaults.fallbackAdapterType,
        fallbackModelCommand: codexDefaults.fallbackCommand,
        fallbackModelProvider: codexDefaults.fallbackProvider,
        fallbackModelReasoningEffort: codexDefaults.fallbackReasoningEffort,
      };
    });
  }, [configValues.adapterType, effectiveRole]);

  useEffect(() => {
    if (hasInitializedSkillSelection || !companySkills) return;
    setSelectedSkillKeys(availableSkills.map((skill) => skill.key));
    setHasInitializedSkillSelection(true);
  }, [availableSkills, companySkills, hasInitializedSkillSelection]);

  const createAgent = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      agentsApi.hire(selectedCompanyId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
      navigate(agentUrl(result.agent));
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : "Failed to create agent");
    },
  });

  function buildAdapterConfig() {
    const adapter = getUIAdapter(configValues.adapterType);
    return adapter.buildAdapterConfig(configValues);
  }

  function handleSubmit() {
    if (!selectedCompanyId || !name.trim()) return;
    setFormError(null);
    if (configValues.adapterType === "opencode_local") {
      if (!isValidOpenCodeModelId(configValues.model)) {
        setFormError("OpenCode requires an explicit model in provider/model format.");
        return;
      }
    }
    createAgent.mutate(
      buildNewAgentHirePayload({
        name,
        effectiveRole,
        title,
        reportsTo,
        selectedSkillKeys,
        configValues,
        adapterConfig: buildAdapterConfig(),
      }),
    );
  }

  function toggleSkill(key: string, checked: boolean) {
    setSelectedSkillKeys((prev) => {
      if (checked) {
        return prev.includes(key) ? prev : [...prev, key];
      }
      return prev.filter((value) => value !== key);
    });
  }

  const handleTestAgentActionChange = useCallback((fn: (() => void) | null) => {
    setTestAgentAction(() => fn);
  }, []);

  const handleTestAgentStateChange = useCallback((state: { disabled: boolean; pending: boolean }) => {
    setTestAgentState(state);
  }, []);

  const handleTestAgentFeedbackChange = useCallback((feedback: {
    errorMessage: string | null;
    result: AdapterEnvironmentTestResult | null;
  }) => {
    setTestAgentFeedback(feedback);
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">New Agent</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Advanced agent configuration
        </p>
      </div>

      <div className="border border-border">
        {/* Name */}
        <div className="px-4 pt-4 pb-2">
          <input
            className="w-full text-lg font-semibold bg-transparent outline-none placeholder:text-muted-foreground/50"
            placeholder="Agent name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        {/* Title */}
        <div className="px-4 pb-2">
          <input
            className="w-full bg-transparent outline-none text-sm text-muted-foreground placeholder:text-muted-foreground/40"
            placeholder="Title (e.g. VP of Engineering)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Property chips: Role + Reports To */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-t border-border flex-wrap">
          <Popover open={roleOpen} onOpenChange={setRoleOpen}>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors",
                  isFirstAgent && "opacity-60 cursor-not-allowed"
                )}
                disabled={isFirstAgent}
              >
                <Shield className="h-3 w-3 text-muted-foreground" />
                {roleLabels[effectiveRole] ?? effectiveRole}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-36 p-1" align="start">
              {AGENT_ROLES.map((r) => (
                <button
                  key={r}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                    r === role && "bg-accent"
                  )}
                  onClick={() => { setRole(r); setRoleOpen(false); }}
                >
                  {roleLabels[r] ?? r}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <ReportsToPicker
            agents={agents ?? []}
            value={reportsTo}
            onChange={setReportsTo}
            disabled={isFirstAgent}
          />
        </div>

        {/* Shared config form */}
        <AgentConfigForm
          mode="create"
          values={configValues}
          onChange={(patch) => setConfigValues((prev) => {
            if (patch.adapterType && patch.adapterType !== prev.adapterType) {
              return createValuesForAdapterType(patch.adapterType, effectiveRole);
            }
            return { ...prev, ...patch };
          })}
          onTestActionChange={handleTestAgentActionChange}
          onTestActionStateChange={handleTestAgentStateChange}
          onTestFeedbackChange={handleTestAgentFeedbackChange}
        />

        <div className="border-t border-border px-4 py-4">
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-medium">Company skills</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Company library skills are selected by default. Built-in Paperclip runtime skills are added automatically.
              </p>
            </div>
            {availableSkills.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No optional company skills installed yet.
              </p>
            ) : (
              <div className="space-y-3">
                {availableSkills.map((skill) => {
                  const inputId = `skill-${skill.id}`;
                  const checked = selectedSkillKeys.includes(skill.key);
                  return (
                    <div key={skill.id} className="flex items-start gap-3">
                      <Checkbox
                        id={inputId}
                        checked={checked}
                        onCheckedChange={(next) => toggleSkill(skill.key, next === true)}
                      />
                      <label htmlFor={inputId} className="grid gap-1 leading-none">
                        <span className="text-sm font-medium">{skill.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {skill.description ?? skill.key}
                        </span>
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-3">
          {isFirstAgent && (
            <p className="text-xs text-muted-foreground mb-2">This will be the CEO</p>
          )}
          {formError && (
            <p className="text-xs text-destructive mb-2">{formError}</p>
          )}
          <div className="space-y-3">
            {testAgentFeedback.errorMessage && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {testAgentFeedback.errorMessage}
              </div>
            )}
            {testAgentFeedback.result && (
              <AdapterEnvironmentResult result={testAgentFeedback.result} />
            )}
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate("/agents")}>
                Cancel
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testAgentState.disabled}
                  onClick={() => testAgentAction?.()}
                >
                  {testAgentState.pending ? "Testing..." : "Test Agent"}
                </Button>
                <Button
                  size="sm"
                  disabled={!name.trim() || createAgent.isPending}
                  onClick={handleSubmit}
                >
                  {createAgent.isPending ? "Creating…" : "Create agent"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
