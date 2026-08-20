import { describe, expect, it } from "vitest";
import { portabilityAgentMetadataSchema, portabilityCompanyMetadataSchema } from "./company-portability.js";
import { createAgentSchema, updateAgentSchema } from "./agent.js";
import { createCompanySchema, updateCompanySchema } from "./company.js";

describe("portable MAOS metadata", () => {
  it("accepts the bounded company and specialist contract", () => {
    const parsed = portabilityCompanyMetadataSchema.parse({
      maos: {
        company_id: "readersbase",
        system_id: "maos-readersbase",
        initiative_id: "goal-market-fit",
        initiative_kind: "goal",
        milestone_id: "project-launch",
        milestone_kind: "project",
        source_links: [{ system: "vault", label: "Project memory", path: "ReadersBase/Launch.md" }],
        approval_boundary: "Board approval before spend.",
        kpis: [{ name: "Qualified readers", target: 1000 }],
        specialist_ownership: ["research", "growth", "content", "product_customer", "ops_finance", "security_risk", "engineering_release"],
        handoff_contracts: [{
          from: "research",
          to: "content",
          deliverable: "Source-linked brief",
          acceptance: "Every claim has a source link",
        }],
      },
    });

    expect(parsed.maos?.initiative_kind).toBe("goal");
    expect(parsed.maos?.specialist_ownership).toHaveLength(7);
  });

  it("rejects new runtime primitives and unlocated source links", () => {
    expect(() => portabilityCompanyMetadataSchema.parse({
      maos: {
        initiative_kind: "initiative",
        milestone_kind: "milestone",
        source_links: [{ system: "readersbase", label: "Missing locator" }],
      },
    })).toThrow();
  });

  it("accepts portable metadata through company create and update APIs", () => {
    const metadata = { maos: { company_id: "readersbase" } };
    expect(createCompanySchema.parse({ name: "ReadersBase", metadata }).metadata).toEqual(metadata);
    expect(updateCompanySchema.parse({ metadata }).metadata).toEqual(metadata);
  });

  it.each([
    { maos: { initiative_id: "goal-1" } },
    { maos: { milestone_kind: "project" } },
    { maos: { source_links: [{ system: "readersbase", label: "File URL", url: "file:///notes.md" }] } },
    { maos: { source_links: [{ system: "vault", label: "Absolute", path: "C:\\Vault\\notes.md" }] } },
    { maos: { source_links: [{ system: "vault", label: "Absolute", path: "/vault/notes.md" }] } },
    { maos: { source_links: [{ system: "vault", label: "Traversal", path: "../vault/notes.md" }] } },
    { maos: { source_links: [{ system: "vault", label: "Traversal", path: "notes/..\\vault.md" }] } },
    { maos: { specialist_ownership: [] } },
    { maos: { kpis: [{ name: "No target" }] } },
    {
      maos: {
        specialist_ownership: ["research"],
        handoff_contracts: [{ from: "research", to: "research", deliverable: "Brief", acceptance: "Reviewed" }],
      },
    },
    {
      maos: {
        specialist_ownership: ["research"],
        handoff_contracts: [{ from: "research", to: "content", deliverable: "Brief", acceptance: "Reviewed" }],
      },
    },
  ])("rejects invalid company metadata %#", (metadata) => {
    expect(() => portabilityCompanyMetadataSchema.parse(metadata)).toThrow();
    expect(() => createCompanySchema.parse({ name: "Invalid", metadata })).toThrow();
    expect(() => updateCompanySchema.parse({ metadata })).toThrow();
  });

  it("keeps company and agent MAOS metadata distinct", () => {
    expect(() => portabilityCompanyMetadataSchema.parse({ maos: { specialist_role: "research" } })).toThrow();
    expect(() => portabilityAgentMetadataSchema.parse({ maos: { company_id: "readersbase" } })).toThrow();
    expect(portabilityAgentMetadataSchema.parse({ maos: { specialist_role: "research" } })).toEqual({
      maos: { specialist_role: "research" },
    });
  });

  it("keeps arbitrary direct agent metadata backward compatible", () => {
    const metadata = { legacy: { owner: "operator" }, tags: ["existing"] };
    expect(createAgentSchema.parse({ name: "Legacy", adapterType: "process", metadata }).metadata).toEqual(metadata);
    expect(updateAgentSchema.parse({ metadata }).metadata).toEqual(metadata);
  });

  it.each([
    { maos: { company_id: "readersbase" } },
    { maos: { initiative_id: "goal-1", initiative_kind: "goal" } },
    { maos: { specialist_role: "finance" } },
  ])("rejects invalid direct agent MAOS metadata %#", (metadata) => {
    expect(() => createAgentSchema.parse({ name: "Invalid", adapterType: "process", metadata })).toThrow();
    expect(() => updateAgentSchema.parse({ metadata })).toThrow();
  });
});
