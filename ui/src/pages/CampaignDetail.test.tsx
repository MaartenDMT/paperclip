// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CampaignDetail, CampaignPhaseDetail } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignDetail as CampaignDetailPage } from "./CampaignDetail";

const mockCampaignsApi = vi.hoisted(() => ({
  get: vi.fn(),
  createPhase: vi.fn(),
  upsertPlan: vi.fn(),
  submitPlan: vi.fn(),
}));

const mockAgentsApi = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockPushToast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useParams: () => ({ campaignId: "campaign-1" }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }),
}));

vi.mock("../context/ToastContext", () => ({
  useToastActions: () => ({ pushToast: mockPushToast }),
}));

vi.mock("../api/campaigns", () => ({
  campaignsApi: mockCampaignsApi,
}));

vi.mock("../api/agents", () => ({
  agentsApi: mockAgentsApi,
}));

vi.mock("../components/MarkdownEditor", () => ({
  MarkdownEditor: ({ value, onChange, placeholder }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label={placeholder ?? "Markdown editor"}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));

vi.mock("../components/MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: string }) => <div>{children}</div>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makePhase(overrides: Partial<CampaignPhaseDetail> = {}): CampaignPhaseDetail {
  return {
    id: "phase-1",
    companyId: "company-1",
    campaignId: "campaign-1",
    sequenceNumber: 1,
    title: "Magical jobs",
    objective: "Plan the first launch slice",
    status: "planning",
    planDocumentId: "doc-1",
    resultDocumentId: null,
    approvalId: null,
    approvedPlanRevisionId: null,
    executionIssueId: null,
    assigneeAgentId: "agent-1",
    createdByAgentId: null,
    createdByUserId: null,
    updatedByAgentId: null,
    updatedByUserId: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    assignee: { id: "agent-1", name: "Ada", role: "engineer", title: "Lead engineer" },
    planDocument: {
      id: "doc-1",
      title: "Plan",
      format: "markdown",
      latestBody: "## Plan\n\nBuild the job taxonomy.",
      latestRevisionId: "revision-1",
      latestRevisionNumber: 1,
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    },
    resultDocument: null,
    approval: null,
    executionIssue: null,
    taskProgress: null,
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<CampaignDetail> = {}): CampaignDetail {
  return {
    id: "campaign-1",
    companyId: "company-1",
    goalId: null,
    leadAgentId: "agent-1",
    title: "Readerbase fantasy world",
    objective: "Ship a phased fantasy-world launch.",
    status: "active",
    createdByAgentId: null,
    createdByUserId: null,
    updatedByAgentId: null,
    updatedByUserId: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    projects: [
      { id: "project-1", name: "Readerbase", description: null, status: "in_progress", color: "#2563eb" },
    ],
    leadAgent: { id: "agent-1", name: "Ada", role: "engineer", title: "Lead engineer" },
    phaseCount: 1,
    activePhase: null,
    pendingReviewCount: 0,
    phases: [makePhase()],
    ...overrides,
  };
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flushReact();
}

async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    valueSetter?.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flushReact();
}

describe("CampaignDetail", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null;
  let queryClient: QueryClient;

  async function renderCampaignDetail() {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <CampaignDetailPage />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockCampaignsApi.get.mockResolvedValue(makeCampaign());
    mockCampaignsApi.createPhase.mockResolvedValue(makePhase({ id: "phase-2", sequenceNumber: 2 }));
    mockCampaignsApi.upsertPlan.mockResolvedValue({
      id: "doc-1",
      title: "Plan",
      format: "markdown",
      latestBody: "Updated plan",
      latestRevisionId: "revision-2",
      latestRevisionNumber: 2,
      updatedAt: new Date("2026-01-03T00:00:00Z"),
    });
    mockCampaignsApi.submitPlan.mockResolvedValue({
      phase: makePhase({ status: "in_review" }),
      approval: { id: "approval-1" },
      planRevision: { id: "revision-2" },
    });
    mockAgentsApi.list.mockResolvedValue([
      { id: "agent-1", name: "Ada", role: "engineer", title: "Lead engineer" },
      { id: "agent-2", name: "Grace", role: "planner", title: "Planner" },
    ]);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    queryClient.clear();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows campaign header and phase plan review controls for a planning phase", async () => {
    await renderCampaignDetail();

    expect(container.textContent).toContain("Readerbase fantasy world");
    expect(container.textContent).toContain("Readerbase");
    expect(container.textContent).toContain("active");
    expect(container.textContent).toContain("Ada");
    expect(container.textContent).toContain("Ship a phased fantasy-world launch.");
    expect(container.textContent).toContain("1. Magical jobs");
    expect(container.textContent).toContain("Plan the first launch slice");
    expect(container.textContent).toContain("Build the job taxonomy.");

    const editor = container.querySelector("textarea[aria-label='Phase plan body']") as HTMLTextAreaElement;
    expect(editor.value).toContain("Build the job taxonomy.");
    await input(editor, "## Plan\n\nUpdated taxonomy.");

    const saveButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save plan"));
    const submitButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Submit plan"));
    expect(saveButton).toBeTruthy();
    expect(submitButton).toBeTruthy();

    await click(saveButton!);
    expect(mockCampaignsApi.upsertPlan).toHaveBeenCalledWith("phase-1", {
      body: "## Plan\n\nUpdated taxonomy.",
      changeSummary: "Updated phase plan from board",
    });

    await click(submitButton!);
    expect(mockCampaignsApi.submitPlan).toHaveBeenCalledWith("phase-1");
  });

  it("saves the current editor body before submitting a plan for review", async () => {
    await renderCampaignDetail();

    const editor = container.querySelector("textarea[aria-label='Phase plan body']") as HTMLTextAreaElement;
    await input(editor, "## Plan\n\nSubmit this draft.");

    const submitButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Submit plan")) as HTMLButtonElement;
    expect(submitButton).toBeTruthy();
    await click(submitButton);

    expect(mockCampaignsApi.upsertPlan).toHaveBeenCalledWith("phase-1", {
      body: "## Plan\n\nSubmit this draft.",
      changeSummary: "Updated phase plan from board",
    });
    expect(mockCampaignsApi.submitPlan).toHaveBeenCalledWith("phase-1");
    expect(mockCampaignsApi.upsertPlan.mock.invocationCallOrder[0]).toBeLessThan(
      mockCampaignsApi.submitPlan.mock.invocationCallOrder[0],
    );
  });

  it("disables submit while saving a plan", async () => {
    let resolveSave: (value: unknown) => void = () => {};
    mockCampaignsApi.upsertPlan.mockReturnValueOnce(new Promise((resolve) => {
      resolveSave = resolve;
    }));

    await renderCampaignDetail();

    const saveButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save plan")) as HTMLButtonElement;
    const submitButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Submit plan")) as HTMLButtonElement;
    await click(saveButton);

    expect(submitButton.disabled).toBe(true);

    resolveSave({
      id: "doc-1",
      title: "Plan",
      format: "markdown",
      latestBody: "Saved plan",
      latestRevisionId: "revision-2",
      latestRevisionNumber: 2,
      updatedAt: new Date("2026-01-03T00:00:00Z"),
    });
    await flushReact();
  });

  it("shows approval state and execution issue link for an executing phase", async () => {
    mockCampaignsApi.get.mockResolvedValue(makeCampaign({
      phases: [
        makePhase({
          title: "Executing approved phase",
          status: "executing",
          approvalId: "approval-1",
          approval: {
            id: "approval-1",
            companyId: "company-1",
            type: "campaign_phase_plan",
            requestedByAgentId: null,
            requestedByUserId: "board",
            status: "approved",
            payload: {},
            decisionNote: null,
            decidedByUserId: "board",
            decidedAt: new Date("2026-01-02T00:00:00Z"),
            createdAt: new Date("2026-01-01T00:00:00Z"),
            updatedAt: new Date("2026-01-02T00:00:00Z"),
          },
          executionIssueId: "issue-1",
          executionIssue: {
            id: "issue-1",
            identifier: "PAP-123",
            title: "Execute magical jobs",
            status: "in_progress",
            priority: "medium",
            updatedAt: new Date("2026-01-02T00:00:00Z"),
          },
          taskProgress: {
            source: "subtree",
            totalCount: 4,
            openCount: 3,
            completedCount: 1,
            cancelledCount: 0,
            statusCounts: {
              backlog: 0,
              todo: 2,
              in_progress: 1,
              in_review: 0,
              done: 1,
              blocked: 0,
              cancelled: 0,
            },
            nextIssues: [
              {
                id: "issue-2",
                identifier: "PAP-124",
                title: "Implement phase task rollup",
                status: "in_progress",
                priority: "high",
                updatedAt: new Date("2026-01-03T00:00:00Z"),
              },
              {
                id: "issue-3",
                identifier: "PAP-125",
                title: "Wire next todo visibility",
                status: "todo",
                priority: "medium",
                updatedAt: new Date("2026-01-02T00:00:00Z"),
              },
            ],
          },
        }),
      ],
    }));

    await renderCampaignDetail();

    expect(container.textContent).toContain("Executing approved phase");
    expect(container.textContent).toContain("Phase work map");
    expect(container.textContent).toContain("Implementation status and next work per phase");
    expect(container.textContent).toContain("Approval approval-1");
    expect(container.textContent).toContain("approved");
    expect(container.textContent).toContain("1/4 done");
    expect(container.textContent).toContain("25%");
    expect(container.textContent).toContain("Tracking mapped tasks; 3 still open.");
    expect(container.textContent).toContain("3 open");
    expect(container.textContent).toContain("Next: PAP-124 - Implement phase task rollup");
    expect(container.textContent).toContain("Implement phase task rollup");
    expect(container.textContent).toContain("Wire next todo visibility");
    expect(container.querySelector('a[href="/approvals/approval-1"]')?.textContent).toContain("Open approval");
    expect(container.querySelector('a[href="/issues/PAP-123"]')?.textContent).toContain("Open execution issue");
    expect(container.querySelector('a[href="/issues/PAP-124"]')?.textContent).toContain("Implement phase task rollup");
  });

  it("creates a phase with title, objective, assignee, and initial plan", async () => {
    await renderCampaignDetail();

    const addButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Add phase"));
    expect(addButton).toBeTruthy();
    await click(addButton!);

    await input(container.querySelector("#campaign-phase-title") as HTMLInputElement, "Launch outreach");
    await input(container.querySelector("#campaign-phase-objective") as HTMLTextAreaElement, "Coordinate launch copy.");
    await input(container.querySelector("#campaign-phase-plan") as HTMLTextAreaElement, "## Plan\n\nDraft emails.");

    const assignee = container.querySelector("#campaign-phase-assignee") as HTMLSelectElement;
    await act(async () => {
      assignee.value = "agent-2";
      assignee.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushReact();

    const createButton = [...container.querySelectorAll("button")]
      .reverse()
      .find((button) => button.textContent?.includes("Create phase"));
    expect(createButton).toBeTruthy();
    await click(createButton!);

    expect(mockCampaignsApi.createPhase).toHaveBeenCalledWith("campaign-1", {
      title: "Launch outreach",
      objective: "Coordinate launch copy.",
      assigneeAgentId: "agent-2",
      planBody: "## Plan\n\nDraft emails.",
    });
  });
});
