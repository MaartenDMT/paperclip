import { describe, expect, it } from "vitest";
import {
  applyCompanyPrefix,
  extractCompanyPrefixFromPath,
  isBoardPathWithoutPrefix,
  toCompanyRelativePath,
} from "./company-routes";

describe("company routes", () => {
  it("treats execution workspace paths as board routes that need a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/execution-workspaces/workspace-123")).toBe(true);
    expect(isBoardPathWithoutPrefix("/execution-workspaces/workspace-123/routines")).toBe(true);
    expect(extractCompanyPrefixFromPath("/execution-workspaces/workspace-123")).toBeNull();
    expect(applyCompanyPrefix("/execution-workspaces/workspace-123", "PAP")).toBe(
      "/PAP/execution-workspaces/workspace-123",
    );
    expect(applyCompanyPrefix("/execution-workspaces/workspace-123/routines", "PAP")).toBe(
      "/PAP/execution-workspaces/workspace-123/routines",
    );
  });

  it("normalizes prefixed execution workspace paths back to company-relative paths", () => {
    expect(toCompanyRelativePath("/PAP/execution-workspaces/workspace-123")).toBe(
      "/execution-workspaces/workspace-123",
    );
    expect(toCompanyRelativePath("/PAP/execution-workspaces/workspace-123/routines")).toBe(
      "/execution-workspaces/workspace-123/routines",
    );
  });

  it("treats /search as a board route that needs a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/search")).toBe(true);
    expect(extractCompanyPrefixFromPath("/search")).toBeNull();
    expect(applyCompanyPrefix("/search", "PAP")).toBe("/PAP/search");
    expect(applyCompanyPrefix("/search?q=hello%20world", "PAP")).toBe("/PAP/search?q=hello%20world");
    expect(toCompanyRelativePath("/PAP/search?q=foo")).toBe("/search?q=foo");
  });

  it("treats /work-meetings as a board route that needs a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/work-meetings")).toBe(true);
    expect(extractCompanyPrefixFromPath("/work-meetings")).toBeNull();
    expect(applyCompanyPrefix("/work-meetings", "PAP")).toBe("/PAP/work-meetings");
    expect(toCompanyRelativePath("/PAP/work-meetings")).toBe("/work-meetings");
  });

  it("treats restored operations routes as board routes that need a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/campaigns")).toBe(true);
    expect(isBoardPathWithoutPrefix("/operations")).toBe(true);
    expect(isBoardPathWithoutPrefix("/provider-quotas")).toBe(true);
    expect(applyCompanyPrefix("/campaigns", "PAP")).toBe("/PAP/campaigns");
    expect(applyCompanyPrefix("/operations", "PAP")).toBe("/PAP/operations");
    expect(applyCompanyPrefix("/provider-quotas", "PAP")).toBe("/PAP/provider-quotas");
    expect(toCompanyRelativePath("/PAP/operations")).toBe("/operations");
    expect(toCompanyRelativePath("/PAP/provider-quotas")).toBe("/provider-quotas");
  });
});
