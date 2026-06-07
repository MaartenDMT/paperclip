import { useEffect, useState } from "react";
import { FileCheck2, ListTodo, Send } from "lucide-react";
import type { CampaignPhaseDetail } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { MarkdownBody } from "./MarkdownBody";
import { MarkdownEditor } from "./MarkdownEditor";
import { StatusBadge } from "./StatusBadge";

type CampaignPhaseComposerProps = {
  phase: CampaignPhaseDetail;
  isSaving: boolean;
  isSubmitting: boolean;
  onSavePlan: (body: string) => void;
  onSubmitPlan: (body: string) => void;
};

const editableStatuses = new Set(["planning", "revision_requested"]);
const reviewStatuses = new Set(["pending", "in_review"]);
const visibleTaskStatuses = ["blocked", "in_progress", "in_review", "todo", "backlog", "done", "cancelled"] as const;

function formatTaskProgress(phase: CampaignPhaseDetail) {
  const progress = phase.taskProgress;
  if (!progress || progress.totalCount === 0) return null;

  const actionable = progress.source === "subtree" ? "mapped tasks" : "execution issue";
  const percent = Math.round((progress.completedCount / progress.totalCount) * 100);
  return {
    actionable,
    percent,
    label: `${progress.completedCount}/${progress.totalCount} done`,
  };
}

export function CampaignPhaseComposer({
  phase,
  isSaving,
  isSubmitting,
  onSavePlan,
  onSubmitPlan,
}: CampaignPhaseComposerProps) {
  const [editing, setEditing] = useState(editableStatuses.has(phase.status));
  const [body, setBody] = useState(phase.planDocument?.latestBody ?? "");
  const canEditPlan = editableStatuses.has(phase.status);
  const approvalNeedsBoard = phase.approval && reviewStatuses.has(phase.approval.status);
  const taskProgress = formatTaskProgress(phase);

  useEffect(() => {
    setBody(phase.planDocument?.latestBody ?? "");
    setEditing(editableStatuses.has(phase.status));
  }, [phase.id, phase.planDocument?.latestBody, phase.status]);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{phase.sequenceNumber}. {phase.title}</h2>
            <StatusBadge status={phase.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            Assignee: {phase.assignee?.name ?? "Unassigned"}
          </p>
          {phase.objective ? (
            <p className="max-w-3xl text-sm text-muted-foreground">{phase.objective}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditPlan ? (
            <Button variant="outline" size="sm" onClick={() => setEditing((current) => !current)}>
              {editing ? "Preview" : "Edit"}
            </Button>
          ) : null}
          {canEditPlan ? (
            <Button size="sm" onClick={() => onSavePlan(body)} disabled={isSaving || isSubmitting || !body.trim()}>
              <FileCheck2 className="mr-1.5 h-4 w-4" />
              {isSaving ? "Saving..." : "Save plan"}
            </Button>
          ) : null}
          {canEditPlan ? (
            <Button size="sm" onClick={() => onSubmitPlan(body)} disabled={isSaving || isSubmitting || !body.trim()}>
              <Send className="mr-1.5 h-4 w-4" />
              {isSubmitting ? "Submitting..." : "Submit plan"}
            </Button>
          ) : null}
        </div>
      </div>

      {phase.approval ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Approval {phase.approval.id}</span>
            <StatusBadge status={phase.approval.status} />
            {approvalNeedsBoard ? (
              <span className="text-xs text-muted-foreground">Decision controls live in approvals.</span>
            ) : null}
          </div>
          <Link to={`/approvals/${phase.approval.id}`} className="text-sm font-medium text-primary hover:underline">
            Open approval
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section className="min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Plan document</h3>
            {phase.planDocument ? (
              <span className="text-xs text-muted-foreground">
                Revision {phase.planDocument.latestRevisionNumber}
              </span>
            ) : null}
          </div>
          {editing && canEditPlan ? (
            <MarkdownEditor
              value={body}
              onChange={setBody}
              placeholder="Phase plan body"
              contentClassName="min-h-[320px]"
            />
          ) : (
            <MarkdownBody className="min-h-[180px] rounded-md border border-border bg-background p-3">
              {body || "No plan written yet."}
            </MarkdownBody>
          )}
        </section>

        <aside className="space-y-3 text-sm">
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-xs font-medium uppercase text-muted-foreground">Execution</h3>
            </div>
            {phase.executionIssue ? (
              <div className="mt-2 space-y-1">
                <Link
                  to={`/issues/${phase.executionIssue.identifier ?? phase.executionIssue.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  Open execution issue
                </Link>
                <p className="text-xs text-muted-foreground">
                  {phase.executionIssue.title} · {phase.executionIssue.status}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No execution issue yet.</p>
            )}
            {phase.taskProgress ? (
              <div className="mt-3 space-y-3 border-t border-border pt-3">
                {taskProgress ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium">{taskProgress.label}</span>
                      <span className="text-muted-foreground">{taskProgress.percent}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${taskProgress.percent}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Tracking {taskProgress.actionable}; {phase.taskProgress.openCount} still open.
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  {visibleTaskStatuses
                    .filter((status) => (phase.taskProgress?.statusCounts[status] ?? 0) > 0)
                    .map((status) => (
                      <span
                        key={status}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs"
                      >
                        <StatusBadge status={status} />
                        <span className="text-muted-foreground">{phase.taskProgress!.statusCounts[status]}</span>
                      </span>
                    ))}
                </div>
                <div className="space-y-2">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground">Next issues</h4>
                  {phase.taskProgress.nextIssues.length > 0 ? (
                    <div className="space-y-2">
                      {phase.taskProgress.nextIssues.map((issue) => (
                        <Link
                          key={issue.id}
                          to={`/issues/${issue.identifier ?? issue.id}`}
                          className="block rounded-md border border-border px-2 py-1.5 hover:bg-accent/40"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-medium">
                              {issue.identifier ?? "Issue"} · {issue.title}
                            </span>
                            <StatusBadge status={issue.status} />
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No open issues remain for this phase.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <div className="rounded-md border border-border p-3">
            <h3 className="text-xs font-medium uppercase text-muted-foreground">Result</h3>
            {phase.resultDocument ? (
              <MarkdownBody className="mt-2 text-sm">{phase.resultDocument.latestBody}</MarkdownBody>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No result document yet.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
