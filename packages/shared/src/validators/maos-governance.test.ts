import { describe, expect, it } from "vitest";
import { createCompanySchema } from "./company.js";
import { createGoalSchema } from "./goal.js";

describe("MAOS governance bindings", () => {
  it("preserves a company key and system identifier for a company goal", () => {
    const company = createCompanySchema.parse({
      name: "ReadersBase",
      maosCompanyId: "readersbase",
    });
    const goal = createGoalSchema.parse({
      title: "Increase qualified product discovery",
      maosSystemId: "marketing",
    });

    expect(company.maosCompanyId).toBe("readersbase");
    expect(goal.maosSystemId).toBe("marketing");
  });
});
