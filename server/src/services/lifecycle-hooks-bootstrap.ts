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
import {
  goalChecklistEnforcementPostHook,
  goalChecklistInstructionPreHook,
} from "./lifecycle-hooks/goal-checklist-enforcement-hook.js";
import { mandatorySkillInstructionPreHook } from "./lifecycle-hooks/mandatory-skill-instruction-hook.js";
import { vaultMemoryPostHook } from "./lifecycle-hooks/vault-memory-hook.js";
import { logger } from "../middleware/logger.js";

export interface LifecycleBootstrapOptions {
  /** Default true. Set false to disable the karpathy-vault writer entirely. */
  enableVaultMemoryHook?: boolean;
  /** Default true. Set false to disable mandatory runtime skill instruction injection. */
  enableMandatorySkillInstructionHook?: boolean;
  /** Default true. Set false to disable manager goal-checklist enforcement. */
  enableGoalChecklistEnforcementHook?: boolean;
}

export function registerCoreLifecycleHooks(
  opts: LifecycleBootstrapOptions = {},
): void {
  const enableVault =
    opts.enableVaultMemoryHook ?? process.env.PAPERCLIP_VAULT_HOOK !== "off";
  const enableMandatorySkillInstruction =
    opts.enableMandatorySkillInstructionHook ?? process.env.PAPERCLIP_MANDATORY_SKILL_HOOK !== "off";
  const enableGoalChecklistEnforcement =
    opts.enableGoalChecklistEnforcementHook ?? process.env.PAPERCLIP_GOAL_CHECKLIST_ENFORCEMENT_HOOK !== "off";

  if (enableMandatorySkillInstruction) {
    lifecycleHooks.register("run.before", "mandatory-skill-instruction", mandatorySkillInstructionPreHook);
  } else {
    logger.info("mandatory-skill-instruction lifecycle hook disabled by config");
  }

  if (enableGoalChecklistEnforcement) {
    lifecycleHooks.register("run.before", "goal-checklist-instruction", goalChecklistInstructionPreHook);
    lifecycleHooks.register("run.after.success", "goal-checklist-enforcement", goalChecklistEnforcementPostHook);
  } else {
    logger.info("goal-checklist-enforcement lifecycle hook disabled by config");
  }

  if (enableVault) {
    // registry.register() already logs the registration; no echo needed.
    lifecycleHooks.register("run.after.success", "vault-memory", vaultMemoryPostHook);
  } else {
    logger.info("vault-memory lifecycle hook disabled by config");
  }

  // Future hooks register here.
}
