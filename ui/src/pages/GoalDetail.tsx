import { useEffect, useMemo } from "react";
import { Link, useParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { goalsApi } from "../api/goals";
import { projectsApi } from "../api/projects";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { assetsApi } from "../api/assets";
import { usePanel } from "../context/PanelContext";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { collectLiveIssueIds } from "../lib/liveIssueIds";
import { GoalProperties } from "../components/GoalProperties";
import { GoalTree } from "../components/GoalTree";
import { StatusBadge } from "../components/StatusBadge";
import { InlineEditor } from "../components/InlineEditor";
import { EntityRow } from "../components/EntityRow";
import { IssuesList } from "../components/IssuesList";
import { PageSkeleton } from "../components/PageSkeleton";
import { cn, projectUrl } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, SlidersHorizontal } from "lucide-react";
import type { Agent, Goal, Issue, Project } from "@paperclipai/shared";

interface GoalPropertiesToggleButtonProps {
  panelVisible: boolean;
  onShowProperties: () => void;
}

export function GoalPropertiesToggleButton({
  panelVisible,
  onShowProperties,
}: GoalPropertiesToggleButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn(
        "hidden md:inline-flex shrink-0 transition-opacity duration-200",
        panelVisible ? "opacity-0 pointer-events-none w-0 overflow-hidden" : "opacity-100",
      )}
      onClick={onShowProperties}
      title="Show properties"
    >
      <SlidersHorizontal className="h-4 w-4" />
    </Button>
  );
}

const OPEN_ISSUE_STATUSES = new Set(["backlog", "todo", "in_progress", "in_review", "blocked"]);

function collectReportIds(managerId: string, agents: Agent[]) {
  const byManager = new Map<string, Agent[]>();
  for (const agent of agents) {
    if (!agent.reportsTo) continue;
    const reports = byManager.get(agent.reportsTo) ?? [];
    reports.push(agent);
    byManager.set(agent.reportsTo, reports);
  }

  const seen = new Set<string>();
  const stack = [managerId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const report of byManager.get(id) ?? []) stack.push(report.id);
  }
  return seen;
}

function summarizeDepartmentHeads(goal: Goal, agents: Agent[], issues: Issue[]) {
  const managerIds = new Set(agents.filter((agent) => agents.some((candidate) => candidate.reportsTo === agent.id)).map((agent) => agent.id));
  const candidates = agents.filter((agent) => managerIds.has(agent.id) || agent.id === goal.ownerAgentId);
  return candidates
    .map((agent) => {
      const subtreeIds = managerIds.has(agent.id) ? collectReportIds(agent.id, agents) : new Set([agent.id]);
      const assignedIssues = issues.filter((issue) => issue.assigneeAgentId && subtreeIds.has(issue.assigneeAgentId));
      const openIssues = assignedIssues.filter((issue) => OPEN_ISSUE_STATUSES.has(issue.status));
      return {
        agent,
        isOwner: agent.id === goal.ownerAgentId,
        totalIssueCount: assignedIssues.length,
        openIssueCount: openIssues.length,
        blockedIssueCount: openIssues.filter((issue) => issue.status === "blocked").length,
        runningIssueCount: openIssues.filter((issue) => issue.status === "in_progress").length,
      };
    })
    .filter((summary) => summary.isOwner || summary.totalIssueCount > 0)
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || b.openIssueCount - a.openIssueCount || a.agent.name.localeCompare(b.agent.name));
}

export function GoalDetail() {
  const { goalId } = useParams<{ goalId: string }>();
  const { selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { openNewGoal } = useDialogActions();
  const { openPanel, closePanel, panelVisible, setPanelVisible } = usePanel();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const {
    data: goal,
    isLoading,
    error
  } = useQuery({
    queryKey: queryKeys.goals.detail(goalId!),
    queryFn: () => goalsApi.get(goalId!),
    enabled: !!goalId
  });
  const resolvedCompanyId = goal?.companyId ?? selectedCompanyId;

  const { data: allGoals } = useQuery({
    queryKey: queryKeys.goals.list(resolvedCompanyId!),
    queryFn: () => goalsApi.list(resolvedCompanyId!),
    enabled: !!resolvedCompanyId
  });

  const { data: allProjects } = useQuery({
    queryKey: queryKeys.projects.list(resolvedCompanyId!),
    queryFn: () => projectsApi.list(resolvedCompanyId!),
    enabled: !!resolvedCompanyId
  });

  const { data: allAgents } = useQuery({
    queryKey: queryKeys.agents.list(resolvedCompanyId!),
    queryFn: () => agentsApi.list(resolvedCompanyId!),
    enabled: !!resolvedCompanyId
  });

  const { data: goalIssues, isLoading: goalIssuesLoading, error: goalIssuesError } = useQuery({
    queryKey: resolvedCompanyId && goalId
      ? queryKeys.issues.listByGoal(resolvedCompanyId, goalId)
      : ["issues", "__no-company__", "goal", "__no-goal__"],
    queryFn: () => issuesApi.list(resolvedCompanyId!, {
      goalId: goalId!,
      includeBlockedBy: true,
      includeRoutineExecutions: true,
      limit: 500,
    }),
    enabled: !!resolvedCompanyId && !!goalId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(resolvedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(resolvedCompanyId!),
    enabled: !!resolvedCompanyId,
    refetchInterval: 5000,
  });

  const liveIssueIds = useMemo(() => collectLiveIssueIds(liveRuns), [liveRuns]);
  const departmentHeadSummaries = useMemo(
    () => goal ? summarizeDepartmentHeads(goal, allAgents ?? [], goalIssues ?? []) : [],
    [allAgents, goal, goalIssues],
  );

  useEffect(() => {
    if (!goal?.companyId || goal.companyId === selectedCompanyId) return;
    setSelectedCompanyId(goal.companyId, { source: "route_sync" });
  }, [goal?.companyId, selectedCompanyId, setSelectedCompanyId]);

  const updateGoal = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      goalsApi.update(goalId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId!)
      });
      if (resolvedCompanyId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.goals.list(resolvedCompanyId)
        });
      }
    }
  });

  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      issuesApi.update(id, data),
    onSuccess: () => {
      if (!resolvedCompanyId || !goalId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listByGoal(resolvedCompanyId, goalId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(resolvedCompanyId) });
    },
  });

  const uploadImage = useMutation({
    mutationFn: async (file: File) => {
      if (!resolvedCompanyId) throw new Error("No company selected");
      return assetsApi.uploadImage(
        resolvedCompanyId,
        file,
        `goals/${goalId ?? "draft"}`
      );
    }
  });

  const childGoals = (allGoals ?? []).filter((g) => g.parentId === goalId);
  const linkedProjects = (allProjects ?? []).filter((p) => {
    if (!goalId) return false;
    if (p.goalIds.includes(goalId)) return true;
    if (p.goals.some((goalRef) => goalRef.id === goalId)) return true;
    return p.goalId === goalId;
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Goals", href: "/goals" },
      { label: goal?.title ?? goalId ?? "Goal" }
    ]);
  }, [setBreadcrumbs, goal, goalId]);

  useEffect(() => {
    if (goal) {
      openPanel(
        <GoalProperties
          goal={goal}
          onUpdate={(data) => updateGoal.mutate(data)}
        />
      );
    }
    return () => closePanel();
  }, [goal]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!goal) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase text-muted-foreground">
            {goal.level}
          </span>
          <StatusBadge status={goal.status} />
          <div className="ml-auto">
            <GoalPropertiesToggleButton
              panelVisible={panelVisible}
              onShowProperties={() => setPanelVisible(true)}
            />
          </div>
        </div>

        <InlineEditor
          value={goal.title}
          onSave={(title) => updateGoal.mutate({ title })}
          as="h2"
          className="text-xl font-bold"
        />

        <InlineEditor
          value={goal.description ?? ""}
          onSave={(description) => updateGoal.mutate({ description })}
          as="p"
          className="text-sm text-muted-foreground"
          placeholder="Add a description..."
          multiline
          imageUploadHandler={async (file) => {
            const asset = await uploadImage.mutateAsync(file);
            return asset.contentPath;
          }}
        />
      </div>

      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="children">
            Sub-Goals ({childGoals.length})
          </TabsTrigger>
          <TabsTrigger value="projects">
            Projects ({linkedProjects.length})
          </TabsTrigger>
          <TabsTrigger value="heads">
            Heads ({departmentHeadSummaries.length})
          </TabsTrigger>
          <TabsTrigger value="tasks">
            Tasks ({goalIssues?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="children" className="mt-4 space-y-3">
          <div className="flex items-center justify-start">
            <Button
              size="sm"
              variant="outline"
              onClick={() => openNewGoal({ parentId: goalId })}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Sub Goal
            </Button>
          </div>
          {childGoals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sub-goals.</p>
          ) : (
            <GoalTree goals={childGoals} goalLink={(g) => `/goals/${g.id}`} />
          )}
        </TabsContent>

        <TabsContent value="projects" className="mt-4">
          {linkedProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No linked projects.</p>
          ) : (
            <div className="border border-border">
              {linkedProjects.map((project) => (
                <EntityRow
                  key={project.id}
                  title={project.name}
                  subtitle={project.description ?? undefined}
                  to={projectUrl(project)}
                  trailing={<StatusBadge status={project.status} />}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="heads" className="mt-4">
          {departmentHeadSummaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No department head activity linked to this goal.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {departmentHeadSummaries.map((summary) => (
                <div key={summary.agent.id} className="border border-border p-3 space-y-3">
                  <div className="min-w-0">
                    <Link
                      to={`/agents/${summary.agent.urlKey ?? summary.agent.id}`}
                      className="font-medium hover:underline break-words"
                    >
                      {summary.agent.name}
                    </Link>
                    <p className="text-xs text-muted-foreground break-words">
                      {summary.agent.title ?? summary.agent.role}
                      {summary.isOwner ? " · goal owner" : ""}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="font-semibold">{summary.openIssueCount}</div>
                      <div className="text-xs text-muted-foreground">Open</div>
                    </div>
                    <div>
                      <div className="font-semibold">{summary.runningIssueCount}</div>
                      <div className="text-xs text-muted-foreground">Running</div>
                    </div>
                    <div>
                      <div className="font-semibold">{summary.blockedIssueCount}</div>
                      <div className="text-xs text-muted-foreground">Blocked</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <IssuesList
            issues={goalIssues ?? []}
            isLoading={goalIssuesLoading}
            error={goalIssuesError as Error | null}
            agents={allAgents}
            projects={allProjects}
            liveIssueIds={liveIssueIds}
            viewStateKey={`paperclip:goal:${goalId}:issues-view`}
            searchFilters={goalId ? { goalId, includeBlockedBy: true } : undefined}
            baseCreateIssueDefaults={{ goalId }}
            createIssueLabel="Task"
            enableRoutineVisibilityFilter
            onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
