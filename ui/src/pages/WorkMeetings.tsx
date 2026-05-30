import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { CheckCircle2, CircleAlert, ListFilter, MessagesSquare, Plus, X } from "lucide-react";
import type { MeetingWorkflowHealth, WorkMeetingSummary } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { EmptyState } from "../components/EmptyState";
import { MarkdownBody } from "../components/MarkdownBody";
import { PageSkeleton } from "../components/PageSkeleton";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { timeAgo } from "../lib/timeAgo";

const EXPECTED_OUTPUTS = [
  "goals",
  "targets",
  "kpis",
  "finance",
  "business_requirements",
  "agent_performance",
  "problems",
  "optimization",
  "right_track",
  "workflow_corrections",
  "memory_corrections",
  "idea_sharing",
  "workflows",
  "process",
  "decisions",
  "tasks",
  "blockers",
  "questions",
  "plan_update",
] as const;

function formatOutput(value: string) {
  if (value === "kpis") return "KPIs";
  return value.replace(/_/g, " ");
}

function statusClasses(status: string) {
  if (status === "answered" || status === "accepted") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "pending") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "cancelled" || status === "rejected" || status === "expired") return "border-muted bg-muted text-muted-foreground";
  return "border-border bg-muted text-muted-foreground";
}

function issueHref(meeting: WorkMeetingSummary) {
  const target = meeting.issueIdentifier ?? meeting.issueId;
  return target ? `/issues/${target}` : null;
}

function issueLabel(meeting: WorkMeetingSummary) {
  return meeting.issueIdentifier ?? (meeting.issueId ? meeting.issueId.slice(0, 8) : "company");
}

function hasStalePendingMeeting(meeting: WorkMeetingSummary) {
  return meeting.status === "pending" && (meeting.pendingAgeHours ?? 0) >= 24;
}

function severityClasses(severity: string) {
  if (severity === "urgent") return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  if (severity === "warning") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
}

export function WorkMeetings() {
  const { selectedCompanyId, companies } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [outputFilter, setOutputFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"meetings" | "gaps" | "rules">("meetings");
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Work Meetings" }]);
  }, [setBreadcrumbs]);

  const filters = {
    limit: 100,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(agentFilter ? { agentId: agentFilter } : {}),
    ...(outputFilter ? { expectedOutput: outputFilter } : {}),
    ...(query.trim() ? { q: query.trim() } : {}),
  };

  const { data: meetings, isLoading, error } = useQuery({
    queryKey: selectedCompanyId ? [...queryKeys.issues.workMeetings(selectedCompanyId), filters] : ["issues", "work-meetings", "none"],
    queryFn: () => issuesApi.listWorkMeetings(selectedCompanyId!, filters),
    enabled: !!selectedCompanyId,
    refetchInterval: 30_000,
  });
  const { data: meetingHealth } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.issues.workMeetingHealth(selectedCompanyId) : ["issues", "work-meetings", "health", "none"],
    queryFn: () => issuesApi.getWorkMeetingHealth(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 60_000,
  });

  const selectedMeeting = useMemo(
    () => meetings?.find((meeting) => meeting.id === selectedMeetingId) ?? meetings?.[0] ?? null,
    [meetings, selectedMeetingId],
  );

  useEffect(() => {
    if (!detailOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailOpen]);
  const participantOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const meeting of meetings ?? []) {
      for (const participant of meeting.participants) {
        map.set(participant.id, { id: participant.id, name: participant.name });
      }
    }
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [meetings]);
  const stalePendingCount = meetings?.filter(hasStalePendingMeeting).length ?? 0;
  const unresolvedOutcomeCount = meetings?.reduce(
    (sum, meeting) => sum + meeting.unlinkedOutcomeItems,
    0,
  ) ?? 0;
  const pendingCount = meetings?.filter((meeting) => meeting.status === "pending").length ?? 0;
  const resolvedCount = meetings?.filter((meeting) => meeting.status === "answered" || meeting.status === "accepted").length ?? 0;

  const createActionItemIssue = useMutation({
    mutationFn: async ({ meeting, index }: { meeting: WorkMeetingSummary; index: number }) => {
      const item = meeting.result?.actionItems[index];
      if (!item || !selectedCompanyId) return null;
      const created = await issuesApi.create(selectedCompanyId, {
        title: item.title,
        description: [
          `Created from work meeting: ${meeting.title ?? meeting.purpose}`,
          "",
          meeting.issueId ? `Source issue: ${meeting.issueIdentifier ?? meeting.issueId}` : "Source: company meeting",
          "",
          meeting.result?.summaryMarkdown ?? "",
        ].join("\n"),
        parentId: meeting.issueId ?? null,
        projectId: meeting.projectId ?? null,
        goalId: meeting.goalId ?? null,
        assigneeAgentId: item.ownerAgentId ?? null,
        status: item.ownerAgentId ? "todo" : "backlog",
        priority: "medium",
      });
      await issuesApi.linkWorkMeetingOutcome(selectedCompanyId, meeting.id, {
        outcomeType: "action_item",
        index,
        issueId: created.id,
      });
      return created;
    },
    onSuccess: (issue) => {
      setActionMessage(issue ? `Created follow-up ${issue.identifier ?? issue.id.slice(0, 8)}.` : null);
      if (selectedCompanyId) queryClient.invalidateQueries({ queryKey: queryKeys.issues.workMeetings(selectedCompanyId) });
    },
  });

  const createBlockerIssue = useMutation({
    mutationFn: async ({ meeting, index }: { meeting: WorkMeetingSummary; index: number }) => {
      const blocker = meeting.result?.blockers[index];
      if (!blocker || !selectedCompanyId) return null;
      const created = await issuesApi.create(selectedCompanyId, {
        title: `Unblock: ${blocker.summary}`,
        description: [
          `Created from work meeting: ${meeting.title ?? meeting.purpose}`,
          "",
          meeting.issueId
            ? `This blocker was recorded against ${meeting.issueIdentifier ?? meeting.issueId}.`
            : "This blocker was recorded in a company meeting.",
          "",
          meeting.result?.summaryMarkdown ?? "",
        ].join("\n"),
        parentId: meeting.issueId ?? null,
        projectId: meeting.projectId ?? null,
        goalId: meeting.goalId ?? null,
        assigneeAgentId: blocker.ownerAgentId ?? null,
        status: blocker.ownerAgentId ? "todo" : "backlog",
        priority: "high",
      });
      if (meeting.issueId) {
        const sourceIssue = await issuesApi.get(meeting.issueId);
        const existingBlockers = sourceIssue.blockedBy?.map((item) => item.id) ?? [];
        await issuesApi.update(meeting.issueId, {
          blockedByIssueIds: [...new Set([...existingBlockers, created.id])],
        });
      }
      await issuesApi.linkWorkMeetingOutcome(selectedCompanyId, meeting.id, {
        outcomeType: "blocker",
        index,
        issueId: created.id,
      });
      return created;
    },
    onSuccess: (issue) => {
      setActionMessage(issue ? `Created blocker ${issue.identifier ?? issue.id.slice(0, 8)}.` : null);
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.workMeetings(selectedCompanyId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issue?.id ?? "") });
      }
    },
  });

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={MessagesSquare}
        message={companies.length === 0 ? "Create a company to view work meetings." : "Select a company to view work meetings."}
      />
    );
  }

  if (isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">Work Meetings</h1>
          <p className="text-sm text-muted-foreground">
            {meetings?.length ?? 0} visible · {pendingCount} pending · {unresolvedOutcomeCount} unlinked outcomes
          </p>
        </div>
        <div className="grid w-full grid-cols-4 border border-border text-center text-sm sm:min-w-[480px] lg:w-auto">
          <OverviewCell label="visible" value={meetings?.length ?? 0} />
          <OverviewCell label="pending" value={pendingCount} tone={pendingCount > 0 ? "warning" : "default"} />
          <OverviewCell label="resolved" value={resolvedCount} />
          <OverviewCell label="gaps" value={meetingHealth?.metrics.openMeetingGaps ?? 0} tone={(meetingHealth?.metrics.openMeetingGaps ?? 0) > 0 ? "warning" : "default"} />
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
      {actionMessage ? <p className="text-sm text-emerald-600 dark:text-emerald-300">{actionMessage}</p> : null}

      <div className="flex flex-col gap-3 border border-border p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid grid-cols-3 border border-border text-sm lg:inline-grid">
          <TabButton active={activeTab === "meetings"} onClick={() => setActiveTab("meetings")}>
            Meetings
          </TabButton>
          <TabButton active={activeTab === "gaps"} onClick={() => setActiveTab("gaps")}>
            Gaps
          </TabButton>
          <TabButton active={activeTab === "rules"} onClick={() => setActiveTab("rules")}>
            Rules
          </TabButton>
        </div>
        {stalePendingCount > 0 ? (
          <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
            <CircleAlert className="h-4 w-4 shrink-0" />
            <span>{stalePendingCount} pending meeting{stalePendingCount === 1 ? "" : "s"} older than 24 hours.</span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 border border-border p-3 md:grid-cols-[1fr_150px_180px_170px]">
        <label className="flex items-center gap-2 border border-border px-2 py-1.5">
          <ListFilter className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search meetings or issues"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="border border-border bg-background px-2 py-1.5 text-sm">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="answered">Resolved</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} className="border border-border bg-background px-2 py-1.5 text-sm">
          <option value="">All agents</option>
          {participantOptions.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>
        <select value={outputFilter} onChange={(event) => setOutputFilter(event.target.value)} className="border border-border bg-background px-2 py-1.5 text-sm">
          <option value="">All outputs</option>
          {EXPECTED_OUTPUTS.map((output) => (
            <option key={output} value={output}>{formatOutput(output)}</option>
          ))}
        </select>
      </div>

      {activeTab === "meetings" && meetings && meetings.length === 0 ? (
        <EmptyState icon={MessagesSquare} message="No work meetings match these filters." />
      ) : null}

      {activeTab === "meetings" && meetings && meetings.length > 0 ? (
        <div className="grid gap-4">
          <div className="overflow-hidden border border-border">
            <div className="hidden grid-cols-[120px_minmax(0,1fr)_130px_220px_120px] border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
              <span>Issue</span>
              <span>Meeting</span>
              <span>Status</span>
              <span>Participants</span>
              <span>Outputs</span>
            </div>
            {(meetings ?? []).map((meeting) => (
              <button
                key={meeting.id}
                type="button"
                onClick={() => {
                  setSelectedMeetingId(meeting.id);
                  setDetailOpen(true);
                }}
                className={`block w-full border-b border-border px-3 py-3 text-left last:border-b-0 hover:bg-accent/40 ${
                  selectedMeeting?.id === meeting.id ? "bg-accent/30" : ""
                }`}
              >
                <div className="grid gap-3 lg:grid-cols-[120px_minmax(0,1fr)_130px_220px_120px] lg:items-start">
                  <div className="flex flex-wrap items-center gap-2 lg:block">
                    <span className="font-mono text-xs text-muted-foreground">{issueLabel(meeting)}</span>
                    <span className="text-xs text-muted-foreground lg:mt-1 lg:block">{timeAgo(meeting.createdAt)}</span>
                  </div>

                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{meeting.title ?? meeting.purpose}</div>
                    <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{meeting.purpose}</p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClasses(meeting.status)}`}>{meeting.status}</span>
                    {hasStalePendingMeeting(meeting) ? <span className="text-xs text-amber-700 dark:text-amber-300">stale</span> : null}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {meeting.participants.slice(0, 3).map((agent) => (
                      <span key={agent.id} className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{agent.name}</span>
                    ))}
                    {meeting.participants.length > 3 ? (
                      <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">+{meeting.participants.length - 3}</span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {meeting.expectedOutputs.slice(0, 2).map((output) => (
                      <span key={output} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">{formatOutput(output)}</span>
                    ))}
                    {meeting.unlinkedOutcomeItems > 0 ? (
                      <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
                        {meeting.unlinkedOutcomeItems} unlinked
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === "gaps" && meetingHealth ? <MeetingGapsTable health={meetingHealth} /> : null}
      {activeTab === "rules" && meetingHealth ? <MeetingRulesPanel health={meetingHealth} /> : null}

      {detailOpen && selectedMeeting ? (
        <MeetingDetailModal
          meeting={selectedMeeting}
          creatingActionItem={createActionItemIssue.isPending}
          creatingBlocker={createBlockerIssue.isPending}
          onClose={() => setDetailOpen(false)}
          onCreateActionItem={(index) => createActionItemIssue.mutate({ meeting: selectedMeeting, index })}
          onCreateBlocker={(index) => createBlockerIssue.mutate({ meeting: selectedMeeting, index })}
        />
      ) : null}
    </div>
  );
}

function OverviewCell({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning";
}) {
  return (
    <div className={`border-r border-border px-3 py-2 last:border-r-0 ${tone === "warning" ? "bg-amber-500/10" : ""}`}>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-r border-border px-4 py-2 last:border-r-0 ${
        active ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function MeetingGapsTable({ health }: { health: MeetingWorkflowHealth }) {
  if (health.recommendations.length === 0) {
    return <EmptyState icon={CheckCircle2} message="No meeting gaps detected." />;
  }

  return (
    <section className="overflow-hidden border border-border">
      <div className="hidden grid-cols-[150px_minmax(0,1fr)_180px_260px] border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
        <span>Trigger</span>
        <span>Issue</span>
        <span>Chair</span>
        <span>Participants</span>
      </div>
      {health.recommendations.map((recommendation) => (
        <div key={recommendation.id} className="grid gap-3 border-b border-border px-3 py-3 last:border-b-0 lg:grid-cols-[150px_minmax(0,1fr)_180px_260px]">
          <div>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${severityClasses(recommendation.severity)}`}>
              {recommendation.trigger.replace(/_/g, " ")}
            </span>
          </div>
          <div className="min-w-0">
            {recommendation.issueIdentifier ? (
              <Link to={`/issues/${recommendation.issueIdentifier}`} className="font-mono text-xs text-muted-foreground hover:text-foreground">
                {recommendation.issueIdentifier}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">company</span>
            )}
            {recommendation.issueTitle ? <div className="mt-1 truncate text-sm font-medium">{recommendation.issueTitle}</div> : null}
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{recommendation.reason}</p>
          </div>
          <div className="text-sm">{recommendation.suggestedHeadName ?? "Board"}</div>
          <div className="text-sm text-muted-foreground">
            {recommendation.participantNames.length > 0 ? recommendation.participantNames.join(", ") : "Board"}
          </div>
        </div>
      ))}
    </section>
  );
}

function MeetingRulesPanel({ health }: { health: MeetingWorkflowHealth }) {
  return (
    <section className="space-y-5 border border-border p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <p className="text-sm leading-6 text-muted-foreground">{health.policy.purpose}</p>
        <p className="text-sm leading-6 text-muted-foreground">{health.policy.chairRule}</p>
      </div>

      <div className="overflow-hidden border border-border">
        {health.policy.triggerRules.map((rule) => (
          <div key={rule.id} className="grid gap-3 border-b border-border px-3 py-3 last:border-b-0 lg:grid-cols-[180px_minmax(0,1fr)_180px_240px]">
            <div className="text-sm font-medium">{rule.label}</div>
            <p className="text-sm leading-6 text-muted-foreground">{rule.when}</p>
            <div className="text-sm text-muted-foreground">{rule.chair}</div>
            <div className="flex flex-wrap gap-1">
              {rule.expectedOutputs.map((output) => (
                <span key={output} className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {formatOutput(output)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        {health.policy.lifecycle.map((step) => (
          <div key={step.status} className="border-l-2 border-border pl-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{step.label}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.description}</p>
          </div>
        ))}
      </div>
      <p className="border-l-2 border-border pl-3 text-sm leading-6 text-muted-foreground">{health.policy.doneDefinition}</p>
    </section>
  );
}

function MeetingDetailModal({
  meeting,
  creatingActionItem,
  creatingBlocker,
  onClose,
  onCreateActionItem,
  onCreateBlocker,
}: {
  meeting: WorkMeetingSummary;
  creatingActionItem: boolean;
  creatingBlocker: boolean;
  onClose: () => void;
  onCreateActionItem: (index: number) => void;
  onCreateBlocker: (index: number) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Meeting brief">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close meeting brief" onClick={onClose} />
      <aside className="absolute inset-x-3 top-3 mx-auto max-h-[calc(100vh-1.5rem)] max-w-5xl overflow-hidden border border-border bg-background shadow-2xl md:inset-x-6 md:top-6 md:max-h-[calc(100vh-3rem)]">
        <div className="border-b border-border bg-muted/35 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {issueHref(meeting) ? (
                <Link to={issueHref(meeting)!} className="font-mono text-xs text-muted-foreground hover:text-foreground">
                  {issueLabel(meeting)}
                </Link>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">company meeting</span>
              )}
              <h2 className="mt-1 truncate text-base font-semibold">{meeting.title ?? meeting.purpose}</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">{meeting.issueTitle ?? "Company coordination thread"}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded border border-border bg-background p-1 text-muted-foreground hover:text-foreground" aria-label="Close meeting detail">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(100vh-6.5rem)] overflow-y-auto p-4 md:max-h-[calc(100vh-8rem)]">
          <div className="flex flex-wrap gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClasses(meeting.status)}`}>{meeting.status}</span>
            {meeting.issueStatus ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{meeting.issueStatus}</span>
            ) : null}
            {hasStalePendingMeeting(meeting) ? (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">stale pending</span>
            ) : null}
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Purpose</h3>
                <p className="text-sm leading-6">{meeting.purpose}</p>
              </section>

              {meeting.result ? (
                <>
                  <section className="mt-5 space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outcome</h3>
                    <MarkdownBody>{meeting.result.summaryMarkdown}</MarkdownBody>
                  </section>

                  {meeting.result.businessReview ? (
                    <section className="mt-5 space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Business Review</h3>
                      <dl className="space-y-2 text-sm">
                        <DetailTerm label="Goal alignment" value={meeting.result.businessReview.goalAlignment} />
                        <DetailTerm label="Target / KPI impact" value={meeting.result.businessReview.targetOrKpiImpact} />
                        <DetailTerm label="Finance / budget impact" value={meeting.result.businessReview.financeOrBudgetImpact} />
                        <DetailTerm label="Business value" value={meeting.result.businessReview.customerOrBusinessValue} />
                      </dl>
                      <OutcomeTextList title="Requirements" items={meeting.result.businessReview.requirements ?? []} />
                      <OutcomeTextList title="Risks" items={meeting.result.businessReview.risks ?? []} />
                    </section>
                  ) : null}

                  {meeting.result.agentPerformanceReviews && meeting.result.agentPerformanceReviews.length > 0 ? (
                    <section className="mt-5 space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agent Performance</h3>
                      <div className="space-y-3">
                        {meeting.result.agentPerformanceReviews.map((review) => {
                          const agent = meeting.participants.find((participant) => participant.id === review.agentId);
                          return (
                            <div key={`${review.agentId}-${review.summary}`} className="border border-border p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium">{agent?.name ?? review.agentId.slice(0, 8)}</span>
                                <span className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{formatOutput(review.assessment)}</span>
                              </div>
                              <p className="mt-2 text-sm leading-6">{review.summary}</p>
                              <OutcomeTextList title="Evidence" items={review.evidence ?? []} />
                              <OutcomeTextList title="Corrections" items={review.corrections ?? []} />
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  {meeting.result.rightTrack ? (
                    <section className="mt-5 space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Right Track</h3>
                      <p className="text-sm leading-6">
                        <span className="font-medium">{formatOutput(meeting.result.rightTrack.status)}:</span>{" "}
                        {meeting.result.rightTrack.rationale}
                      </p>
                      <OutcomeTextList title="Corrections" items={meeting.result.rightTrack.corrections ?? []} />
                    </section>
                  ) : null}

                  {meeting.result.decisions.length > 0 ? (
                    <section className="mt-5 space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decisions</h3>
                      <ul className="space-y-1 text-sm">
                        {meeting.result.decisions.map((decision) => (
                          <li key={decision} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />{decision}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  <OutcomeList
                    title="Action Items"
                    items={meeting.result.actionItems}
                    busy={creatingActionItem}
                    empty="No action items recorded."
                    actionLabel="Create issue"
                    onCreate={onCreateActionItem}
                  />

                  <OutcomeList
                    title="Blockers"
                    items={meeting.result.blockers.map((blocker) => ({ title: blocker.summary, issueId: blocker.issueId }))}
                    busy={creatingBlocker}
                    empty="No blockers recorded."
                    actionLabel="Create blocker"
                    onCreate={onCreateBlocker}
                  />

                  {meeting.result.openQuestions.length > 0 ? (
                    <section className="mt-5 space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open Questions</h3>
                      <ul className="space-y-1 text-sm">
                        {meeting.result.openQuestions.map((question) => <li key={question}>{question}</li>)}
                      </ul>
                    </section>
                  ) : null}

                  <LinkedOutcomeList
                    title="Workflow Corrections"
                    items={(meeting.result.workflowCorrections ?? []).map((item) => ({
                      title: item.summary,
                      subtitle: item.target ?? null,
                      issueId: item.issueId,
                    }))}
                  />

                  <LinkedOutcomeList
                    title="Memory Corrections"
                    items={(meeting.result.memoryCorrections ?? []).map((item) => ({
                      title: item.correction,
                      subtitle: [item.system, item.filePath].filter(Boolean).join(" · "),
                      issueId: item.issueId,
                    }))}
                  />

                  <LinkedOutcomeList
                    title="Ideas"
                    items={(meeting.result.ideas ?? []).map((item) => ({
                      title: item.title,
                      subtitle: item.summary,
                      issueId: item.issueId,
                    }))}
                  />
                </>
              ) : (
                <section className="mt-5 border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                  This meeting is pending. Respond to the meeting thread to close the decision loop.
                </section>
              )}
            </div>

            <div className="space-y-5 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Participants</h3>
                <div className="flex flex-wrap gap-1.5">
                  {meeting.participants.map((agent) => (
                    <span key={agent.id} className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                      {agent.name} · {agent.role}
                    </span>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agenda</h3>
                <ol className="space-y-1 text-sm">
                  {meeting.agenda.map((item, index) => (
                    <li key={`${index}-${item}`} className="flex gap-2">
                      <span className="text-muted-foreground">{index + 1}.</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expected Outputs</h3>
                <div className="flex flex-wrap gap-1.5">
                  {meeting.expectedOutputs.map((output) => (
                    <span key={output} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">
                      {formatOutput(output)}
                    </span>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function DetailTerm({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 leading-6">{value}</dd>
    </div>
  );
}

function OutcomeTextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 space-y-1">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <ul className="space-y-1 text-sm">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function LinkedOutcomeList({
  title,
  items,
}: {
  title: string;
  items: Array<{ title: string; subtitle?: string | null; issueId?: string | null }>;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-5 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={`${item.title}-${item.issueId ?? "none"}`} className="border border-border p-3 text-sm">
            <div className="font-medium">{item.title}</div>
            {item.subtitle ? <div className="mt-1 text-muted-foreground">{item.subtitle}</div> : null}
            {item.issueId ? <div className="mt-1 font-mono text-xs text-muted-foreground">linked issue {item.issueId.slice(0, 8)}</div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function OutcomeList({
  title,
  items,
  busy,
  empty,
  actionLabel,
  onCreate,
}: {
  title: string;
  items: Array<{ title: string; issueId?: string | null }>;
  busy: boolean;
  empty: string;
  actionLabel: string;
  onCreate: (index: number) => void;
}) {
  return (
    <section className="mt-5 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={`${index}-${item.title}`} className="border border-border p-2">
            <p className="text-sm">{item.title}</p>
            {item.issueId ? (
              <Link to={`/issues/${item.issueId}`} className="mt-2 inline-flex text-xs text-muted-foreground underline underline-offset-2">
                Linked issue
              </Link>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => onCreate(index)}
                className="mt-2 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-60"
              >
                <Plus className="h-3 w-3" />
                {actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
