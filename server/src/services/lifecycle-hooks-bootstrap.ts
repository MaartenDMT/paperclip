/**
 * Lifecycle Hooks Bootstrap — registers core internal hooks at server start.
 *
 * Call once during server startup, after the DB is open and before the
 * heartbeat loop begins accepting runs.
 *
 * Adding a new internal hook:
 *   1. Implement it under `services/lifecycle-hooks/<name>.ts` exporting a
 *      PreHookHandler or PostHookHandler.
 *   2. Register it here with a stable name.
 *   3. (Optional) Gate it behind an env var or instance setting if
 *      experimental.
 */

import { lifecycleHooks } from "./lifecycle-hooks.js";
import { vaultMemoryPostHook } from "./lifecycle-hooks/vault-memory-hook.js";
import { logger } from "../middleware/logger.js";

export interface LifecycleBootstrapOptions {
  /** Default true. Set false to disable the karpathy-vault writer entirely. */
  enableVaultMemoryHook?: boolean;
}

export function registerCoreLifecycleHooks(
  opts: LifecycleBootstrapOptions = {},
): void {
  const enableVault =
    opts.enableVaultMemoryHook ?? process.env.PAPERCLIP_VAULT_HOOK !== "off";

  if (enableVault) {
    // registry.register() already logs the registration; no echo needed.
    lifecycleHooks.register("run.after.success", "vault-memory", vaultMemoryPostHook);
  } else {
    logger.info("vault-memory lifecycle hook disabled by config");
  }

  // Future hooks register here.
}
