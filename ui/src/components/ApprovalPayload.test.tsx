// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalPayloadRenderer, approvalLabel } from "./ApprovalPayload";

vi.mock("@/lib/router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("approvalLabel", () => {
  it("uses payload titles for generic board approvals", () => {
    expect(
      approvalLabel("request_board_approval", {
        title: "Reply with an ASCII frog",
      }),
    ).toBe("Board Approval: Reply with an ASCII frog");
  });

  it("uses the phase title for campaign phase plan approvals", () => {
    expect(
      approvalLabel("campaign_phase_plan", {
        kind: "campaign_phase_plan",
        campaignTitle: "Readerbase fantasy world",
        phaseTitle: "Magical jobs",
      }),
    ).toBe("Campaign Phase Plan: Magical jobs");
  });
});

describe("ApprovalPayloadRenderer", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("renders request_board_approval payload fields without falling back to raw JSON", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="request_board_approval"
          payload={{
            title: "Reply with an ASCII frog",
            summary: "Board asked for approval before posting the frog.",
            recommendedAction: "Approve the frog reply.",
            nextActionOnApproval: "Post the frog comment on the issue.",
            risks: ["The frog might be too powerful."],
            proposedComment: "(o)<",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Reply with an ASCII frog");
    expect(container.textContent).toContain("Board asked for approval before posting the frog.");
    expect(container.textContent).toContain("Approve the frog reply.");
    expect(container.textContent).toContain("Post the frog comment on the issue.");
    expect(container.textContent).toContain("The frog might be too powerful.");
    expect(container.textContent).toContain("(o)<");
    expect(container.textContent).not.toContain("\"recommendedAction\"");

    act(() => {
      root.unmount();
    });
  });

  it("can hide the repeated title when the card header already shows it", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="request_board_approval"
          hidePrimaryTitle
          payload={{
            title: "Reply with an ASCII frog",
            summary: "Board asked for approval before posting the frog.",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Board asked for approval before posting the frog.");
    expect(container.textContent).not.toContain("TitleReply with an ASCII frog");

    act(() => {
      root.unmount();
    });
  });

  it("renders campaign phase plan context with a campaign link", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="campaign_phase_plan"
          payload={{
            kind: "campaign_phase_plan",
            campaignId: "campaign-1",
            campaignTitle: "Readerbase fantasy world",
            phaseId: "phase-1",
            phaseTitle: "Magical jobs",
            planDocumentId: "document-1",
            planRevisionId: "revision-123456789",
            assigneeAgentId: null,
            projectIds: ["project-1", "project-2"],
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Readerbase fantasy world");
    expect(container.textContent).toContain("Magical jobs");
    expect(container.textContent).toContain("2 linked projects");
    expect(container.textContent).toContain("revision...");
    const link = container.querySelector("a");
    expect(link?.textContent).toBe("Open campaign");
    expect(link?.getAttribute("href")).toBe("/campaigns/campaign-1");
    expect(container.textContent).not.toContain("\"campaignTitle\"");

    act(() => {
      root.unmount();
    });
  });
});
