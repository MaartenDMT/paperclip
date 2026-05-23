import { describe, expect, it } from "vitest";
import { createIssueThreadInteractionSchema, respondIssueThreadInteractionSchema } from "./validators/issue.js";

describe("issue thread interaction schemas", () => {
  it("parses request_confirmation payloads with default no-wake continuation", () => {
    const parsed = createIssueThreadInteractionSchema.parse({
      kind: "request_confirmation",
      payload: {
        version: 1,
        prompt: "Apply this plan?",
        acceptLabel: "Apply",
        rejectLabel: "Revise",
        rejectRequiresReason: true,
        rejectReasonLabel: "What needs to change?",
        declineReasonPlaceholder: "Optional: tell the agent what you'd change.",
        detailsMarkdown: "The current plan document will be accepted as-is.",
        supersedeOnUserComment: true,
      },
    });

    expect(parsed).toMatchObject({
      kind: "request_confirmation",
      continuationPolicy: "none",
      payload: {
        prompt: "Apply this plan?",
        acceptLabel: "Apply",
        rejectLabel: "Revise",
        rejectRequiresReason: true,
        rejectReasonLabel: "What needs to change?",
        allowDeclineReason: true,
        declineReasonPlaceholder: "Optional: tell the agent what you'd change.",
        supersedeOnUserComment: true,
      },
    });
  });

  it("parses structured agent meeting interactions", () => {
    const parsed = createIssueThreadInteractionSchema.parse({
      kind: "agent_meeting",
      title: "Cover incident triage",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        purpose: "Decide owner and next tasks for the cover-image incident.",
        participantAgentIds: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
        agenda: ["Review evidence", "Choose owner", "Create follow-up tasks"],
        expectedOutputs: ["decisions", "tasks", "blockers", "memory_corrections", "idea_sharing"],
      },
    });

    expect(parsed.kind).toBe("agent_meeting");
    if (parsed.kind !== "agent_meeting") return;
    expect(parsed.payload.expectedOutputs).toEqual(["decisions", "tasks", "blockers", "memory_corrections", "idea_sharing"]);
  });

  it("parses rich agent meeting results with memory and workflow corrections", () => {
    const parsed = respondIssueThreadInteractionSchema.parse({
      meetingResult: {
        version: 1,
        summaryMarkdown: "We are at risk, but the fix path is clear.",
        decisions: ["Keep the current owner and add a memory correction follow-up."],
        actionItems: [{
          title: "Create a child issue for the workflow correction",
          ownerAgentId: null,
          issueId: null,
        }],
        blockers: [],
        openQuestions: ["Should para-memory keep this as an evergreen rule?"],
        rightTrack: {
          status: "at_risk",
          rationale: "The issue is valid, but stale memory is causing repeated wrong writes.",
          corrections: ["Update the affected memory file before the next implementation run."],
        },
        workflowCorrections: [{
          summary: "Require agents to verify memory writes after updating meeting notes.",
          target: "meeting workflow",
          issueId: null,
        }],
        memoryCorrections: [{
          system: "karpathy-memory",
          filePath: "memory/agents/meetings.md",
          correction: "The previous meeting note points at the wrong owner.",
          rationale: "Agents are using that stale owner in follow-up tasks.",
          issueId: null,
        }],
        ideas: [{
          title: "Meeting digest",
          summary: "Create a lightweight digest issue after cross-agent meetings.",
          ownerAgentId: null,
          issueId: null,
        }],
      },
    });

    expect(parsed.meetingResult?.rightTrack?.status).toBe("at_risk");
    expect(parsed.meetingResult?.memoryCorrections?.[0]?.system).toBe("karpathy-memory");
    expect(parsed.meetingResult?.ideas?.[0]?.title).toBe("Meeting digest");
  });

  it("accepts issue document targets for request_confirmation interactions", () => {
    const parsed = createIssueThreadInteractionSchema.parse({
      kind: "request_confirmation",
      continuationPolicy: "wake_assignee_on_accept",
      payload: {
        version: 1,
        prompt: "Accept the latest plan revision?",
        allowDeclineReason: false,
        target: {
          type: "issue_document",
          issueId: "11111111-1111-4111-8111-111111111111",
          documentId: "22222222-2222-4222-8222-222222222222",
          key: "plan",
          revisionId: "33333333-3333-4333-8333-333333333333",
          revisionNumber: 2,
          label: "Plan v2",
          href: "/issues/PAP-123#document-plan",
        },
      },
    });

    expect(parsed.kind).toBe("request_confirmation");
    if (parsed.kind !== "request_confirmation") return;
    expect(parsed.payload.target).toMatchObject({
      type: "issue_document",
      key: "plan",
      revisionNumber: 2,
      label: "Plan v2",
      href: "/issues/PAP-123#document-plan",
    });
  });

  it("accepts custom targets for request_confirmation interactions", () => {
    const parsed = createIssueThreadInteractionSchema.parse({
      kind: "request_confirmation",
      payload: {
        version: 1,
        prompt: "Proceed with the external checklist?",
        target: {
          type: "custom",
          key: "external-checklist",
          revisionId: "checklist-v1",
          revisionNumber: 1,
          label: "Checklist v1",
          href: "https://example.com/checklist",
        },
      },
    });

    expect(parsed.kind).toBe("request_confirmation");
    if (parsed.kind !== "request_confirmation") return;
    expect(parsed.payload.target).toMatchObject({
      type: "custom",
      key: "external-checklist",
      label: "Checklist v1",
    });
  });

  it("rejects unsafe request_confirmation target hrefs", () => {
    const base = {
      kind: "request_confirmation",
      payload: {
        version: 1,
        prompt: "Proceed?",
        target: {
          type: "custom",
          key: "external-checklist",
          revisionId: "checklist-v1",
          label: "Checklist v1",
        },
      },
    } as const;

    for (const href of ["javascript:alert(1)", "data:text/html,hi", "//evil.example/path"]) {
      expect(() => createIssueThreadInteractionSchema.parse({
        ...base,
        payload: {
          ...base.payload,
          target: {
            ...base.payload.target,
            href,
          },
        },
      })).toThrow("href must not use javascript:, data:, or protocol-relative URLs");
    }
  });
});
