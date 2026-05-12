/**
 * Lifecycle Hooks — in-process, typed pre/post hooks for heartbeat runs.
 *
 * Sibling to `plugin-event-bus.ts` but scoped to **internal** observers
 * (vault memory writer, audit emitters, compliance checks). Plugins continue
 * to use the public event bus; this registry exists so server code can fire
 * lifecycle-bound hooks inline with deterministic ordering and typed context.
 *
 * Design rules:
 * - Errors in one hook never break the run or other hooks (per-hook isolation).
 * - Pre-hooks may return `{ abort: { reason } }` to refuse the run.
 * - Post-hooks are fire-and-forget on success; errors are logged, not thrown.
 * - Hooks register by name so they can be enumerated and replaced safely.
 * - Registration is process-local; bootstrap once at server start.
 *
 * NOTE on integration: heartbeat.ts is left untouched in this commit. The
 * two-line integration is documented at the bottom of this file so the
 * reviewer can audit the diff before applying.
 */

import type { Db } from "@paperclipai/db";
import type { agents as agentsTable, heartbeatRuns } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Event surface
// ---------------------------------------------------------------------------

export type LifecycleEvent =
  | "run.before"
  | "run.after.success"
  | "run.after.failure"
  | "run.after.cancelled";

export interface LifecycleContext {
  /** Drizzle DB handle for hooks that need DB access. */
  db: Db;
  /** The agent that owns the run. */
  agent: typeof agentsTable.$inferSelect;
  /** The heartbeat run row (post-update for after.* events). */
  run: typeof heartbeatRuns.$inferSelect;
  /** Optional error for failure events. */
  error?: Error | null;
}

export interface PreHookOutcome {
  /** If set, the run is refused (e.g. budget cap, missing skill). */
  abort?: { reason: string };
}

export type PreHookHandler = (ctx: LifecycleContext) => Promise<PreHookOutcome | void>;
export type PostHookHandler = (ctx: LifecycleContext) => Promise<void>;

interface Registration {
  name: string;
  fn: PreHookHandler | PostHookHandler;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class LifecycleHookRegistry {
  private readonly handlers = new Map<LifecycleEvent, Registration[]>();

  /** Register a hook. Idempotent on (event, name) — re-registering replaces. */
  register(event: LifecycleEvent, name: string, fn: PreHookHandler | PostHookHandler): void {
    const list = this.handlers.get(event) ?? [];
    const existing = list.findIndex((r) => r.name === name);
    if (existing >= 0) list[existing] = { name, fn };
    else list.push({ name, fn });
    this.handlers.set(event, list);
    logger.info({ event, name }, "lifecycle hook registered");
  }

  /** Remove a hook by (event, name). Silent if absent. */
  unregister(event: LifecycleEvent, name: string): void {
    const list = this.handlers.get(event);
    if (!list) return;
    const next = list.filter((r) => r.name !== name);
    if (next.length === 0) this.handlers.delete(event);
    else this.handlers.set(event, next);
  }

  /** List registered hook names for an event (useful for introspection). */
  list(event: LifecycleEvent): string[] {
    return (this.handlers.get(event) ?? []).map((r) => r.name);
  }

  /**
   * Fire a pre-hook. Returns the first abort encountered (in registration
   * order). Errors in one hook do not stop later hooks; the run continues
   * unless an explicit `abort` is returned.
   */
  async firePre(event: "run.before", ctx: LifecycleContext): Promise<PreHookOutcome> {
    const list = this.handlers.get(event) ?? [];
    for (const r of list) {
      try {
        const out = await (r.fn as PreHookHandler)(ctx);
        if (out && out.abort) {
          logger.warn({ event, name: r.name, reason: out.abort.reason }, "lifecycle hook aborted run");
          return out;
        }
      } catch (err) {
        logger.warn({ event, name: r.name, err }, "lifecycle pre-hook failed");
      }
    }
    return {};
  }

  /**
   * Fire a post-hook. Runs all handlers concurrently with isolated error
   * handling. Never throws.
   */
  async firePost(
    event: "run.after.success" | "run.after.failure" | "run.after.cancelled",
    ctx: LifecycleContext,
  ): Promise<void> {
    const list = this.handlers.get(event) ?? [];
    if (list.length === 0) return;
    const results = await Promise.allSettled(
      list.map(async (r) => {
        try {
          await (r.fn as PostHookHandler)(ctx);
        } catch (err) {
          logger.warn({ event, name: r.name, err }, "lifecycle post-hook failed");
        }
      }),
    );
    // All settled-failures are already logged via inner try/catch; this guards
    // against unhandled rejections in malformed handlers.
    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn({ event, err: result.reason }, "lifecycle post-hook unhandled rejection");
      }
    }
  }
}

/** Singleton registry. Boot-time code attaches hooks via {@link registerCoreLifecycleHooks}. */
export const lifecycleHooks = new LifecycleHookRegistry();

// ---------------------------------------------------------------------------
// Integration plan for heartbeat.ts (do not apply automatically)
// ---------------------------------------------------------------------------
//
// In `setRunStatus(runId, status, patch)` after the DB update succeeds and the
// `publishLiveEvent` call, insert:
//
//   if (updated && (status === "completed" || status === "success" || status === "done")) {
//     const agent = await db.query.agents.findFirst({ where: eq(agents.id, updated.agentId) });
//     if (agent) {
//       await lifecycleHooks.firePost("run.after.success", { db, agent, run: updated });
//     }
//   } else if (updated && (status === "failed" || status === "timed_out")) {
//     // similar firePost("run.after.failure")
//   } else if (updated && status === "cancelled") {
//     // similar firePost("run.after.cancelled")
//   }
//
// For pre-hooks: find the run-start path (where `running` is set) and call
//   const pre = await lifecycleHooks.firePre("run.before", { db, agent, run });
//   if (pre.abort) { setRunStatus(runId, "cancelled", { error: pre.abort.reason }); return; }
//
// Both additions are <10 lines each. Build/start the server after applying.
