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
  /\b(?:fiction|short stor(?:y|ies)|novel|novella|saga|series|story[-\s]*sequence|sequence continuity|storybook|graphic novel|interactive fiction|manuscript|chapter|scene|plot|plotline|twists?|character|backstor(?:y|ies)|family|familie|friends?|enemies|lovers?|world vault|world of magic|story[-\s]*world|world[-\s]*level campaign|world\s*building|worldbuilding|lore|canon|continuity|locations?|countries|kingdoms?|empires?|alliances?|factions?|realms?|worlds?|magic system|power system|research classification|eval(?:uation)? gates?|illustrat(?:ion|ed|ions)?|critical[-\s]*event images?)\b/i;
const EXPLICIT_FICTION_SCOPE_RE =
  /\b(?:short fiction writer|novelist|novella writer|storybook creator|interactive fiction designer|graphic novel creator|manuscript quality architect|short stor(?:y|ies)|novel|novella|saga|graphic novel|interactive fiction|manuscript|draft\b.{0,80}\b(?:chapter|scene|stor(?:y|ies)|storybook)|rewrite\b.{0,80}\b(?:novel|novella|stor(?:y|ies)|storybook)|publish\b.{0,80}\b(?:manuscript|short stor(?:y|ies)|novel|novella|storybook)|story(?:book)?\b.{0,80}\b(?:release unit|manuscript|draft|rewrite|reader(?:sbase)?|critical[-\s]*event images?|sparse(?:ly)? illustrated|illustrat(?:ed|ion|ions)? novel)|(?:world vault|world of magic|story[-\s]*world)\b.{0,140}\b(?:series|sequence|campaign|lore|canon|continuity|worldbuilding|locations?|countries|empires?|alliances?|factions?|realms?|worlds?|magic system|plot|twists?|eval(?:uation)?))\b/i;
const LONG_FORM_SPARSE_ILLUSTRATION_RE =
  /\b(?:(?:long[-\s]*form|novel|chapter|chapters|200\+?|two hundred|hundreds? of|page|pages)\b.{0,120}\b(?:sparse(?:ly)? illustrated|critical[-\s]*event images?|key[-\s]*scene images?|interior images?|illustrations?|10 images|ten images)|(?:sparse(?:ly)? illustrated|critical[-\s]*event images?|key[-\s]*scene images?|interior images?|illustrations?|10 images|ten images)\b.{0,120}\b(?:long[-\s]*form|novel|chapter|chapters|200\+?|two hundred|hundreds? of|page|pages))\b/i;
const FICTION_VISUAL_STORY_SCOPE_RE =
  /\b(?:storybook|graphic novel|picture[-\s]*book|visual story|illustrat(?:ion|ed|ions)?|art plan|cover|thumbnail|spread|spreads|critical[-\s]*event images?|key[-\s]*scene images?|interior images?)\b/i;
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
  return isFictionDepartmentAgentId(issue.assigneeAgentId, input) ||
    EXPLICIT_FICTION_SCOPE_RE.test(issue.title) ||
    LONG_FORM_SPARSE_ILLUSTRATION_RE.test(text);
}
export function needsFictionVisualStoryParticipant(issue: FictionStoryAlignmentIssue) {
  return FICTION_VISUAL_STORY_SCOPE_RE.test([issue.title, issue.description ?? ""].join("\n"));
}
