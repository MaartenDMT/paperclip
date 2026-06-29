import { describe, expect, it } from "vitest";
import {
  findFictionDirector,
  isFictionStoryAlignmentIssue,
  needsFictionVisualStoryParticipant,
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
  it("accepts unassigned World Vault work when it carries campaign-scale lore scope", () => {
    expect(isFictionStoryAlignmentIssue({
      title: "World Vault: expand World of Magic series campaign lore",
      description: "Plan sequence continuity, locations, countries, alliances, empire politics, multiple worlds, twist escalation, and evaluation gates.",
      assigneeAgentId: null,
    }, { fictionDirector, agentById })).toBe(true);
  });

  it("rejects product and infrastructure wording that only looks like writing", () => {
    for (const title of [
      "REA-3709 blocker: verify R2 bypass and draft-write billing disposition",
      "Add Start Writing CTA to homepage for author conversion",
      "Prevent MarkdownEditor open from auto-saving frontmatter or content without edits",
      "Deploy: rebuild static SEO pages for interactive story skeleton",
      "Fix author left-panel project/vault sync for World Vault project and work routes",
      "Backend owner needed: repair Avarran interactive runtime publication linkage",
      "Create super-detailed storybooks for the project",
    ]) {
      expect(isFictionStoryAlignmentIssue({
        title,
        description:
          "Product or infrastructure work, not fiction production. Prior routing mentioned Interactive Fiction Designer.",
        assigneeAgentId: engineerId,
      }, { fictionDirector, agentById })).toBe(false);
    }
  });

  it("accepts long-form storybook work with sparse critical-event images", () => {
    const issue = {
      title: "Long-form storybook: plan 200 pages with 10 critical-event images for the novel",
      description: "ReadersBase fiction production should reserve illustrations for key scenes, not every page.",
      assigneeAgentId: null,
    };

    expect(isFictionStoryAlignmentIssue(issue, { fictionDirector, agentById })).toBe(true);
    expect(needsFictionVisualStoryParticipant(issue)).toBe(true);
  });

  it("does not treat sparse image wording alone as fiction production", () => {
    expect(isFictionStoryAlignmentIssue({
      title: "Optimize image pagination so 200-page docs only load 10 critical thumbnails",
      description: null,
      assigneeAgentId: engineerId,
    }, { fictionDirector, agentById })).toBe(false);
  });

  it("accepts explicitly named fiction production work even before assignment", () => {
    expect(isFictionStoryAlignmentIssue({
      title: "Short Fiction Writer: publish The Bell Under Blackwater Chapel after manuscript gate",
      description: null,
      assigneeAgentId: null,
    }, { fictionDirector, agentById })).toBe(true);
  });
});
