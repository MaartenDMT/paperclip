import { useEffect, useMemo, useState } from "react";
import type { CampaignListItem } from "@paperclipai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Plus } from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { agentsApi } from "../api/agents";
import { campaignsApi } from "../api/campaigns";
import { projectsApi } from "../api/projects";
import { EmptyState } from "../components/EmptyState";
import { NewCampaignDialog } from "../components/NewCampaignDialog";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";

function formatPhase(campaign: CampaignListItem) {
  if (campaign.activePhase) {
    return `${campaign.activePhase.sequenceNumber}. ${campaign.activePhase.title}`;
  }
  if (campaign.phaseCount > 0) {
    return `${campaign.phaseCount} phases`;
  }
  return "No phases";
}

function projectSummary(campaign: CampaignListItem) {
  if (campaign.projects.length === 0) return "No projects";
  if (campaign.projects.length <= 2) {
    return campaign.projects.map((project) => project.name).join(", ");
  }
  return `${campaign.projects[0]!.name}, ${campaign.projects[1]!.name} +${campaign.projects.length - 2}`;
}

function CampaignRow({ campaign }: { campaign: CampaignListItem }) {
  return (
    <Link
      to={`/campaigns/${campaign.id}`}
      className="grid gap-3 border-b border-border px-4 py-3 text-sm text-inherit no-underline transition-colors last:border-b-0 hover:bg-accent/50 lg:grid-cols-[minmax(220px,1.3fr)_120px_minmax(180px,0.9fr)_minmax(160px,0.9fr)_120px_minmax(130px,0.7fr)] lg:items-center"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{campaign.title}</span>
          {campaign.pendingReviewCount > 0 ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              {campaign.pendingReviewCount}
            </span>
          ) : null}
        </div>
        {campaign.objective ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{campaign.objective}</p>
        ) : null}
      </div>

      <div>
        <StatusBadge status={campaign.status} />
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap gap-1.5 lg:flex-nowrap">
          {campaign.projects.length > 0 ? (
            campaign.projects.slice(0, 3).map((project) => (
              <span
                key={project.id}
                className="inline-flex min-w-0 max-w-40 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs"
                title={project.name}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: project.color ?? "#64748b" }}
                />
                <span className="truncate">{project.name}</span>
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">No projects</span>
          )}
          {campaign.projects.length > 3 ? (
            <span className="text-xs text-muted-foreground">+{campaign.projects.length - 3}</span>
          ) : null}
        </div>
        <span className="sr-only">{projectSummary(campaign)}</span>
      </div>

      <div className="min-w-0 text-xs text-muted-foreground">
        <span className="lg:hidden">Active phase: </span>
        <span className="truncate">{formatPhase(campaign)}</span>
      </div>

      <div className="text-xs text-muted-foreground">
        <span className="lg:hidden">Pending reviews: </span>
        {campaign.pendingReviewCount}
      </div>

      <div className="min-w-0 text-xs text-muted-foreground">
        <span className="lg:hidden">Lead: </span>
        <span className="truncate">{campaign.leadAgent?.name ?? "Unassigned"}</span>
      </div>
    </Link>
  );
}

export function Campaigns() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Campaigns" }]);
  }, [setBreadcrumbs]);

  const campaignsQuery = useQuery({
    queryKey: queryKeys.campaigns.list(selectedCompanyId!),
    queryFn: () => campaignsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && createOpen,
  });

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && createOpen,
  });

  const campaigns = useMemo(
    () => (campaignsQuery.data ?? []).filter((campaign) => !campaign.archivedAt),
    [campaignsQuery.data],
  );
  const projects = useMemo(
    () => (projectsQuery.data ?? []).filter((project) => !project.archivedAt),
    [projectsQuery.data],
  );

  const createCampaign = useMutation({
    mutationFn: (data: {
      title: string;
      objective: string;
      projectIds: string[];
      leadAgentId: string | null;
    }) =>
      campaignsApi.create(selectedCompanyId!, {
        title: data.title,
        objective: data.objective || null,
        projectIds: data.projectIds,
        leadAgentId: data.leadAgentId,
        status: "draft",
      }),
    onSuccess: async () => {
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list(selectedCompanyId!) });
      pushToast({ title: "Campaign created", tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to create campaign",
        body: error instanceof Error ? error.message : "Paperclip could not create the campaign.",
        tone: "error",
      });
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Flag} message="Select a company to view campaigns." />;
  }

  if (campaignsQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Create campaign
        </Button>
      </div>

      {campaignsQuery.error ? (
        <p className="text-sm text-destructive">
          {campaignsQuery.error instanceof Error ? campaignsQuery.error.message : "Failed to load campaigns."}
        </p>
      ) : null}

      {campaigns.length === 0 ? (
        <EmptyState
          icon={Flag}
          message="No campaigns yet."
          action="Create campaign"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="hidden border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid lg:grid-cols-[minmax(220px,1.3fr)_120px_minmax(180px,0.9fr)_minmax(160px,0.9fr)_120px_minmax(130px,0.7fr)]">
            <span>Campaign</span>
            <span>Status</span>
            <span>Projects</span>
            <span>Active phase</span>
            <span>Reviews</span>
            <span>Lead</span>
          </div>
          {campaigns.map((campaign) => (
            <CampaignRow key={campaign.id} campaign={campaign} />
          ))}
        </div>
      )}

      <NewCampaignDialog
        open={createOpen}
        agents={agentsQuery.data ?? []}
        projects={projects}
        isPending={createCampaign.isPending}
        error={createCampaign.error instanceof Error ? createCampaign.error : null}
        onOpenChange={setCreateOpen}
        onSubmit={(draft) => createCampaign.mutate(draft)}
      />
    </div>
  );
}
