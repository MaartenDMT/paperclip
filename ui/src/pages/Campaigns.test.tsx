// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, CampaignListItem, Project } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "./Campaigns";

const mockCampaignsApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
}));

const mockAgentsApi = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockProjectsApi = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockPushToast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
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

vi.mock("../api/projects", () => ({
  projectsApi: mockProjectsApi,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Ada",
    urlKey: "ada",
    role: "engineer",
    title: "Lead engineer",
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    companyId: "company-1",
    urlKey: "readerbase",
    goalId: null,
    goalIds: [],
    goals: [],
    name: "Readerbase",
    description: null,
    status: "in_progress",
    leadAgentId: null,
    targetDate: null,
    color: "#2563eb",
    env: null,
    pauseReason: null,
    pausedAt: null,
    executionWorkspacePolicy: null,
    codebase: {
      workspaceId: null,
      repoUrl: null,
      repoRef: null,
      defaultRef: null,
      repoName: null,
      localFolder: null,
      managedFolder: "",
      effectiveLocalFolder: "",
      origin: "managed_checkout",
    },
    workspaces: [],
    primaryWorkspace: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<CampaignListItem> = {}): CampaignListItem {
  return {
    id: "campaign-1",
    companyId: "company-1",
    goalId: null,
    leadAgentId: "agent-1",
    title: "Readerbase fantasy world",
    objective: "Ship a phased launch plan",
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
    phaseCount: 2,
    activePhase: {
      id: "phase-1",
      companyId: "company-1",
      campaignId: "campaign-1",
      sequenceNumber: 1,
      title: "Magical jobs",
      objective: null,
      status: "in_review",
      planDocumentId: null,
      resultDocumentId: null,
      approvalId: null,
      approvedPlanRevisionId: null,
      executionIssueId: null,
      assigneeAgentId: null,
      createdByAgentId: null,
      createdByUserId: null,
      updatedByAgentId: null,
      updatedByUserId: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
      assignee: null,
      planDocument: null,
      resultDocument: null,
      approval: null,
      executionIssue: null,
    },
    pendingReviewCount: 3,
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

describe("Campaigns", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null;
  let queryClient: QueryClient;

  async function renderCampaigns() {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Campaigns />
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
    mockCampaignsApi.list.mockResolvedValue([makeCampaign()]);
    mockCampaignsApi.create.mockResolvedValue({ id: "campaign-2" });
    mockAgentsApi.list.mockResolvedValue([makeAgent()]);
    mockProjectsApi.list.mockResolvedValue([makeProject()]);
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

  it("shows campaign list columns for company campaigns", async () => {
    await renderCampaigns();

    expect(container.textContent).toContain("Readerbase fantasy world");
    expect(container.textContent).toContain("active");
    expect(container.textContent).toContain("Readerbase");
    expect(container.textContent).toContain("1. Magical jobs");
    expect(container.textContent).toContain("Ada");
    expect(container.querySelector('a[href="/campaigns/campaign-1"]')).not.toBeNull();
  });

  it("creates a campaign with objective and selected projects", async () => {
    await renderCampaigns();

    const createButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Create campaign"));
    expect(createButton).toBeTruthy();
    await click(createButton!);

    await input(document.querySelector("#campaign-title") as HTMLInputElement, "Launch campaign");
    await input(document.querySelector("#campaign-objective") as HTMLTextAreaElement, "Coordinate launch work");

    const projectButton = [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Readerbase"));
    expect(projectButton).toBeTruthy();
    await click(projectButton!);

    const submitButton = [...document.querySelectorAll("button")]
      .reverse()
      .find((button) => button.textContent === "Create campaign");
    expect(submitButton).toBeTruthy();
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
    await click(submitButton!);

    expect(mockCampaignsApi.create).toHaveBeenCalledWith("company-1", {
      title: "Launch campaign",
      objective: "Coordinate launch work",
      projectIds: ["project-1"],
      leadAgentId: null,
      status: "draft",
    });

    await flushReact();
    await click(createButton!);

    expect((document.querySelector("#campaign-title") as HTMLInputElement).value).toBe("");
    expect((document.querySelector("#campaign-objective") as HTMLTextAreaElement).value).toBe("");
    expect(document.body.textContent).not.toContain("1 selected");
  });
});
