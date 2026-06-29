import { describe, expect, it } from "vitest";
import type { IssueWorkProduct } from "@paperclipai/shared";
import { classifyIssueCompletionEvidence } from "../services/issue-completion-evidence.js";

function product(overrides: Partial<IssueWorkProduct>): IssueWorkProduct {
  return {
    id: overrides.id ?? "product-1",
    companyId: "company-1",
    projectId: null,
    issueId: "issue-1",
    executionWorkspaceId: null,
    runtimeServiceId: null,
    type: "document",
    provider: "paperclip",
    externalId: null,
    title: "Evidence",
    url: null,
    status: "active",
    reviewState: "none",
    isPrimary: false,
    healthStatus: "unknown",
    summary: null,
    metadata: null,
    createdByRunId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("classifyIssueCompletionEvidence", () => {
  it("flags done branch-only work as missing code review evidence", () => {
    const evidence = classifyIssueCompletionEvidence(
      { status: "done", originKind: "manual" },
      [product({ id: "branch-1", type: "branch", title: "Feature branch", status: "active" })],
    );

    expect(evidence).toMatchObject({
      kind: "code_review_missing",
      prExpected: true,
      hasCodeChangeEvidence: true,
      hasCompletionEvidence: false,
      blockingWorkProductIds: ["branch-1"],
    });
  });

  it("classifies merged PR evidence as code shipped", () => {
    const evidence = classifyIssueCompletionEvidence(
      { status: "done", originKind: "manual" },
      [
        product({ id: "branch-1", type: "branch", status: "active" }),
        product({ id: "pr-1", type: "pull_request", provider: "github", status: "merged" }),
      ],
    );

    expect(evidence).toMatchObject({
      kind: "code_shipped",
      prExpected: true,
      hasPullRequest: true,
      hasCompletionEvidence: true,
      evidenceWorkProductIds: ["pr-1"],
      blockingWorkProductIds: [],
    });
  });

  it("classifies recovery/productivity/plugin operation done issues as operational without PR expectation", () => {
    for (const originKind of ["stranded_issue_recovery", "issue_productivity_review", "plugin:paperclip.test:operation"]) {
      const evidence = classifyIssueCompletionEvidence({ status: "done", originKind }, []);

      expect(evidence).toMatchObject({
        kind: "operational",
        prExpected: false,
        hasOperationalOrigin: true,
      });
    }
  });

  it("classifies manual worktree/runtime repair issues as operational without PR expectation", () => {
    const evidence = classifyIssueCompletionEvidence(
      {
        status: "done",
        originKind: "manual",
        title: "Restore Readersbase production worktree",
        description: "Recovered the checkout and verified pnpm dev starts again.",
      },
      [],
    );

    expect(evidence).toMatchObject({
      kind: "operational",
      prExpected: false,
      hasOperationalOrigin: true,
    });
    expect(evidence.reasons.join(" ")).toContain("operational");
  });

  it("classifies manual production verification and QA evidence issues as operational", () => {
    const evidence = classifyIssueCompletionEvidence(
      {
        status: "done",
        originKind: "manual",
        title: "Verify production behavior after deployment",
        description: "Recorded QA evidence for the deployed Readersbase runtime.",
      },
      [],
    );

    expect(evidence).toMatchObject({
      kind: "operational",
      prExpected: false,
      hasCodeChangeEvidence: false,
    });
  });

  it("classifies manual stale-blocker routing issues as operational", () => {
    const evidence = classifyIssueCompletionEvidence(
      {
        status: "done",
        originKind: "manual",
        title: "Clear stale blocker and route work to the owning agent",
        description: "Closed the stale-run review and reassigned the remaining follow-up.",
      },
      [],
    );

    expect(evidence).toMatchObject({
      kind: "operational",
      prExpected: false,
      hasOperationalOrigin: true,
    });
  });

  it("classifies manual workflow and credential unblockers as operational", () => {
    for (const issue of [
      {
        title: "Workflow correction: meeting_workflow",
        description: "Operationalize meeting workflow correction and restore the lane state.",
      },
      {
        title: "CTO/local-board: reset REA-1856 to todo and wake Fiction Director",
        description: "Board-only correction for a paused owner.",
      },
      {
        title: "Railway CLI auth invalid_grant blocks DevOps deployment evidence commands",
        description: "Restore Railway auth so deployment evidence commands can run.",
      },
      {
        title: "Rotate invalid Cloudflare API token for readersbase.com purge",
        description: "Resolved cache purge credentials for production operations.",
      },
      {
        title: "REA-3785 blocker: restore frontend verification execution path",
        description: "Blocked by process_lost/no-live-execution recovery while it owns frontend verification.",
      },
      {
        title: "REA-1516-D: Analytics Verification",
        description: "Snapshot events and funnel and confirm analytics shows events for the run window.",
      },
    ]) {
      const evidence = classifyIssueCompletionEvidence(
        {
          status: "done",
          originKind: "manual",
          ...issue,
        },
        [],
      );

      expect(evidence).toMatchObject({
        kind: "operational",
        prExpected: false,
        hasOperationalOrigin: true,
      });
    }
  });

  it("does not let operational wording hide branch-only code evidence", () => {
    const evidence = classifyIssueCompletionEvidence(
      {
        status: "done",
        originKind: "manual",
        title: "Verify production behavior after deployment",
      },
      [product({ id: "branch-1", type: "branch", status: "active" })],
    );

    expect(evidence).toMatchObject({
      kind: "code_review_missing",
      prExpected: true,
      blockingWorkProductIds: ["branch-1"],
    });
  });

  it("keeps bland manual done issues unknown without structured evidence", () => {
    const evidence = classifyIssueCompletionEvidence(
      {
        status: "done",
        originKind: "manual",
        title: "Complete manual follow-up",
        description: "Resolved based on the latest context.",
      },
      [],
    );

    expect(evidence).toMatchObject({
      kind: "unknown",
      prExpected: false,
      hasCompletionEvidence: false,
    });
  });

  it("classifies manual non-code domain deliverables as no-PR completions", () => {
    for (const issue of [
      {
        title: "Content Writer: draft body copy and CTAs for community update campaign",
        description: "Drafted email, blog, and in-app copy.",
      },
      {
        title: "Fiction Director: approve Seventeen Minutes for marketing launch",
        description: "Reviewed the story and approved launch positioning.",
      },
      {
        title: "Support Triage: classify incoming reader and creator feedback",
        description: "Classified feedback and drafted response templates.",
      },
      {
        title: "Interaction spec: crawlable hero and fallback states for public discover",
        description: "Create the implementation-ready interaction spec for no-JS crawler-facing states.",
      },
      {
        title: "Draft launch funnel measurement requirements",
        description: "Define the measurement plan for discover to signup analytics.",
      },
      {
        title: "Plot Architect: Psychological Thriller short story",
        description: "Plot Architect gate with plot grid and chapter-beat plan.",
      },
      {
        title: "Continuation follow-up for REA-2179",
        description: "Track continuation work for the next cycle after recovery.",
      },
      {
        title: "better storage system",
        description: "How are jpeg covers, project vaults, works, artifacts, and markdown files being saved?",
      },
      {
        title: "readersbase admin",
        description: "Create an admin called readersbase and start posting useful posts for SEO scores.",
      },
    ]) {
      const evidence = classifyIssueCompletionEvidence(
        {
          status: "done",
          originKind: "manual",
          ...issue,
        },
        [],
      );

      expect(evidence).toMatchObject({
        kind: "non_code_completion",
        prExpected: false,
        hasCodeChangeEvidence: false,
        hasCompletionEvidence: false,
      });
    }
  });

  it("flags likely code-shipping done issues with no structured evidence", () => {
    for (const issue of [
      {
        title: "Fix reader login 500",
        description: "Changed the backend route handler and updated tests.",
      },
      {
        title: "Search page shows completely empty state before user types",
        description: "Add a default book grid on the public search page.",
      },
      {
        title: "Mobile: Clear Filters button below 44px tap target on search and discover",
        description: "AdvancedSearchPage and ReaderDiscoverPage render the control too small.",
      },
      {
        title: "Fix title-specific SEO/OG metadata for interactive story pages",
        description: "Story-specific metadata is missing.",
      },
      {
        title: "REA-3282-BE: Implement cross-story dependency data model and API",
        description: "Ship durable cross-story dependency model for World Vault continuity.",
      },
      {
        title: "graphic not working",
        description: "Use Playwright to get visual evidence and redesign the graphic novel optimization.",
      },
    ]) {
      const evidence = classifyIssueCompletionEvidence(
        {
          status: "done",
          originKind: "manual",
          ...issue,
        },
        [],
      );

      expect(evidence).toMatchObject({
        kind: "code_review_missing",
        prExpected: true,
        hasCodeChangeEvidence: false,
        hasCompletionEvidence: false,
        blockingWorkProductIds: [],
      });
    }
  });

  it("keeps manual done issues without structured evidence unknown instead of assuming no PR is needed", () => {
    const evidence = classifyIssueCompletionEvidence({ status: "done", originKind: "manual" }, []);

    expect(evidence).toMatchObject({
      kind: "unknown",
      prExpected: false,
      hasCompletionEvidence: false,
    });
  });
});
