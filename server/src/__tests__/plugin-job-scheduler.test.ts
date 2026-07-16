import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginJobScheduler } from "../services/plugin-job-scheduler.js";

describe("plugin job scheduler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recovers when a prior tick stays wedged past the stale timeout", async () => {
    let releaseFirstWhere: ((value: []) => void) | null = null;
    const where = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<[]>((resolve) => {
          releaseFirstWhere = resolve;
        }),
      )
      .mockResolvedValueOnce([]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where,
        })),
      })),
    } as any;
    const scheduler = createPluginJobScheduler({
      db,
      jobStore: {} as any,
      workerManager: {
        isRunning: vi.fn().mockReturnValue(true),
      } as any,
      staleTickTimeoutMs: 50,
      tickIntervalMs: 10,
      jobTimeoutMs: 10,
    });

    const firstTick = scheduler.tick();
    await Promise.resolve();

    expect(scheduler.diagnostics().tickCount).toBe(1);
    expect(where).toHaveBeenCalledTimes(1);

    await scheduler.tick();
    expect(scheduler.diagnostics().tickCount).toBe(1);
    expect(where).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 51);
    await scheduler.tick();

    expect(scheduler.diagnostics().tickCount).toBe(2);
    expect(where).toHaveBeenCalledTimes(2);

    releaseFirstWhere?.([]);
    await firstTick;
  });

  it("fails a hung due-jobs query fast enough to allow the next tick", async () => {
    const where = vi
      .fn()
      .mockImplementationOnce(() => new Promise<[]>(() => {}))
      .mockResolvedValueOnce([]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where,
        })),
      })),
    } as any;
    const scheduler = createPluginJobScheduler({
      db,
      jobStore: {} as any,
      workerManager: {
        isRunning: vi.fn().mockReturnValue(true),
      } as any,
      dueJobsQueryTimeoutMs: 20,
      staleTickTimeoutMs: 5_000,
      tickIntervalMs: 10,
      jobTimeoutMs: 10,
    });

    await scheduler.tick();
    await scheduler.tick();

    expect(scheduler.diagnostics().tickCount).toBe(2);
    expect(where).toHaveBeenCalledTimes(2);
  });
});
