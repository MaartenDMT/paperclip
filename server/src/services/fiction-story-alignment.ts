export type FictionStoryAlignmentAgent = {
  id: string;
  name: string | null;
  role: string | null;
  title: string | null;
  status: string | null;
  reportsTo: string | null;
};

export type FictionStoryAlignmentIssue = {
  title: string;
  description: string | null;
  assigneeAgentId: string | null;
};

const FICTION_STORY_SIGNAL_RE =
  /\b(?:fiction|short stor(?:y|ies)|novel|novella|storybook|graphic novel|interactive fiction|manuscript|chapter|scene|plot|character|backstor(?:y|ies)|family|familie|friends?|enemies|lovers?|world vault|story[-\s]*world|world\s*building|worldbuilding|research classification)\b/i;
const EXPLICIT_FICTION_SCOPE_RE =
  /\b(?:fiction|short stor(?:y|ies)|novel|novella|storybook|graphic novel|interactive fiction|manuscript|world vault|story[-\s]*world|world\s*building|worldbuilding)\b/i;
const FICTION_DIRECTOR_ROLE_KEYS = new Set(["fiction-director", "fiction_director", "creative-director", "creative_director"]);

function normalizeRoleText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "");
}

function isRunnableMeetingAgent(agent: FictionStoryAlignmentAgent | null | undefined) {
  return Boolean(agent && !["paused", "pending_approval", "terminated"].includes(agent.status ?? ""));
}

export function findFictionDirector(agents: FictionStoryAlignmentAgent[]) {
  return agents.find((agent) =>
    isRunnableMeetingAgent(agent) &&
    (
      FICTION_DIRECTOR_ROLE_KEYS.has(normalizeRoleText(agent.role)) ||
      FICTION_DIRECTOR_ROLE_KEYS.has(normalizeRoleText(agent.title)) ||
      normalizeRoleText(agent.name) === "fiction-director"
    )
  ) ?? null;
}

export function isFictionDepartmentAgentId(
  agentId: string | null | undefined,
  input: {
    fictionDirector: FictionStoryAlignmentAgent | null;
    agentById: Map<string, FictionStoryAlignmentAgent>;
  },
) {
  if (!input.fictionDirector || !agentId) return false;
  let current = input.agentById.get(agentId) ?? null;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.id === input.fictionDirector.id || current.reportsTo === input.fictionDirector.id) return true;
    seen.add(current.id);
    current = current.reportsTo ? input.agentById.get(current.reportsTo) ?? null : null;
  }
  return false;
}

export function isFictionStoryAlignmentIssue(
  issue: FictionStoryAlignmentIssue,
  input: {
    fictionDirector: FictionStoryAlignmentAgent | null;
    agentById: Map<string, FictionStoryAlignmentAgent>;
  },
) {
  const text = [issue.title, issue.description ?? ""].join("\n");
  if (!FICTION_STORY_SIGNAL_RE.test(text)) return false;
  return isFictionDepartmentAgentId(issue.assigneeAgentId, input) || EXPLICIT_FICTION_SCOPE_RE.test(text);
}
