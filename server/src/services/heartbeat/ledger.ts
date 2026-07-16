// Cost-ledger helpers extracted from heartbeat.ts.
//
// These normalize a run's billing type and biller, convert a USD cost into
// billed cents (treating subscription-included runs as free), and resolve the
// issue/project scope a run's cost should be attributed to. Only
// resolveLedgerScopeForRun reads from the passed-in Db; all hold no heartbeat
// state.

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns, issues } from "@paperclipai/db";
import type { BillingType } from "@paperclipai/shared";
import type { AdapterExecutionResult } from "../../adapters/index.js";
import { parseObject } from "../../adapters/utils.js";
import { readNonEmptyString } from "./shared.js";

export function normalizeLedgerBillingType(value: unknown): BillingType {
  const raw = readNonEmptyString(value);
  switch (raw) {
    case "api":
    case "metered_api":
      return "metered_api";
    case "subscription":
    case "subscription_included":
      return "subscription_included";
    case "subscription_overage":
      return "subscription_overage";
    case "credits":
      return "credits";
    case "fixed":
      return "fixed";
    default:
      return "unknown";
  }
}

export function resolveLedgerBiller(result: AdapterExecutionResult): string {
  return readNonEmptyString(result.biller) ?? readNonEmptyString(result.provider) ?? "unknown";
}

export function normalizeBilledCostCents(costUsd: number | null | undefined, billingType: BillingType): number {
  if (billingType === "subscription_included") return 0;
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd)) return 0;
  return Math.max(0, Math.round(costUsd * 100));
}

export async function resolveLedgerScopeForRun(
  db: Db,
  companyId: string,
  run: typeof heartbeatRuns.$inferSelect,
) {
  const context = parseObject(run.contextSnapshot);
  const contextIssueId = readNonEmptyString(context.issueId);
  const contextProjectId = readNonEmptyString(context.projectId);

  if (!contextIssueId) {
    return {
      issueId: null,
      projectId: contextProjectId,
    };
  }

  const issue = await db
    .select({
      id: issues.id,
      projectId: issues.projectId,
    })
    .from(issues)
    .where(and(eq(issues.id, contextIssueId), eq(issues.companyId, companyId)))
    .then((rows) => rows[0] ?? null);

  return {
    issueId: issue?.id ?? null,
    projectId: issue?.projectId ?? contextProjectId,
  };
}
