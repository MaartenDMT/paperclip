import { CheckCircle2, CircleDashed, FileCheck2, PlayCircle } from "lucide-react";
import type { CampaignPhaseDetail } from "@paperclipai/shared";
import { StatusBadge } from "./StatusBadge";
import { cn } from "../lib/utils";

type CampaignPhaseTimelineProps = {
  phases: CampaignPhaseDetail[];
  selectedPhaseId: string | null;
  onSelectPhase: (phaseId: string) => void;
};

function phaseIcon(status: string) {
  if (status === "completed") return CheckCircle2;
  if (status === "executing" || status === "approved") return PlayCircle;
  if (status === "in_review") return FileCheck2;
  return CircleDashed;
}

function summarizePlan(phase: CampaignPhaseDetail) {
  const body = phase.planDocument?.latestBody?.trim();
  if (!body) return "No plan yet";
  return body
    .replace(/^#+\s*/gm, "")
    .split(/\s+/)
    .slice(0, 14)
    .join(" ");
}

export function CampaignPhaseTimeline({
  phases,
  selectedPhaseId,
  onSelectPhase,
}: CampaignPhaseTimelineProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
        Phases
      </div>
      {phases.map((phase) => {
        const Icon = phaseIcon(phase.status);
        const selected = phase.id === selectedPhaseId;
        return (
          <button
            key={phase.id}
            type="button"
            className={cn(
              "flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left last:border-b-0 hover:bg-accent/40",
              selected && "bg-accent/60",
            )}
            onClick={() => onSelectPhase(phase.id)}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-medium">
                  {phase.sequenceNumber}. {phase.title}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={phase.status} />
                <span className="truncate text-xs text-muted-foreground">
                  {phase.assignee?.name ?? "Unassigned"}
                </span>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{summarizePlan(phase)}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
