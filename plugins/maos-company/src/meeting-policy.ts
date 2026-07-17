export const MEETING_TRIGGERS = [
  "blocked_without_edge",
  "stale_review",
  "stale_in_progress",
  "active_work_pressure",
  "failed_run_review",
  "campaign_phase_review",
  "productivity_review",
  "fiction_story_alignment",
  "no_recent_meetings",
] as const;

export type MeetingTrigger = (typeof MEETING_TRIGGERS)[number];

const EXPECTED_OUTPUTS = [
  "goals",
  "targets",
  "kpis",
  "finance",
  "business_requirements",
  "agent_performance",
  "problems",
  "blockers",
  "tasks",
  "right_track",
  "optimization",
  "workflow_corrections",
  "memory_corrections",
  "idea_sharing",
  "workflows",
  "process",
  "plan_update",
  "questions",
  "decisions",
] as const;

const TRIGGER_CONFIG: Record<MeetingTrigger, { label: string; when: string; chair: string; title: string; agenda: string[] }> = {
  blocked_without_edge: {
    label: "Blocker hygiene",
    when: "An issue says blocked, stuck, or waiting but has no first-class blocker edge.",
    chair: "Nearest department or domain owner; CEO only for critical or multi-head escalation.",
    title: "Blocked work",
    agenda: ["Define the blocked outcome and cost of delay.", "Name the blocker owner and missing dependency edge.", "Choose the escalation or process correction."],
  },
  stale_review: {
    label: "Review waiting",
    when: "An issue sits in review for more than 24 hours.",
    chair: "Review owner or nearest department or domain owner.",
    title: "Review waiting",
    agenda: ["Review goal fit, quality bar, and decision owner.", "Assess review latency and handoff quality.", "Decide the outcome and next issue operation."],
  },
  stale_in_progress: {
    label: "Execution ambiguity",
    when: "An in-progress issue has not moved for more than 72 hours.",
    chair: "Nearest department or domain owner.",
    title: "Execution check-in",
    agenda: ["Compare progress with the target and KPI.", "Surface execution, spend, workflow, and memory risks.", "Set the next measurable checkpoint."],
  },
  active_work_pressure: {
    label: "Active work pressure",
    when: "Queued or running work requires a short operating review.",
    chair: "CEO with direct heads, or the nearest operating head when scoped.",
    title: "Operating pressure",
    agenda: ["Review what changed across active work.", "Identify blocked, overloaded, or duplicated work.", "Choose the exact issue operation needed now."],
  },
  failed_run_review: {
    label: "Failed run review",
    when: "Failed or timed-out runs indicate runtime, quality, ownership, or recovery risk.",
    chair: "CEO with direct heads, or the nearest operating head when scoped.",
    title: "Run failure review",
    agenda: ["Identify user-visible impact and blocked work.", "Review repeated failure, churn, and ownership.", "Choose retry, reassignment, pause, or recovery work."],
  },
  campaign_phase_review: {
    label: "Campaign phase review",
    when: "Campaign phases wait in review, revision, approval, or execution states.",
    chair: "Campaign lead or relevant department or domain head.",
    title: "Campaign phase review",
    agenda: ["Review active phase and execution issue progress.", "Find planning, approval, execution, and result blockers.", "Choose the exact phase, document, approval, or issue change."],
  },
  productivity_review: {
    label: "Productivity review",
    when: "Open productivity evidence shows long-active work, churn, cost, or weak next actions.",
    chair: "Responsible manager or direct operating head.",
    title: "Productivity review",
    agenda: ["Review no-comment streaks, churn, cost, and next actions.", "Identify stuck or underperforming ownership.", "Choose coaching, reassignment, split, or process correction."],
  },
  fiction_story_alignment: {
    label: "Fiction story alignment",
    when: "Fiction work needs coordinated research, character, plot, worldbuilding, or draft decisions.",
    chair: "Fiction Director with the relevant story specialists.",
    title: "Story alignment",
    agenda: ["Align research and classification.", "Resolve character, plot, and worldbuilding contradictions.", "Set exact draft and document updates."],
  },
  no_recent_meetings: {
    label: "No meeting activity",
    when: "Open work exists but no structured meeting was recorded in the last 7 days.",
    chair: "CEO with direct department or domain heads only.",
    title: "Operating review",
    agenda: ["Review goals, targets, KPIs, finance, and open work health.", "Review agent ownership, throughput, and quality.", "Assign process, workflow, memory, and priority corrections."],
  },
};

export const meetingWorkflowPolicy = {
  purpose: "Structured operating reviews turn business gaps into recorded decisions and first-class work.",
  chairRule: "Use the nearest operational owner. Reserve the CEO for company-wide cadence, critical escalation, or true multi-head coordination.",
  triggerRules: MEETING_TRIGGERS.map((id) => ({ id, ...TRIGGER_CONFIG[id], expectedOutputs: [...EXPECTED_OUTPUTS] })),
  lifecycle: [
    { status: "triggered", label: "Triggered", description: "A work gap requires a meeting." },
    { status: "pending", label: "Pending", description: "Participants receive the agenda and expected outputs." },
    { status: "answered", label: "Answered", description: "The meeting records its business review and decisions." },
    { status: "operationalized", label: "Operationalized", description: "Every actionable outcome is linked to first-class work." },
  ],
  doneDefinition: "Every action, blocker, correction, or useful idea is linked to an issue or explicitly closed as a decision or question.",
} as const;

export type MeetingRecommendationInput = {
  trigger: MeetingTrigger;
  issueId?: string | null;
  issueIdentifier?: string | null;
  issueTitle?: string | null;
  participantAgentIds?: string[];
};

function severity(trigger: MeetingTrigger): "urgent" | "warning" | "info" {
  if (trigger === "blocked_without_edge" || trigger === "failed_run_review") return "urgent";
  if (trigger === "fiction_story_alignment" || trigger === "no_recent_meetings") return "info";
  return "warning";
}

export function buildMeetingRecommendation(input: MeetingRecommendationInput) {
  const config = TRIGGER_CONFIG[input.trigger];
  const topic = [input.issueIdentifier, input.issueTitle].filter((value) => value?.trim()).join(" - ");
  const title = input.trigger === "no_recent_meetings"
    ? `${config.title}: company work health`
    : `${config.title}: ${topic || "unlabeled work"}`;
  return {
    trigger: input.trigger,
    severity: severity(input.trigger),
    title: title.length <= 120 ? title : `${title.slice(0, 117).trimEnd()}...`,
    issueId: input.issueId ?? null,
    participantAgentIds: [...new Set(input.participantAgentIds ?? [])],
    agenda: [...config.agenda],
    expectedOutputs: [...EXPECTED_OUTPUTS],
  };
}
