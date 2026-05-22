import { useEffect, useMemo, useState } from "react";
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

const EXPECTED_OUTPUTS = ["decisions", "tasks", "blockers", "questions", "plan_update"] as const;

function formatOutput(value: string) {
  return value.replace(/_/g, " ");
}

function statusClasses(status: string) {
  if (status === "answered" || status === "accepted") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "pending") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "cancelled" || status === "rejected" || status === "expired") return "border-muted bg-muted text-muted-foreground";
  return "border-border bg-muted text-muted-foreground";
}

function issueHref(meeting: WorkMeetingSummary) {
  return `/issues/${meeting.issueIdentifier ?? meeting.issueId}`;
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
    (sum, meeting) => sum + meeting.unlinkedActionItems + meeting.unlinkedBlockers,
    0,
  ) ?? 0;

  const createActionItemIssue = useMutation({
    mutationFn: async ({ meeting, index }: { meeting: WorkMeetingSummary; index: number }) => {
      const item = meeting.result?.actionItems[index];
      if (!item || !selectedCompanyId) return null;
      return issuesApi.create(selectedCompanyId, {
        title: item.title,
        description: [
          `Created from work meeting: ${meeting.title ?? meeting.purpose}`,
          "",
          `Source issue: ${meeting.issueIdentifier ?? meeting.issueId}`,
          "",
          meeting.result?.summaryMarkdown ?? "",
        ].join("\n"),
        parentId: meeting.issueId,
        assigneeAgentId: item.ownerAgentId ?? null,
        status: item.ownerAgentId ? "todo" : "backlog",
        priority: "medium",
      });
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
      const sourceIssue = await issuesApi.get(meeting.issueId);
      const created = await issuesApi.create(selectedCompanyId, {
        title: `Unblock: ${blocker.summary}`,
        description: [
          `Created from work meeting: ${meeting.title ?? meeting.purpose}`,
          "",
          `This blocker was recorded against ${meeting.issueIdentifier ?? meeting.issueId}.`,
          "",
          meeting.result?.summaryMarkdown ?? "",
        ].join("\n"),
        parentId: meeting.issueId,
        assigneeAgentId: blocker.ownerAgentId ?? null,
        status: blocker.ownerAgentId ? "todo" : "backlog",
        priority: "high",
      });
      const existingBlockers = sourceIssue.blockedBy?.map((item) => item.id) ?? [];
      await issuesApi.update(meeting.issueId, {
        blockedByIssueIds: [...new Set([...existingBlockers, created.id])],
      });
      return created;
    },
    onSuccess: (issue) => {
      setActionMessage(issue ? `Created blocker ${issue.identifier ?? issue.id.slice(0, 8)} and linked it.` : null);
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
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">Work Meetings</h1>
          <p className="text-sm text-muted-foreground">{meetings?.length ?? 0} visible · {unresolvedOutcomeCount} unlinked outcomes</p>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
      {actionMessage ? <p className="text-sm text-emerald-600 dark:text-emerald-300">{actionMessage}</p> : null}

      {stalePendingCount > 0 ? (
        <div className="flex items-center gap-2 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <CircleAlert className="h-4 w-4 shrink-0" />
          <span>{stalePendingCount} pending meeting{stalePendingCount === 1 ? "" : "s"} older than 24 hours need a decision path.</span>
        </div>
      ) : null}

      {meetingHealth ? <MeetingWorkflowHealthPanel health={meetingHealth} /> : null}

      <div className="grid gap-2 border border-border p-3 md:grid-cols-[1fr_160px_180px_180px]">
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

      {meetings && meetings.length === 0 ? (
        <EmptyState icon={MessagesSquare} message="No work meetings match these filters." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="overflow-hidden border border-border">
            {(meetings ?? []).map((meeting) => (
              <button
                key={meeting.id}
                type="button"
                onClick={() => setSelectedMeetingId(meeting.id)}
                className={`block w-full border-b border-border p-4 text-left last:border-b-0 hover:bg-accent/40 ${
                  selectedMeeting?.id === meeting.id ? "bg-accent/30" : ""
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{meeting.issueIdentifier ?? meeting.issueId.slice(0, 8)}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClasses(meeting.status)}`}>{meeting.status}</span>
                      {hasStalePendingMeeting(meeting) ? <span className="text-xs text-amber-700 dark:text-amber-300">stale</span> : null}
                      <span className="text-xs text-muted-foreground">{timeAgo(meeting.createdAt)}</span>
                    </div>
                    <div className="truncate text-sm font-medium">{meeting.title ?? meeting.purpose}</div>
                    <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{meeting.purpose}</p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-1.5 lg:max-w-sm lg:justify-end">
                    {meeting.participants.map((agent) => (
                      <span key={agent.id} className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{agent.name}</span>
                    ))}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {meeting.expectedOutputs.map((output) => (
                    <span key={output} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">{formatOutput(output)}</span>
                  ))}
                  {meeting.unlinkedActionItems + meeting.unlinkedBlockers > 0 ? (
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
                      {meeting.unlinkedActionItems + meeting.unlinkedBlockers} unlinked
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>

          {selectedMeeting ? (
            <MeetingDetail
              meeting={selectedMeeting}
              creatingActionItem={createActionItemIssue.isPending}
              creatingBlocker={createBlockerIssue.isPending}
              onClose={() => setSelectedMeetingId(null)}
              onCreateActionItem={(index) => createActionItemIssue.mutate({ meeting: selectedMeeting, index })}
              onCreateBlocker={(index) => createBlockerIssue.mutate({ meeting: selectedMeeting, index })}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function MeetingWorkflowHealthPanel({ health }: { health: MeetingWorkflowHealth }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-6">
        <MeetingMetric label="Total" value={health.metrics.totalMeetings} />
        <MeetingMetric label="Pending" value={health.metrics.pendingMeetings} />
        <MeetingMetric label="Resolved" value={health.metrics.resolvedMeetings} />
        <MeetingMetric label="Stale" value={health.metrics.stalePendingMeetings} tone={health.metrics.stalePendingMeetings > 0 ? "warning" : "default"} />
        <MeetingMetric label="Last 7 days" value={health.metrics.meetingsLast7Days} />
        <MeetingMetric label="Gaps" value={health.metrics.openMeetingGaps} tone={health.metrics.openMeetingGaps > 0 ? "warning" : "default"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="border border-border p-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Meeting Operating Model</h2>
            <p className="text-sm leading-6 text-muted-foreground">{health.policy.purpose}</p>
            <p className="text-sm leading-6 text-muted-foreground">{health.policy.chairRule}</p>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {health.policy.triggerRules.map((rule) => (
              <div key={rule.id} className="border border-border p-3">
                <div className="text-sm font-medium">{rule.label}</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{rule.when}</p>
                <p className="mt-2 text-xs text-muted-foreground">Chair: {rule.chair}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {rule.expectedOutputs.map((output) => (
                    <span key={output} className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {formatOutput(output)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-4">
            {health.policy.lifecycle.map((step) => (
              <div key={step.status} className="border border-border p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{step.label}</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.description}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 border-l-2 border-border pl-3 text-sm leading-6 text-muted-foreground">{health.policy.doneDefinition}</p>
        </section>

        <section className="border border-border p-4">
          <h2 className="text-sm font-semibold">Meeting Gaps</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Issues where the workflow expects a structured meeting but none is pending or recent.
          </p>
          {health.recommendations.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No meeting gaps detected.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {health.recommendations.map((recommendation) => (
                <div key={recommendation.id} className="border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${severityClasses(recommendation.severity)}`}>
                      {recommendation.trigger.replace(/_/g, " ")}
                    </span>
                    {recommendation.issueIdentifier ? (
                      <Link to={`/issues/${recommendation.issueIdentifier}`} className="font-mono text-xs text-muted-foreground hover:text-foreground">
                        {recommendation.issueIdentifier}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">company</span>
                    )}
                  </div>
                  {recommendation.issueTitle ? <div className="mt-2 text-sm font-medium">{recommendation.issueTitle}</div> : null}
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{recommendation.reason}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Head: {recommendation.suggestedHeadName ?? "Board"} · Participants: {recommendation.participantNames.length > 0 ? recommendation.participantNames.join(", ") : "Board"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MeetingMetric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "warning" }) {
  return (
    <div className={`border p-3 ${tone === "warning" ? "border-amber-500/30 bg-amber-500/10" : "border-border"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function MeetingDetail({
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
    <aside className="border border-border p-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={issueHref(meeting)} className="font-mono text-xs text-muted-foreground hover:text-foreground">
            {meeting.issueIdentifier ?? meeting.issueId.slice(0, 8)}
          </Link>
          <h2 className="mt-1 text-base font-semibold">{meeting.title ?? meeting.purpose}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{meeting.issueTitle}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded border border-border p-1 text-muted-foreground hover:text-foreground" aria-label="Close meeting detail">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClasses(meeting.status)}`}>{meeting.status}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{meeting.issueStatus}</span>
        {hasStalePendingMeeting(meeting) ? (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">stale pending</span>
        ) : null}
      </div>

      <section className="mt-5 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Purpose</h3>
        <p className="text-sm leading-6">{meeting.purpose}</p>
      </section>

      <section className="mt-5 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Participants</h3>
        <div className="flex flex-wrap gap-1.5">
          {meeting.participants.map((agent) => (
            <span key={agent.id} className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
              {agent.name} · {agent.role}
            </span>
          ))}
        </div>
      </section>

      <section className="mt-5 space-y-2">
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

      {meeting.result ? (
        <>
          <section className="mt-5 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outcome</h3>
            <MarkdownBody>{meeting.result.summaryMarkdown}</MarkdownBody>
          </section>

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
        </>
      ) : (
        <section className="mt-5 border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          This meeting is pending. Record outcomes on the source issue to close the decision loop.
        </section>
      )}
    </aside>
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
