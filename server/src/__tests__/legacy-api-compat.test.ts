import { describe, expect, it, vi } from "vitest";
import {
  createLegacyApiCompatibilityMiddleware,
  isLegacyApiCompatibilityRequest,
} from "../legacy-api-compat.js";

describe("legacy api compatibility routing", () => {
  it("matches only the targeted legacy API paths", () => {
    expect(isLegacyApiCompatibilityRequest({ method: "GET", path: "/heartbeat-runs/run-1/log" } as any)).toBe(true);
    expect(isLegacyApiCompatibilityRequest({ method: "GET", path: "/runs/run-1/logs" } as any)).toBe(true);
    expect(isLegacyApiCompatibilityRequest({ method: "GET", path: "/runs/run-1" } as any)).toBe(true);
    expect(isLegacyApiCompatibilityRequest({ method: "GET", path: "/agents/agent-1/runs/run-1" } as any)).toBe(true);
    expect(isLegacyApiCompatibilityRequest({ method: "GET", path: "/issues/REA-252/active-run" } as any)).toBe(true);
    expect(isLegacyApiCompatibilityRequest({ method: "PATCH", path: "/issues/REA-252" } as any)).toBe(true);
    expect(isLegacyApiCompatibilityRequest({ method: "POST", path: "/runs/run-1/cancel" } as any)).toBe(false);
    expect(isLegacyApiCompatibilityRequest({ method: "GET", path: "/issues/REA-252" } as any)).toBe(false);
  });

  it("dispatches only matched requests into the compatibility router", () => {
    const compat = vi.fn();
    const next = vi.fn();
    const middleware = createLegacyApiCompatibilityMiddleware(compat);

    middleware({ method: "GET", path: "/heartbeat-runs/run-1/log" } as any, {} as any, next);
    expect(compat).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();

    compat.mockClear();
    next.mockClear();

    middleware({ method: "PATCH", path: "/issues/REA-252" } as any, {} as any, next);
    expect(compat).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();

    compat.mockClear();
    next.mockClear();

    middleware({ method: "GET", path: "/agents/agent-1/runs/run-1" } as any, {} as any, next);
    expect(compat).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();

    compat.mockClear();
    next.mockClear();

    middleware({ method: "GET", path: "/issues/REA-252" } as any, {} as any, next);
    expect(compat).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
