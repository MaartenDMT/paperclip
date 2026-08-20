import { describe, expect, it } from "vitest";
import { portabilityMetadataSchema } from "./company-portability.js";
import { createCompanySchema, updateCompanySchema } from "./company.js";

describe("portable MAOS metadata", () => {
  it("accepts the bounded company and specialist contract", () => {
    const parsed = portabilityMetadataSchema.parse({
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
        specialist_role: "research",
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
    expect(() => portabilityMetadataSchema.parse({
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
});
