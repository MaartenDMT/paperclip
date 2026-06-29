import { describe, expect, it } from "vitest";
import { isDatabaseConcurrencyConflict } from "../services/recovery/service.ts";

describe("isDatabaseConcurrencyConflict", () => {
  it("detects PostgreSQL deadlock and serialization conflict codes", () => {
    expect(isDatabaseConcurrencyConflict({ code: "40P01", message: "deadlock detected" })).toBe(true);
    expect(isDatabaseConcurrencyConflict({ code: "40001", message: "could not serialize access" })).toBe(true);
  });

  it("detects lock and serialization conflicts from wrapped database errors", () => {
    expect(
      isDatabaseConcurrencyConflict({
        message: "query failed",
        cause: {
          message: "canceling statement due to lock timeout",
        },
      }),
    ).toBe(true);
    expect(
      isDatabaseConcurrencyConflict({
        message: "outer",
        cause: {
          message: "middle",
          cause: {
            code: "40P01",
            message: "deadlock detected",
          },
        },
      }),
    ).toBe(true);
  });

  it("does not treat ordinary database failures as concurrency conflicts", () => {
    expect(isDatabaseConcurrencyConflict({ code: "23503", message: "foreign key violation" })).toBe(false);
    expect(isDatabaseConcurrencyConflict(new Error("connection refused"))).toBe(false);
    expect(isDatabaseConcurrencyConflict(null)).toBe(false);
  });
});
