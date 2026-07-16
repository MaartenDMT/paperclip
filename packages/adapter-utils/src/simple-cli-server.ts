import fs from "node:fs/promises";
import path from "node:path";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "./types.js";
import {
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetDirectory,
  ensureAdapterExecutionTargetRuntimeCommandInstalled,
  maybeRunSandboxInstallCommand,
  readAdapterExecutionTarget,
  resolveAdapterExecutionTargetCommandForLogs,
  resolveAdapterExecutionTargetCwd,
  runAdapterExecutionTargetProcess,
} from "./execution-target.js";
import {
  asNumber,
  asString,
  asStringArray,
  buildInvocationEnvForLogs,
  buildPaperclipEnv,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  ensureAbsoluteDirectory,
  ensurePathInEnv,
  joinPromptSections,
  parseJson,
  parseObject,
  refreshPaperclipWorkspaceEnvForExecution,
  renderPaperclipWakePrompt,
  renderTemplate,
  stringifyPaperclipWakePayload,
  type TerminalResultCleanupOptions,
} from "./server-utils.js";
import { parseSimpleCliStdoutLine } from "./simple-cli-ui.js";

export interface SimpleCliAdapterDefinition {
  type: string;
  label: string;
  defaultCommand: string;
  defaultModel?: string;
  sandboxInstallCommand?: string;
  defaultTimeoutSec?: number;
  defaultGraceSec?: number;
  buildArgs: (input: {
    prompt: string;
    model: string;
    extraArgs: string[];
    config: Record<string, unknown>;
    runtime: AdapterExecutionContext["runtime"];
  }) => string[];
  extractSessionParams?: (input: {
    stdout: string;
    stderr: string;
    runtime: AdapterExecutionContext["runtime"];
    cwd: string;
  }) => Record<string, unknown> | null;
  authEnvKeys?: string[];
  biller?: string;
  terminalResultCleanup?: TerminalResultCleanupOptions;
}

function hasTextContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (typeof item === "string") return item.trim().length > 0;
    const rec = parseObject(item);
    const type = asString(rec.type, "");
    if (/think|reason|tool_(?:use|call|result|output)|function/i.test(type)) return false;
    return Boolean(
      asString(rec.text, "").trim() ||
      asString(rec.content, "").trim() ||
      asString(rec.message, "").trim() ||
      asString(rec.deltaContent, "").trim()
    );
  });
}

function hasToolCalls(rec: Record<string, unknown>): boolean {
  return (Array.isArray(rec.tool_calls) && rec.tool_calls.length > 0) ||
    (Array.isArray(rec.toolCalls) && rec.toolCalls.length > 0);
}

export function hasSimpleCliTerminalResult(output: { stdout: string; stderr?: string }): boolean {
  for (const rawLine of output.stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const event = parseJson(line);
    if (!event) continue;
    const type = asString(event.type, "").trim().toLowerCase();
    if (type === "result") return true;
    if (type === "message_stop" || type === "done" || type === "completed") return true;

    const data = parseObject(event.data);
    const payload = Object.keys(data).length > 0 ? data : event;
    const role = asString(payload.role, "").trim().toLowerCase();
    const payloadType = asString(payload.type, type).trim().toLowerCase();
    if ((role === "assistant" || payloadType === "message") && hasTextContent(payload.content) && !hasToolCalls(payload)) {
      return true;
    }
  }
  return false;
}

function firstNonEmptyLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function summarizeTranscriptEntries(
  entries: ReturnType<typeof parseSimpleCliStdoutLine>,
): string | null {
  const preferred =
    entries.find((entry) => entry.kind === "assistant" || entry.kind === "result" || entry.kind === "stderr")
    ?? entries.find((entry) => entry.kind === "stdout");
  const summary = preferred?.text.trim();
  return summary || null;
}

function normalizeStructuredStopReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/_/g, " ");
}

function summarizeStructuredJsonWithoutFinalText(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const rec = parsed as Record<string, unknown>;
  const stopReason = normalizeStructuredStopReason(rec.stop_reason ?? rec.stopReason);
  const content = Array.isArray(rec.content) ? rec.content : [];
  const nonEmptyContentItems = content.filter((item) => {
    if (typeof item === "string") return item.trim().length > 0;
    if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
    return Object.keys(item as Record<string, unknown>).length > 0;
  });
  const thinkingOnly =
    nonEmptyContentItems.length > 0 &&
    nonEmptyContentItems.every((item) => {
      if (typeof item === "string") return false;
      const rec = item as Record<string, unknown>;
      const type = typeof rec.type === "string" ? rec.type : "";
      return /think|reason/i.test(type) || typeof rec.thinking === "string" || typeof rec.think === "string";
    });

  if (thinkingOnly) {
    return stopReason
      ? `Model stopped at ${stopReason} before producing a final response.`
      : "Model produced only thinking output without a final response.";
  }

  if (stopReason) {
    return `Run completed without a final response (stop reason: ${stopReason}).`;
  }

  return "Run completed without a final response.";
}

export function summarizeSimpleCliOutput(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return summarizeTranscriptEntries(parseSimpleCliStdoutLine(trimmed, "summary"))
      ?? summarizeStructuredJsonWithoutFinalText(parsed);
  } catch {
    // The full payload is not a single JSON object; fall back to line-by-line parsing.
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const summary = summarizeTranscriptEntries(parseSimpleCliStdoutLine(line, "summary"));
    if (summary) return summary;
  }
  return null;
}

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function normalizeEnv(input: unknown): Record<string, string> {
  const env: Record<string, string> = {};
  const rec = parseObject(input);
  for (const [key, value] of Object.entries(rec)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function readWorkspaceContext(context: Record<string, unknown>): Record<string, unknown> {
  return parseObject(context.paperclipWorkspace);
}

function assignWakeEnv(env: Record<string, string>, context: Record<string, unknown>) {
  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim()) ||
    "";
  const wakeReason = typeof context.wakeReason === "string" ? context.wakeReason.trim() : "";
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim()) ||
    "";
  const approvalId = typeof context.approvalId === "string" ? context.approvalId.trim() : "";
  const approvalStatus = typeof context.approvalStatus === "string" ? context.approvalStatus.trim() : "";
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const wakePayloadJson = stringifyPaperclipWakePayload(context.paperclipWake);
  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  if (wakePayloadJson) env.PAPERCLIP_WAKE_PAYLOAD_JSON = wakePayloadJson;
}

async function buildPrompt(input: {
  cwd: string;
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  agent: AdapterExecutionContext["agent"];
  runId: string;
}): Promise<{ prompt: string; promptMetrics: Record<string, number>; commandNotes: string[] }> {
  const promptTemplate = asString(input.config.promptTemplate, DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE);
  const instructionsFilePath = asString(input.config.instructionsFilePath, "").trim();
  const commandNotes: string[] = [];
  let instructions = "";
  if (instructionsFilePath) {
    const resolved = path.resolve(input.cwd, instructionsFilePath);
    try {
      instructions = await fs.readFile(resolved, "utf8");
      commandNotes.push(`Loaded agent instructions from ${resolved}`);
    } catch (err) {
      commandNotes.push(
        `Configured instructionsFilePath ${resolved}, but file could not be read: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const templateData = {
    agentId: input.agent.id,
    companyId: input.agent.companyId,
    runId: input.runId,
    company: { id: input.agent.companyId },
    agent: input.agent,
    run: { id: input.runId, source: "on_demand" },
    context: input.context,
  };
  const wakePrompt = renderPaperclipWakePrompt(input.context.paperclipWake);
  const sessionHandoffNote = asString(input.context.paperclipSessionHandoffMarkdown, "").trim();
  const taskContextNote = asString(input.context.paperclipTaskMarkdown, "").trim();
  const renderedHeartbeatPrompt = renderTemplate(promptTemplate, templateData);
  const prompt = joinPromptSections([
    instructions,
    wakePrompt,
    sessionHandoffNote,
    taskContextNote,
    renderedHeartbeatPrompt,
  ]);
  return {
    prompt,
    promptMetrics: {
      instructionsChars: instructions.length,
      promptChars: prompt.length,
      wakePromptChars: wakePrompt.length,
      sessionHandoffChars: sessionHandoffNote.length,
      taskContextChars: taskContextNote.length,
      heartbeatPromptChars: renderedHeartbeatPrompt.length,
    },
    commandNotes,
  };
}

export async function executeSimpleCliAdapter(
  ctx: AdapterExecutionContext,
  def: SimpleCliAdapterDefinition,
): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, onMeta, onSpawn, authToken } = ctx;
  const executionTarget = readAdapterExecutionTarget({
    executionTarget: ctx.executionTarget,
    legacyRemoteExecution: ctx.executionTransport?.remoteExecution,
  });
  const executionTargetIsRemote = executionTarget?.kind === "remote";
  const workspaceContext = readWorkspaceContext(context);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const agentHome = asString(workspaceContext.agentHome, "");
  const configuredCwd = asString(config.cwd, "");
  const cwd = workspaceCwd || configuredCwd || process.cwd();
  const command = asString(config.command, def.defaultCommand);
  const model = asString(config.model, def.defaultModel ?? "");
  const timeoutSec = asNumber(config.timeoutSec, def.defaultTimeoutSec ?? 0);
  const graceSec = asNumber(config.graceSec, def.defaultGraceSec ?? 20);
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const envConfig = parseObject(config.env);
  const hasExplicitApiKey =
    typeof envConfig.PAPERCLIP_API_KEY === "string" && envConfig.PAPERCLIP_API_KEY.trim().length > 0;
  const env: Record<string, string> = { ...buildPaperclipEnv(agent), ...normalizeEnv(envConfig) };
  env.PAPERCLIP_RUN_ID = runId;
  assignWakeEnv(env, context);
  refreshPaperclipWorkspaceEnvForExecution({
    env,
    envConfig,
    workspaceCwd,
    workspaceSource,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    workspaceHints: [],
    agentHome,
    executionTargetIsRemote,
    executionCwd: cwd,
  });
  if (!hasExplicitApiKey && authToken) {
    env.PAPERCLIP_API_KEY = authToken;
  }
  const runtimeEnv = Object.fromEntries(
    Object.entries(ensurePathInEnv({ ...process.env, ...env })).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  await ensureAdapterExecutionTargetRuntimeCommandInstalled({
    runId,
    target: executionTarget,
    installCommand: ctx.runtimeCommandSpec?.installCommand,
    detectCommand: ctx.runtimeCommandSpec?.detectCommand,
    cwd,
    env: runtimeEnv,
    timeoutSec,
    graceSec,
    onLog,
  });
  await ensureAdapterExecutionTargetCommandResolvable(command, executionTarget, cwd, runtimeEnv, {
    installCommand: def.sandboxInstallCommand,
  });
  const resolvedCommand = await resolveAdapterExecutionTargetCommandForLogs(command, executionTarget, cwd, runtimeEnv);
  const extraArgs = asStringArray(config.extraArgs).length > 0 ? asStringArray(config.extraArgs) : asStringArray(config.args);
  const promptData = await buildPrompt({ cwd, config, context, agent, runId });
  const args = def.buildArgs({ prompt: promptData.prompt, model, extraArgs, config, runtime: ctx.runtime });
  const stdin = config.promptViaStdin === true ? promptData.prompt : undefined;

  if (onMeta) {
    await onMeta({
      adapterType: def.type,
      command: resolvedCommand,
      cwd,
      commandArgs: args,
      commandNotes: promptData.commandNotes,
      env: buildInvocationEnvForLogs(env, { runtimeEnv, includeRuntimeKeys: ["HOME"], resolvedCommand }),
      prompt: promptData.prompt,
      promptMetrics: promptData.promptMetrics,
      context,
    });
  }

  const proc = await runAdapterExecutionTargetProcess(runId, executionTarget, command, args, {
    cwd,
    env: executionTargetIsRemote ? env : runtimeEnv,
    stdin,
    timeoutSec,
    graceSec,
    onSpawn,
    onLog,
    terminalResultCleanup: def.terminalResultCleanup,
  });
  const stdoutSummary = summarizeSimpleCliOutput(proc.stdout);
  const stderrSummary = summarizeSimpleCliOutput(proc.stderr);
  const sessionParams = def.extractSessionParams?.({
    stdout: proc.stdout,
    stderr: proc.stderr,
    runtime: ctx.runtime,
    cwd,
  }) ?? undefined;
  const sessionId =
    typeof sessionParams?.sessionId === "string" && sessionParams.sessionId.trim().length > 0
      ? sessionParams.sessionId.trim()
      : undefined;
  const errorMessage =
    proc.timedOut
      ? `Timed out after ${timeoutSec}s`
      : (proc.exitCode ?? 0) === 0
        ? null
        : stderrSummary || stdoutSummary || firstNonEmptyLine(proc.stderr) || firstNonEmptyLine(proc.stdout) || `${def.label} exited with code ${proc.exitCode ?? -1}`;
  return {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: proc.timedOut,
    errorMessage,
    provider: def.label,
    biller: def.biller ?? "unknown",
    model: model || null,
    billingType: "unknown",
    ...(sessionParams !== undefined ? { sessionParams } : {}),
    ...(sessionId !== undefined ? { sessionId, sessionDisplayId: sessionId } : {}),
    resultJson: { stdout: proc.stdout, stderr: proc.stderr },
    summary: stdoutSummary || stderrSummary || firstNonEmptyLine(proc.stdout) || firstNonEmptyLine(proc.stderr) || null,
  };
}

export async function testSimpleCliEnvironment(
  ctx: AdapterEnvironmentTestContext,
  def: SimpleCliAdapterDefinition,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, def.defaultCommand);
  const target = ctx.executionTarget ?? null;
  const targetIsRemote = target?.kind === "remote";
  const cwd = resolveAdapterExecutionTargetCwd(target, asString(config.cwd, ""), process.cwd());
  const runId = `${def.type}-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (targetIsRemote) {
    checks.push({
      code: `${def.type}_environment_target`,
      level: "info",
      message: `Probing inside environment: ${ctx.environmentName ?? "remote environment"}`,
    });
  }
  try {
    await ensureAdapterExecutionTargetDirectory(runId, target, cwd, {
      cwd,
      env: {},
      createIfMissing: false,
    });
    checks.push({ code: `${def.type}_cwd_valid`, level: "info", message: `Working directory is valid: ${cwd}` });
  } catch (err) {
    checks.push({
      code: `${def.type}_cwd_invalid`,
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }
  const env = normalizeEnv(config.env);
  const installCheck = await maybeRunSandboxInstallCommand({
    runId,
    target,
    adapterKey: def.type,
    installCommand: def.sandboxInstallCommand ?? "",
    detectCommand: command,
    env,
  });
  if (installCheck) checks.push(installCheck);
  try {
    await ensureAdapterExecutionTargetCommandResolvable(command, target, cwd, ensurePathInEnv({ ...process.env, ...env }));
    checks.push({ code: `${def.type}_command_resolvable`, level: "info", message: `Command is executable: ${command}` });
  } catch (err) {
    checks.push({
      code: `${def.type}_command_unresolvable`,
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
    });
  }
  for (const key of def.authEnvKeys ?? []) {
    if (env[key] || (!targetIsRemote && process.env[key])) {
      checks.push({ code: `${def.type}_${key.toLowerCase()}_present`, level: "info", message: `${key} is available.` });
    }
  }
  return {
    adapterType: def.type,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
