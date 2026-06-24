import { describe, expect, it } from "vitest";
import {
  findFictionDirector,
  isFictionStoryAlignmentIssue,
  type FictionStoryAlignmentAgent,
} from "./fiction-story-alignment.js";

const fictionDirectorId = "fiction-director";
const shortFictionWriterId = "short-fiction-writer";
const engineerId = "engineer";

const agents: FictionStoryAlignmentAgent[] = [
  {
    id: fictionDirectorId,
    name: "Fiction Director",
    role: "fiction_director",
    title: null,
    status: "active",
    reportsTo: null,
  },
  {
    id: shortFictionWriterId,
    name: "Short Fiction Writer",
    role: "short_fiction_writer",
    title: null,
    status: "active",
    reportsTo: fictionDirectorId,
  },
  {
    id: engineerId,
    name: "Backend Developer",
    role: "backend_developer",
    title: null,
    status: "active",
    reportsTo: null,
  },
];

const fictionDirector = findFictionDirector(agents);
const agentById = new Map(agents.map((agent) => [agent.id, agent]));

describe("fiction story alignment scope", () => {
  it("accepts fiction-owned drafting work", () => {
    expect(isFictionStoryAlignmentIssue({
      title: "Draft chapter setup with character backstories and plot alignment",
      description: "Coordinate research classification, family history, worldbuilding, and plot changes.",
      assigneeAgentId: shortFictionWriterId,
    }, { fictionDirector, agentById })).toBe(true);
  });

  it("rejects product and infrastructure wording that only looks like writing", () => {
    for (const title of [
      "REA-3709 blocker: verify R2 bypass and draft-write billing disposition",
      "Add Start Writing CTA to homepage for author conversion",
      "Prevent MarkdownEditor open from auto-saving frontmatter or content without edits",
      "Deploy: rebuild static SEO pages for interactive story skeleton",
    ]) {
      expect(isFictionStoryAlignmentIssue({
        title,
        description: "Product or infrastructure work, not fiction production.",
        assigneeAgentId: engineerId,
      }, { fictionDirector, agentById })).toBe(false);
    }
  });
});
