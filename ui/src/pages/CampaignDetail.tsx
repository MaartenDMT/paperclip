import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Flag, Plus } from "lucide-react";
import { Link, useParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { agentsApi } from "../api/agents";
import { campaignsApi } from "../api/campaigns";
import { CampaignPhaseComposer } from "../components/CampaignPhaseComposer";
import { CampaignPhaseTimeline } from "../components/CampaignPhaseTimeline";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";

function useCampaignId() {
  const params = useParams();
  return params.campaignId;
}

function PhaseCreatePanel({
  agents,
  isPending,
  onCancel,
  onSubmit,
}: {
  agents: Array<{ id: string; name: string; role: string; title?: string | null }>;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (data: {
    title: string;
    objective: string | null;
    assigneeAgentId: string | null;
    planBody: string | null;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [assigneeAgentId, setAssigneeAgentId] = useState("");
  const [planBody, setPlanBody] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      objective: objective.trim() || null,
      assigneeAgentId: assigneeAgentId || null,
      planBody: planBody.trim() || null,
    });
  }

  return (
    <form className="rounded-lg border border-border bg-muted/10 p-4" onSubmit={handleSubmit}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">New phase</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="campaign-phase-title">
            Title
          </label>
          <input
            id="campaign-phase-title"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="campaign-phase-assignee">
            Assignee
          </label>
          <select
            id="campaign-phase-assignee"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={assigneeAgentId}
            onChange={(event) => setAssigneeAgentId(event.currentTarget.value)}
          >
            <option value="">Unassigned</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="campaign-phase-objective">
            Objective
          </label>
          <textarea
            id="campaign-phase-objective"
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={objective}
            onChange={(event) => setObjective(event.currentTarget.value)}
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="campaign-phase-plan">
            Initial plan
          </label>
          <textarea
            id="campaign-phase-plan"
            className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
            value={planBody}
            onChange={(event) => setPlanBody(event.currentTarget.value)}
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="submit" size="sm" disabled={isPending || !title.trim()}>
          {isPending ? "Creating..." : "Create phase"}
        </Button>
      </div>
    </form>
  );
}

export function CampaignDetail() {
  const campaignId = useCampaignId();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [creatingPhase, setCreatingPhase] = useState(false);

  const detailQuery = useQuery({
    queryKey: queryKeys.campaigns.detail(campaignId!),
    queryFn: () => campaignsApi.get(campaignId!),
    enabled: !!campaignId && !!selectedCompanyId,
  });

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && creatingPhase,
  });

  const campaign = detailQuery.data;
  const selectedPhase = useMemo(
    () => campaign?.phases.find((phase) => phase.id === selectedPhaseId) ?? campaign?.phases[0] ?? null,
    [campaign?.phases, selectedPhaseId],
  );

  useEffect(() => {
    if (campaign) {
      setBreadcrumbs([
        { label: "Campaigns", href: "/campaigns" },
        { label: campaign.title },
      ]);
    }
  }, [campaign, setBreadcrumbs]);

  useEffect(() => {
    if (!selectedPhaseId && campaign?.phases[0]) {
      setSelectedPhaseId(campaign.phases[0].id);
    }
  }, [campaign?.phases, selectedPhaseId]);

  async function invalidateDetail() {
    if (campaignId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(campaignId) });
    }
    if (selectedCompanyId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list(selectedCompanyId) });
    }
  }

  const createPhase = useMutation({
    mutationFn: (data: {
      title: string;
      objective: string | null;
      assigneeAgentId: string | null;
      planBody: string | null;
    }) => campaignsApi.createPhase(campaignId!, data),
    onSuccess: async (phase) => {
      setCreatingPhase(false);
      setSelectedPhaseId(phase.id);
      await invalidateDetail();
      pushToast({ title: "Phase created", tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to create phase",
        body: error instanceof Error ? error.message : "Paperclip could not create the phase.",
        tone: "error",
      });
    },
  });

  const savePlan = useMutation({
    mutationFn: ({ phaseId, body }: { phaseId: string; body: string }) =>
      campaignsApi.upsertPlan(phaseId, {
        body,
        changeSummary: "Updated phase plan from board",
      }),
    onSuccess: async () => {
      await invalidateDetail();
      pushToast({ title: "Plan saved", tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to save plan",
        body: error instanceof Error ? error.message : "Paperclip could not save the phase plan.",
        tone: "error",
      });
    },
  });

  const submitPlan = useMutation({
    mutationFn: async ({ phaseId, body, persistedBody }: {
      phaseId: string;
      body: string;
      persistedBody: string;
    }) => {
      if (body.trim() !== persistedBody.trim()) {
        await campaignsApi.upsertPlan(phaseId, {
          body,
          changeSummary: "Updated phase plan from board",
        });
      }
      return campaignsApi.submitPlan(phaseId);
    },
    onSuccess: async () => {
      await invalidateDetail();
      pushToast({ title: "Plan submitted for review", tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to submit plan",
        body: error instanceof Error ? error.message : "Paperclip could not submit the phase plan.",
        tone: "error",
      });
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Flag} message="Select a company to view this campaign." />;
  }

  if (detailQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (detailQuery.error) {
    return (
      <div className="space-y-4">
        <Link to="/campaigns" className="text-sm font-medium text-primary hover:underline">
          Back to campaigns
        </Link>
        <p className="text-sm text-destructive">
          {detailQuery.error instanceof Error ? detailQuery.error.message : "Failed to load campaign."}
        </p>
      </div>
    );
  }

  if (!campaign) {
    return <EmptyState icon={Flag} message="Campaign not found." />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{campaign.title}</h1>
            <StatusBadge status={campaign.status} />
          </div>
          {campaign.objective ? (
            <p className="max-w-4xl text-sm text-muted-foreground">{campaign.objective}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Lead:</span>
            <span>{campaign.leadAgent?.name ?? "Unassigned"}</span>
            <span className="text-muted-foreground">Projects:</span>
            {campaign.projects.length > 0 ? (
              campaign.projects.map((project) => (
                <span key={project.id} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ backgroundColor: project.color ?? "#64748b" }}
                  />
                  {project.name}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No linked projects</span>
            )}
          </div>
        </div>
        <Button size="sm" onClick={() => setCreatingPhase(true)} disabled={creatingPhase}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add phase
        </Button>
      </div>

      {creatingPhase ? (
        <PhaseCreatePanel
          agents={agentsQuery.data ?? []}
          isPending={createPhase.isPending}
          onCancel={() => setCreatingPhase(false)}
          onSubmit={(data) => createPhase.mutate(data)}
        />
      ) : null}

      {campaign.phases.length === 0 ? (
        <EmptyState
          icon={FileText}
          message="No phases yet."
          action="Add phase"
          onAction={() => setCreatingPhase(true)}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <CampaignPhaseTimeline
            phases={campaign.phases}
            selectedPhaseId={selectedPhase?.id ?? null}
            onSelectPhase={setSelectedPhaseId}
          />
          {selectedPhase ? (
            <CampaignPhaseComposer
              phase={selectedPhase}
              isSaving={savePlan.isPending}
              isSubmitting={submitPlan.isPending}
              onSavePlan={(body) => savePlan.mutate({ phaseId: selectedPhase.id, body })}
              onSubmitPlan={(body) =>
                submitPlan.mutate({
                  phaseId: selectedPhase.id,
                  body,
                  persistedBody: selectedPhase.planDocument?.latestBody ?? "",
                })
              }
            />
          ) : (
            <EmptyState icon={FileText} message="Select a phase to review its plan." />
          )}
        </div>
      )}
    </div>
  );
}
