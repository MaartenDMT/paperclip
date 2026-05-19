import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, ProviderQuotaResult, QuotaWindow } from "@paperclipai/shared";
import { AlertTriangle, Gauge, RefreshCw, Users } from "lucide-react";
import { agentsApi } from "../api/agents";
import { costsApi } from "../api/costs";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { QuotaBar } from "../components/QuotaBar";
import { StatusBadge } from "../components/StatusBadge";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, providerDisplayName } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const NO_COMPANY = "__none__";

function providerForAdapter(agent: Agent): string {
  switch (agent.adapterType) {
    case "claude_local":
      return "anthropic";
    case "codex_local":
      return "openai";
    case "copilot_local":
      return "github-copilot";
    case "gemini_local":
      return "google";
    case "kimi_local":
      return "moonshot";
    case "minimax_local":
      return "minimax";
    case "opencode_local":
      return "opencode";
    case "cursor":
    case "cursor_cloud":
      return "cursor";
    case "acpx_local":
      return "acpx";
    case "pi_local":
      return "pi";
    case "hermes_local":
      return "hermes";
    default:
      return agent.adapterType.replace(/_local$/, "");
  }
}

function modelForAgent(agent: Agent): string {
  const config = agent.adapterConfig as Record<string, unknown> | null | undefined;
  const model = config?.model;
  return typeof model === "string" && model.trim().length > 0 ? model.trim() : "default";
}

function quotaSeverity(window: QuotaWindow): "ok" | "warn" | "danger" | "unknown" {
  if (window.usedPercent == null) return "unknown";
  if (window.usedPercent >= 90) return "danger";
  if (window.usedPercent >= 70) return "warn";
  return "ok";
}

function resetLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function agentRowsForProvider(agents: Agent[], provider: string): Agent[] {
  return agents
    .filter((agent) => agent.status !== "terminated" && providerForAdapter(agent) === provider)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function ProviderQuotaWindowList({ windows }: { windows: QuotaWindow[] }) {
  if (windows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No live quota windows reported for this provider.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {windows.map((window) => {
        const severity = quotaSeverity(window);
        const used = window.usedPercent ?? 0;
        const reset = resetLabel(window.resetsAt);
        return (
          <div
            key={`${window.label}:${window.resetsAt ?? "none"}`}
            className={cn(
              "border border-border p-3",
              severity === "danger" && "border-red-500/60 bg-red-500/5",
              severity === "warn" && "border-yellow-500/60 bg-yellow-500/5",
            )}
          >
            <QuotaBar
              label={window.label}
              percentUsed={used}
              leftLabel={window.valueLabel ?? (window.usedPercent == null ? "not reported" : `${window.usedPercent}% used`)}
              rightLabel={window.usedPercent == null ? undefined : `${Math.max(0, 100 - window.usedPercent)}% available`}
              showDeficitNotch={severity === "danger"}
            />
            {(window.detail || reset) && (
              <p className="mt-2 text-xs text-muted-foreground">
                {window.detail}
                {window.detail && reset ? " · " : ""}
                {reset ? `resets ${reset}` : ""}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AgentProviderTable({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active agents are assigned to this provider.
      </p>
    );
  }

  return (
    <div className="overflow-hidden border border-border">
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_auto] gap-3 border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground">
        <span>Agent</span>
        <span>Adapter</span>
        <span>Model</span>
        <span>Status</span>
      </div>
      <div className="divide-y divide-border">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-sm"
          >
            <span className="truncate font-medium">{agent.name}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{agent.adapterType}</span>
            <span className="truncate font-mono text-xs">{modelForAgent(agent)}</span>
            <StatusBadge status={agent.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function quotaSourceLabel(result: ProviderQuotaResult | undefined): string {
  if (!result) return "No quota source";
  if (!result.ok) return "Quota unavailable";
  return result.source ?? "Provider API";
}

export function ProviderQuotas() {
  const queryClient = useQueryClient();
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId ?? NO_COMPANY;
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Company", href: "/dashboard" },
      { label: "Provider quotas" },
    ]);
  }, [setBreadcrumbs]);

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!selectedCompanyId,
    staleTime: 10_000,
  });

  const quotaQuery = useQuery({
    queryKey: queryKeys.usageQuotaWindows(companyId),
    queryFn: () => costsApi.quotaWindows(companyId),
    enabled: !!selectedCompanyId,
    refetchInterval: 300_000,
    staleTime: 60_000,
  });

  const agents = agentsQuery.data ?? [];
  const quotaResults = quotaQuery.data ?? [];
  const quotaByProvider = useMemo(
    () => new Map(quotaResults.map((result) => [result.provider, result])),
    [quotaResults],
  );

  const providers = useMemo(() => {
    const keys = new Set<string>();
    for (const result of quotaResults) keys.add(result.provider);
    for (const agent of agents) {
      if (agent.status !== "terminated") keys.add(providerForAdapter(agent));
    }
    return Array.from(keys).sort((a, b) => providerDisplayName(a).localeCompare(providerDisplayName(b)));
  }, [agents, quotaResults]);

  const agentCount = agents.filter((agent) => agent.status !== "terminated").length;
  const quotaWindowCount = quotaResults.reduce((sum, result) => sum + result.windows.length, 0);
  const constrainedCount = quotaResults.reduce(
    (sum, result) =>
      sum + result.windows.filter((window) => window.usedPercent != null && window.usedPercent >= 70).length,
    0,
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={Gauge} message="Select a company to inspect provider quotas." />;
  }

  if (agentsQuery.isLoading || quotaQuery.isLoading) {
    return <PageSkeleton variant="costs" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Provider Quotas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live provider quota windows and the agents currently assigned to each provider.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.usageQuotaWindows(companyId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
          }}
          disabled={quotaQuery.isFetching || agentsQuery.isFetching}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", (quotaQuery.isFetching || agentsQuery.isFetching) && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Providers</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Gauge className="h-5 w-5 text-muted-foreground" />
              {providers.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {quotaWindowCount} quota windows reported
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active agents</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Users className="h-5 w-5 text-muted-foreground" />
              {agentCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Grouped by provider and adapter
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Constrained windows</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              {constrainedCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Windows at or above 70% used
          </CardContent>
        </Card>
      </div>

      {quotaQuery.isError ? (
        <Card className="border-destructive/60">
          <CardContent className="py-4 text-sm text-destructive">
            Failed to load provider quota windows.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {providers.map((provider) => {
          const result = quotaByProvider.get(provider);
          const providerAgents = agentRowsForProvider(agents, provider);
          return (
            <Card key={provider}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{providerDisplayName(provider)}</CardTitle>
                    <CardDescription className="mt-1">
                      {quotaSourceLabel(result)} · {providerAgents.length} active agent{providerAgents.length === 1 ? "" : "s"}
                    </CardDescription>
                  </div>
                  {result && !result.ok ? (
                    <span className="shrink-0 text-xs text-destructive">unavailable</span>
                  ) : result?.source ? (
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      {result.source}
                    </span>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {result && !result.ok && result.error ? (
                  <p className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {result.error}
                  </p>
                ) : null}
                <ProviderQuotaWindowList windows={result?.ok ? result.windows : []} />
                <div className="border-t border-border pt-4">
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Agents using {providerDisplayName(provider)}
                  </h2>
                  <AgentProviderTable agents={providerAgents} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {providers.length === 0 ? (
        <EmptyState
          icon={Gauge}
          message="Provider quota sources and active agents will appear here after adapters are configured."
        />
      ) : null}
    </div>
  );
}
