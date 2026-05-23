type RoutineSeedAgent = {
  id: string;
  name: string;
  role: string;
  status: string;
};

type ExistingRoutineSeed = {
  title: string;
};

export type DepartmentRoutinePlan = {
  title: string;
  description: string;
  assigneeAgentId: string;
  projectId: string | null;
  goalId: string | null;
  priority: "critical" | "high" | "medium" | "low";
  concurrencyPolicy: "coalesce_if_active" | "always_enqueue" | "skip_if_active";
  catchUpPolicy: "skip_missed" | "enqueue_missed_with_cap";
  trigger: {
    kind: "schedule";
    label: string;
    cronExpression: string;
  };
};

const ACTIVE_AGENT_STATUSES = new Set(["active", "idle", "running", "error"]);

const DEPARTMENT_ROUTINE_TEMPLATES: Record<string, Omit<DepartmentRoutinePlan, "assigneeAgentId" | "projectId" | "goalId">> = {
  ceo: {
    title: "Production cycle: daily operating review",
    description: [
      "Review the company goal, active work, blockers, budget pressure, and department throughput.",
      "Create or update concrete issues for the next actions, assign exactly one owner per issue, and leave a board-readable summary of decisions and risks.",
      "Keep the production cycle moving: plan, assign, execute, review, ship, and repeat.",
    ].join("\n\n"),
    priority: "high",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    trigger: { kind: "schedule", label: "weekday production review", cronExpression: "30 8 * * 1-5" },
  },
  cto: {
    title: "Engineering: delivery and blocker review",
    description: "Review active engineering issues, unblock stuck work, ensure PR/build/test evidence exists, and create follow-up tasks for the highest-value technical work.",
    priority: "high",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    trigger: { kind: "schedule", label: "weekday engineering review", cronExpression: "0 9 * * 1-5" },
  },
  pm: {
    title: "Product: scope and acceptance review",
    description: "Review product goals, clarify acceptance criteria, split ambiguous work, and move ready work into the next execution step.",
    priority: "high",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    trigger: { kind: "schedule", label: "weekday product review", cronExpression: "0 10 * * 1-5" },
  },
  cmo: {
    title: "Growth: pipeline and distribution review",
    description: "Review acquisition experiments, content/distribution tasks, metrics, and follow-ups. Convert insights into owned tasks with clear output expectations.",
    priority: "medium",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    trigger: { kind: "schedule", label: "growth review", cronExpression: "0 11 * * 1,3,5" },
  },
  cfo: {
    title: "Finance: budget and burn review",
    description: "Review model spend, budget incidents, forecast risk, and cost anomalies. Create work for budget fixes or board decisions before hard stops surprise the company.",
    priority: "medium",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    trigger: { kind: "schedule", label: "finance review", cronExpression: "30 9 * * 1,3,5" },
  },
  devops: {
    title: "Operations: reliability and runtime review",
    description: "Review runtime health, failed runs, deployment blockers, workspace services, and recovery issues. Create concrete remediation tasks for repeated failures.",
    priority: "high",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    trigger: { kind: "schedule", label: "weekday operations review", cronExpression: "0 12 * * 1-5" },
  },
  qa: {
    title: "Quality: verification and regression review",
    description: "Review recently completed work for missing verification, flaky checks, unresolved review loops, and regression risk. Create focused follow-up issues.",
    priority: "medium",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    trigger: { kind: "schedule", label: "quality review", cronExpression: "0 14 * * 2,4" },
  },
  security: {
    title: "Security: risk and access review",
    description: "Review permissions, exposed integrations, secret handling, public endpoints, and recent changes. Create risk-reduction tasks with evidence requirements.",
    priority: "medium",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    trigger: { kind: "schedule", label: "security review", cronExpression: "30 14 * * 2,4" },
  },
  designer: {
    title: "Design: UX feedback and polish review",
    description: "Review active product surfaces, user-facing copy, accessibility gaps, and polish issues. Convert findings into small owned tasks.",
    priority: "medium",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    trigger: { kind: "schedule", label: "design review", cronExpression: "0 13 * * 2,4" },
  },
  researcher: {
    title: "Research: market and evidence review",
    description: "Review research questions, competitor changes, customer evidence, and open assumptions. Produce concise findings and create decision-driving follow-ups.",
    priority: "medium",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    trigger: { kind: "schedule", label: "research review", cronExpression: "0 15 * * 1,3" },
  },
};

function normalizeTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildMissingDepartmentRoutinePlans(input: {
  agents: RoutineSeedAgent[];
  existingRoutines: ExistingRoutineSeed[];
  projectId: string | null;
  goalId: string | null;
}): DepartmentRoutinePlan[] {
  const existingTitles = new Set(input.existingRoutines.map((routine) => normalizeTitle(routine.title)));
  const plans: DepartmentRoutinePlan[] = [];
  const seenRoles = new Set<string>();

  for (const agent of input.agents) {
    const role = agent.role.trim().toLowerCase();
    if (seenRoles.has(role) || !ACTIVE_AGENT_STATUSES.has(agent.status)) continue;
    const template = DEPARTMENT_ROUTINE_TEMPLATES[role];
    if (!template || existingTitles.has(normalizeTitle(template.title))) continue;
    seenRoles.add(role);
    plans.push({
      ...template,
      assigneeAgentId: agent.id,
      projectId: input.projectId,
      goalId: input.goalId,
    });
  }

  return plans;
}
