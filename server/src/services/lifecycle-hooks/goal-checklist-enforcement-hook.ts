/**
 * Goal Checklist Enforcement Hook.
 *
 * Enforces manager follow-through by injecting a mandatory checklist contract
 * into CEO/department-head runs and flagging successful manager runs that do
 * not leave checklist evidence.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { agents, heartbeatRunEvents, heartbeatRuns, issueComments } from "@paperclipai/db";
import type { LifecycleContext, PostHookHandler, PreHookHandler } from "../lifecycle-hooks.js";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";

const MANAGER_NAME_KEYS = new Set([
  "ceo",
  "cto",
  "cmo",
  "uxdesigner",
  "ux-designer",
  "fiction-director",
  "senior-engineer",
  "qa-engineer",
  "engineering-operations-coordinator",
]);

const CHECKLIST_EVIDENCE_RE =
  /(company|department|goal)\s+checklist|checklist.{0,120}(owner|blocker|evidence|follow[- ]?up|inspected|updated|created|linked|wake|stalled|no action|required)/i;

const MANAGER_INSTRUCTION = [
  "# Paperclip Goal Checklist Enforcement",
  "",
  "This run is owned by a CEO, department head, or manager-like agent. Before exiting, you must leave explicit goal-checklist evidence.",
  "",
  "Required checklist evidence:",
  "",
  "- name the company or department goal/checklist inspected or updated",
  "- state remaining work or the checklist item that moved",
  "- name the accountable owner or direct report",
  "- link or name the issue/blocker/PR/artifact/evidence source when applicable",
  "- state the next follow-up action, including whether you created, linked, reassigned, woke, reviewed, or escalated work",
  "",
  "If no item changed, explicitly write that the checklist was inspected and why no action was required. A generic completion summary is noncompliant.",
].join("\n");

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function hasDirectReports(ctx: LifecycleContext): Promise<boolean> {
  const row = await ctx.db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.reportsTo, ctx.agent.id))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  return Boolean(row);
}

async function isChecklistEnforcedAgent(
  ctx: LifecycleContext,
): Promise<{ required: boolean; level: "company" | "department" | "manager" | null }> {
  const key = normalizeName(ctx.agent.name);
  if (key === "ceo") return { required: true, level: "company" };
  if (MANAGER_NAME_KEYS.has(key)) return { required: true, level: key === "ceo" ? "company" : "department" };
  if (await hasDirectReports(ctx)) return { required: true, level: "manager" };
  return { required: false, level: null };
}

async function readExistingInstructions(filePath: string | null): Promise<string> {
  if (!filePath) return "";
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function generatedInstructionPath(ctx: LifecycleContext): string {
  return path.resolve(
    resolvePaperclipInstanceRoot(),
    "runtime-hooks",
    "goal-checklist-instructions",
    ctx.agent.companyId,
    ctx.run.id,
    "goal-checklist.md",
  );
}

export const goalChecklistInstructionPreHook: PreHookHandler = async (ctx) => {
  const config = ctx.runtimeConfig;
  if (!config) return;
  const enforcement = await isChecklistEnforcedAgent(ctx);
  if (!enforcement.required) return;

  const existingInstructionsPath = asString(config.instructionsFilePath);
  const existingInstructions = await readExistingInstructions(existingInstructionsPath);
  const targetPath = generatedInstructionPath(ctx);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(
    targetPath,
    [
      MANAGER_INSTRUCTION,
      "",
      existingInstructions.trim()
        ? [
            "# Existing Agent Instructions",
            "",
            `The following instructions were originally loaded from ${existingInstructionsPath}.`,
            "",
            existingInstructions,
          ].join("\n")
        : "",
    ].filter(Boolean).join("\n") + "\n",
    "utf8",
  );

  config.instructionsFilePath = targetPath;
  if (ctx.contextSnapshot) {
    ctx.contextSnapshot.goalChecklistEnforcement = {
      required: true,
      level: enforcement.level,
      instructionsFilePath: targetPath,
      originalInstructionsFilePath: existingInstructionsPath,
    };
  }
};

function collectRunText(ctx: LifecycleContext, commentBodies: string[]): string {
  const result = asRecord(ctx.run.resultJson);
  return [
    ctx.agent.name,
    JSON.stringify(result),
    ctx.run.stdoutExcerpt,
    ctx.run.stderrExcerpt,
    ctx.run.error,
    ...commentBodies,
  ].filter((value): value is string => typeof value === "string" && value.length > 0).join("\n\n");
}

async function listRunCommentBodies(ctx: LifecycleContext): Promise<string[]> {
  const rows = await ctx.db
    .select({ body: issueComments.body })
    .from(issueComments)
    .where(eq(issueComments.createdByRunId, ctx.run.id));
  return rows.map((row) => row.body).filter((body): body is string => typeof body === "string");
}

async function nextRunEventSeq(ctx: LifecycleContext): Promise<number> {
  const [row] = await ctx.db
    .select({ maxSeq: sql<number | null>`max(${heartbeatRunEvents.seq})` })
    .from(heartbeatRunEvents)
    .where(eq(heartbeatRunEvents.runId, ctx.run.id));
  return Number(row?.maxSeq ?? 0) + 1;
}

async function writeEnforcementEvent(ctx: LifecycleContext, satisfied: boolean, level: string | null) {
  const seq = await nextRunEventSeq(ctx);
  await ctx.db.insert(heartbeatRunEvents).values({
    companyId: ctx.run.companyId,
    runId: ctx.run.id,
    agentId: ctx.agent.id,
    seq,
    eventType: "checklist.enforcement",
    stream: "system",
    level: satisfied ? "info" : "warn",
    message: satisfied
      ? "Manager run included required goal-checklist evidence"
      : "Manager run completed without required goal-checklist evidence",
    payload: {
      required: true,
      satisfied,
      checklistLevel: level,
      agentName: ctx.agent.name,
      remediation: satisfied
        ? null
        : "Add/update the company or department goal checklist, name owner/evidence/follow-up, and create/link concrete work.",
    },
  });
}

async function persistEnforcementResult(ctx: LifecycleContext, satisfied: boolean, level: string | null) {
  const resultJson = {
    ...asRecord(ctx.run.resultJson),
    goalChecklistEnforcement: {
      required: true,
      satisfied,
      level,
      checkedAt: new Date().toISOString(),
    },
  };
  await ctx.db
    .update(heartbeatRuns)
    .set({
      resultJson,
      ...(satisfied
        ? {}
        : {
            livenessState: "needs_followup",
            livenessReason: "manager_run_missing_goal_checklist_evidence",
            nextAction: "Update the company/department goal checklist with owner, evidence, blocker/follow-up, then rerun or wake the accountable manager.",
          }),
      updatedAt: new Date(),
    })
    .where(eq(heartbeatRuns.id, ctx.run.id));
}

export const goalChecklistEnforcementPostHook: PostHookHandler = async (ctx) => {
  const enforcement = await isChecklistEnforcedAgent(ctx);
  if (!enforcement.required) return;

  const commentBodies = await listRunCommentBodies(ctx);
  const text = collectRunText(ctx, commentBodies);
  const satisfied = CHECKLIST_EVIDENCE_RE.test(text);
  await writeEnforcementEvent(ctx, satisfied, enforcement.level);
  await persistEnforcementResult(ctx, satisfied, enforcement.level);
};
