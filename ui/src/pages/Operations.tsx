import { useEffect, useMemo } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Activity, Boxes, ShieldAlert, Zap, type LucideIcon } from "lucide-react";
import { activityApi, type AgentSkillCoverage, type AgentSkillUsageSummary } from "../api/activity";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, relativeTime } from "../lib/utils";

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "amber" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "green"
          ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300"
          : tone === "amber"
            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function groupAgentSkills(rows: AgentSkillUsageSummary[]) {
  const grouped = new Map<string, { agentId: string; agentName: string; activationCount: number; runCount: number; lastActivatedAt: string; skills: AgentSkillUsageSummary[] }>();
  for (const row of rows) {
    const current = grouped.get(row.agentId) ?? {
      agentId: row.agentId,
      agentName: row.agentName,
      activationCount: 0,
      runCount: 0,
      lastActivatedAt: row.lastActivatedAt,
      skills: [],
    };
    current.activationCount += row.activationCount;
    current.runCount += row.runCount;
    if (new Date(row.lastActivatedAt).getTime() > new Date(current.lastActivatedAt).getTime()) {
      current.lastActivatedAt = row.lastActivatedAt;
    }
    current.skills.push(row);
    grouped.set(row.agentId, current);
  }
  return [...grouped.values()].sort((a, b) => new Date(b.lastActivatedAt).getTime() - new Date(a.lastActivatedAt).getTime());
}

function suppressionRemaining(value: string) {
  const seconds = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 1000));
  if (seconds < 60) return `${seconds}s remaining`;
  return `${Math.ceil(seconds / 60)}m remaining`;
}

function skillListLabel(values: string[], max = 3) {
  if (values.length === 0) return "None";
  const shown = values.slice(0, max).join(", ");
  return values.length > max ? `${shown}, +${values.length - max}` : shown;
}

function coverageTone(row: AgentSkillCoverage): "neutral" | "green" | "amber" {
  if (!row.adapterSupportsActivationTelemetry || row.missingDesiredSkills || !row.runtimeSynced) return "amber";
  if (row.neverUsedCount === 0) return "green";
  return "neutral";
}

export function Operations() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Operations" }]);
  }, [setBreadcrumbs]);

  const skillUsage = useQuery({
    queryKey: selectedCompanyId ? queryKeys.skillUsage(selectedCompanyId) : ["skill-usage", "none"],
    queryFn: () => activityApi.skillUsage(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const skillUsageByAgent = useQuery({
    queryKey: selectedCompanyId ? queryKeys.skillUsageByAgent(selectedCompanyId) : ["skill-usage", "agents", "none"],
    queryFn: () => activityApi.skillUsageByAgent(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const skillCoverage = useQuery({
    queryKey: selectedCompanyId ? queryKeys.skillCoverage(selectedCompanyId) : ["skill-coverage", "none"],
    queryFn: () => activityApi.skillCoverage(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const recoveryDismissals = useQuery({
    queryKey: selectedCompanyId ? queryKeys.recoveryDismissals(selectedCompanyId) : ["recovery-dismissals", "none"],
    queryFn: () => activityApi.recoveryDismissals(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const wakeSuppressions = useQuery({
    queryKey: selectedCompanyId ? queryKeys.wakeSuppressions(selectedCompanyId) : ["wake-suppressions", "none"],
    queryFn: () => activityApi.wakeSuppressions(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });

  const agentSkillGroups = useMemo(
    () => groupAgentSkills(skillUsageByAgent.data ?? []),
    [skillUsageByAgent.data],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={Activity} message="Select a company to view operations." />;
  }

  if (skillUsage.isLoading || skillUsageByAgent.isLoading || skillCoverage.isLoading || recoveryDismissals.isLoading || wakeSuppressions.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const firstError = skillUsage.error ?? skillUsageByAgent.error ?? skillCoverage.error ?? recoveryDismissals.error ?? wakeSuppressions.error;
  const coverageRows = [...(skillCoverage.data ?? [])].sort(
    (a, b) =>
      Number(b.missingDesiredSkills) - Number(a.missingDesiredSkills) ||
      Number(!b.adapterSupportsActivationTelemetry) - Number(!a.adapterSupportsActivationTelemetry) ||
      b.neverUsedCount - a.neverUsedCount ||
      a.agentName.localeCompare(b.agentName),
  );

  return (
    <div className="space-y-6">
      {firstError ? <p className="text-sm text-destructive">{firstError.message}</p> : null}

      <section className="space-y-3">
        <SectionHeader
          icon={Boxes}
          title="Skill Coverage"
          subtitle="Compares configured skills, runtime sync support, and structured Skill tool activations from the last 7 days."
        />
        {coverageRows.length === 0 ? (
          <EmptyState icon={Boxes} message="No active agents found for skill coverage." />
        ) : (
          <div className="overflow-x-auto border border-border">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Agent</th>
                  <th className="px-3 py-2 text-left font-medium">Desired Skills</th>
                  <th className="px-3 py-2 text-left font-medium">Runtime Synced</th>
                  <th className="px-3 py-2 text-left font-medium">Activated Last 7d</th>
                  <th className="px-3 py-2 text-left font-medium">Never Used</th>
                  <th className="px-3 py-2 text-left font-medium">Adapter Supports Activation Telemetry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {coverageRows.map((row) => (
                  <tr key={row.agentId} className="align-top">
                    <td className="px-3 py-3">
                      <Link to={`/agents/${row.agentId}/skills`} className="font-medium hover:underline">
                        {row.agentName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{row.adapterType} · {row.status}</p>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill tone={row.missingDesiredSkills ? "amber" : "neutral"}>
                        {row.desiredSkillCount}
                      </StatusPill>
                      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{skillListLabel(row.desiredSkills)}</p>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill tone={row.runtimeSynced ? "green" : "amber"}>
                        {row.runtimeSynced ? "Yes" : row.adapterSupportsSkillSync ? "No desired skills" : "Unsupported"}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-3">
                      <Link to={`/agents/${row.agentId}/skill-activations`} className="hover:underline">
                        {row.activatedLast7dCount}
                      </Link>
                      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                        {skillListLabel(row.activatedLast7d.map((skill) => `${skill.skillName} (${skill.activationCount})`), 2)}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill tone={coverageTone(row)}>{row.neverUsedCount}</StatusPill>
                      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{skillListLabel(row.neverUsedSkills)}</p>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill tone={row.adapterSupportsActivationTelemetry ? "green" : "amber"}>
                        {row.adapterSupportsActivationTelemetry ? "Yes" : "No"}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader
          icon={Boxes}
          title="Skills Activated Per Agent"
          subtitle="Aggregates recorded SkillUse events by agent and skill."
        />
        {agentSkillGroups.length === 0 ? (
          <EmptyState icon={Boxes} message="No skill activation events have been recorded yet." />
        ) : (
          <div className="border border-border divide-y divide-border">
            {agentSkillGroups.map((agent) => (
              <div key={agent.agentId} className="grid gap-3 p-3 md:grid-cols-[minmax(180px,240px)_1fr_auto] md:items-start">
                <div className="min-w-0">
                  <Link to={`/agents/${agent.agentId}/skill-activations`} className="text-sm font-medium hover:underline">
                    {agent.agentName}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {agent.activationCount} activations across {agent.runCount} runs
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {agent.skills.slice(0, 8).map((skill) => (
                    <StatusPill key={`${skill.agentId}:${skill.skillKey}`}>
                      {skill.skillName} · {skill.activationCount}
                    </StatusPill>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground md:text-right">
                  {relativeTime(agent.lastActivatedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader
          icon={Activity}
          title="Skill Usage Outcomes"
          subtitle="Company-wide skill usage by resulting issue state."
        />
        {(skillUsage.data ?? []).length === 0 ? (
          <EmptyState icon={Activity} message="No skill outcome data yet." />
        ) : (
          <div className="border border-border divide-y divide-border">
            {(skillUsage.data ?? []).map((skill) => (
              <div key={skill.skillKey} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{skill.skillName}</p>
                  <p className="truncate text-xs text-muted-foreground">{skill.skillKey}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:justify-end">
                  <StatusPill>{skill.runCount} runs</StatusPill>
                  <StatusPill tone="green">{skill.doneCount} done</StatusPill>
                  <StatusPill tone="amber">{skill.blockedCount} blocked</StatusPill>
                  <StatusPill>{skill.cancelledCount} cancelled</StatusPill>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader
          icon={ShieldAlert}
          title="Recovery Dismissals"
          subtitle="Cancelled stranded-recovery markers that keep recovery issues from being recreated."
        />
        {(recoveryDismissals.data ?? []).length === 0 ? (
          <EmptyState icon={ShieldAlert} message="No recovery dismissals are currently recorded." />
        ) : (
          <div className="border border-border divide-y divide-border">
            {(recoveryDismissals.data ?? []).map((dismissal) => (
              <div key={dismissal.issueId} className="grid gap-2 p-3 lg:grid-cols-[1fr_minmax(220px,320px)_auto] lg:items-start">
                <div className="min-w-0">
                  <Link to={`/issues/${dismissal.identifier ?? dismissal.issueId}`} className="text-sm font-medium hover:underline">
                    {dismissal.identifier ?? dismissal.issueId.slice(0, 8)} · {dismissal.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Cancelled {relativeTime(dismissal.cancelledAt ?? dismissal.updatedAt)}
                    {dismissal.cancelledByKind ? ` by ${dismissal.cancelledByKind}` : ""}
                  </p>
                </div>
                <div className="min-w-0 text-xs text-muted-foreground">
                  {dismissal.sourceIssue ? (
                    <Link to={`/issues/${dismissal.sourceIssue.identifier ?? dismissal.sourceIssue.id}`} className="hover:underline">
                      Source: {dismissal.sourceIssue.identifier ?? dismissal.sourceIssue.id.slice(0, 8)} · {dismissal.sourceIssue.title}
                    </Link>
                  ) : (
                    "Source issue not found"
                  )}
                </div>
                <span className="text-xs text-muted-foreground lg:text-right">
                  {dismissal.assigneeAgentName ?? "Unassigned"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader
          icon={Zap}
          title="Wake-Storm Dampener"
          subtitle="Active issue wake suppression windows created after recovery cleanup."
        />
        {(wakeSuppressions.data ?? []).length === 0 ? (
          <EmptyState icon={Zap} message="No active issue wake suppression windows." />
        ) : (
          <div className="border border-border divide-y divide-border">
            {(wakeSuppressions.data ?? []).map((suppression) => (
              <div key={suppression.agentId} className="grid gap-2 p-3 md:grid-cols-[1fr_auto] md:items-center">
                <div className="min-w-0">
                  <Link to={`/agents/${suppression.agentId}/skill-activations`} className="text-sm font-medium hover:underline">
                    {suppression.agentName ?? suppression.agentId.slice(0, 8)}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {suppression.dismissalCount} recovery dismissals, latest {relativeTime(suppression.latestDismissedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 md:justify-end">
                  <StatusPill tone="amber">{suppression.suppressedWakeReasonPrefix} wakes suppressed</StatusPill>
                  <StatusPill>{suppressionRemaining(suppression.suppressUntil)}</StatusPill>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
