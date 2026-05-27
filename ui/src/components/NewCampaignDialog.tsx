import { useEffect, useMemo, useState } from "react";
import type { Agent, Project } from "@paperclipai/shared";
import { Check, Flag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "../lib/utils";

type NewCampaignDraft = {
  title: string;
  objective: string;
  projectIds: string[];
  leadAgentId: string | null;
};

type NewCampaignDialogProps = {
  open: boolean;
  agents: Agent[];
  projects: Project[];
  isPending: boolean;
  error: Error | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: NewCampaignDraft) => void;
};

export function NewCampaignDialog({
  open,
  agents,
  projects,
  isPending,
  error,
  onOpenChange,
  onSubmit,
}: NewCampaignDialogProps) {
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [leadAgentId, setLeadAgentId] = useState<string>("none");

  const availableAgents = useMemo(
    () => agents.filter((agent) => agent.status !== "terminated"),
    [agents],
  );
  const selectedProjectSet = useMemo(() => new Set(projectIds), [projectIds]);

  function reset() {
    setTitle("");
    setObjective("");
    setProjectIds([]);
    setLeadAgentId("none");
  }

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  function toggleProject(projectId: string) {
    setProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId],
    );
  }

  function handleOpenChange(nextOpen: boolean) {
    if (isPending) return;
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  function handleSubmit() {
    if (!title.trim() || isPending) return;
    onSubmit({
      title: title.trim(),
      objective: objective.trim(),
      projectIds,
      leadAgentId: leadAgentId === "none" ? null : leadAgentId,
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-2xl gap-0 p-0" aria-describedby={undefined}>
        <DialogTitle className="sr-only">New campaign</DialogTitle>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Flag className="h-4 w-4" />
            <span>New campaign</span>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => handleOpenChange(false)}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="campaign-title">
              Title
            </label>
            <input
              id="campaign-title"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Campaign title"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="campaign-objective">
              Objective
            </label>
            <textarea
              id="campaign-objective"
              className="min-h-24 w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Outcome this campaign should produce"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-xs text-muted-foreground">Projects</label>
                {projectIds.length > 0 ? (
                  <span className="text-xs text-muted-foreground">{projectIds.length} selected</span>
                ) : null}
              </div>
              <div className="max-h-44 overflow-y-auto rounded-md border border-border">
                {projects.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">No projects available.</div>
                ) : (
                  projects.map((project) => {
                    const selected = selectedProjectSet.has(project.id);
                    return (
                      <button
                        key={project.id}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent/50",
                          selected && "bg-accent/40",
                        )}
                        onClick={() => toggleProject(project.id)}
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-sm"
                          style={{ backgroundColor: project.color ?? "#64748b" }}
                        />
                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                        {selected ? <Check className="h-4 w-4 text-muted-foreground" /> : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Lead agent</label>
              <Select value={leadAgentId} onValueChange={setLeadAgentId}>
                <SelectTrigger>
                  <SelectValue placeholder="No lead" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No lead</SelectItem>
                  {availableAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          {error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : (
            <span />
          )}
          <Button onClick={handleSubmit} disabled={!title.trim() || isPending}>
            {isPending ? "Creating..." : "Create campaign"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
