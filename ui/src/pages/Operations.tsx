import { useEffect, useMemo } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Activity, Boxes, ShieldAlert, Zap, type LucideIcon } from "lucide-react";
import { activityApi, type AgentSkillUsageSummary } from "../api/activity";
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

  if (skillUsage.isLoading || skillUsageByAgent.isLoading || recoveryDismissals.isLoading || wakeSuppressions.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const firstError = skillUsage.error ?? skillUsageByAgent.error ?? recoveryDismissals.error ?? wakeSuppressions.error;

  return (
    <div className="space-y-6">
      {firstError ? <p className="text-sm text-destructive">{firstError.message}</p> : null}

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
