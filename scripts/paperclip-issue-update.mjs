#!/usr/bin/env node

import { stdin, env, exit } from "node:process";

function usage() {
  console.log(`Usage:
  node scripts/paperclip-issue-update.mjs [--issue-id ID] [--status STATUS] [--comment TEXT] [--dry-run]

Reads a multiline markdown comment from stdin when stdin is piped. This preserves
newlines when building the JSON payload for PATCH /api/issues/{issueId}.

Examples:
  node scripts/paperclip-issue-update.mjs --issue-id "$PAPERCLIP_TASK_ID" --status in_progress <<'MD'
  Investigating formatting

  - Pulled the raw comment body
  - Comparing it with the run transcript
  MD

  node scripts/paperclip-issue-update.mjs --issue-id "$PAPERCLIP_TASK_ID" --status done --dry-run <<'MD'
  Done

  - Fixed the issue update helper
  MD`);
}

function readArg(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

async function readStdinIfPiped() {
  if (stdin.isTTY) return "";
  const chunks = [];
  return await new Promise((resolve, reject) => {
    let settled = false;
    let quietTimer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (quietTimer) clearTimeout(quietTimer);
      stdin.off("data", onData);
      stdin.off("end", finish);
      stdin.off("error", reject);
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const scheduleQuietFinish = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, 250);
      quietTimer.unref?.();
    };
    const onData = (chunk) => {
      chunks.push(Buffer.from(chunk));
      scheduleQuietFinish();
    };
    stdin.on("data", onData);
    stdin.once("end", finish);
    stdin.once("error", reject);
    scheduleQuietFinish();
    stdin.resume();
  });
}

function parseCandidates(primary, rawCandidates) {
  const values = [];
  if (primary.trim()) values.push(primary.trim());
  if (rawCandidates.trim()) {
    try {
      const parsed = JSON.parse(rawCandidates);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item.trim()) values.push(item.trim());
        }
      }
    } catch {
      // Ignore malformed optional candidates; the primary URL still applies.
    }
  }
  return [...new Set(values.map((value) => value.replace(/\/+$/, "")))];
}

async function requestIssueUpdate(apiUrl, issueId, payload) {
  const timeoutMs = Number(env.PAPERCLIP_API_TIMEOUT_SECONDS ?? 30) * 1000;
  const response = await fetch(`${apiUrl}/api/issues/${encodeURIComponent(issueId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${env.PAPERCLIP_API_KEY}`,
      "X-Paperclip-Run-Id": env.PAPERCLIP_RUN_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 30_000),
  });
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}

async function main() {
  const args = process.argv.slice(2);
  let issueId = env.PAPERCLIP_TASK_ID ?? "";
  let status = "";
  let comment = "";
  let dryRun = false;

  for (let index = 0; index < args.length;) {
    const arg = args[index];
    if (arg === "--issue-id") {
      issueId = readArg(args, index, arg);
      index += 2;
    } else if (arg === "--status") {
      status = readArg(args, index, arg);
      index += 2;
    } else if (arg === "--comment") {
      comment = readArg(args, index, arg);
      index += 2;
    } else if (arg === "--dry-run") {
      dryRun = true;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      return 0;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!issueId.trim()) throw new Error("Missing issue id. Pass --issue-id or set PAPERCLIP_TASK_ID.");
  if (!comment) comment = await readStdinIfPiped();

  const payload = {
    ...(status.trim() ? { status: status.trim() } : {}),
    ...(comment ? { comment } : {}),
  };

  if (dryRun) {
    console.log(JSON.stringify(payload));
    return 0;
  }

  if (!env.PAPERCLIP_API_URL || !env.PAPERCLIP_API_KEY || !env.PAPERCLIP_RUN_ID) {
    throw new Error("Missing PAPERCLIP_API_URL, PAPERCLIP_API_KEY, or PAPERCLIP_RUN_ID.");
  }

  const candidates = parseCandidates(env.PAPERCLIP_API_URL, env.PAPERCLIP_API_CANDIDATES_JSON ?? "[]");
  let lastNetworkError = "";

  for (const apiUrl of candidates) {
    try {
      const response = await requestIssueUpdate(apiUrl, issueId, payload);
      if (response.ok) {
        if (response.body) console.log(response.body);
        return 0;
      }
      if (response.body) console.error(response.body);
      throw new Error(`Paperclip API rejected issue update with HTTP ${response.status} from ${apiUrl}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/HTTP \d{3}/.test(message)) throw error;
      lastNetworkError = `${apiUrl}: ${message}`;
    }
  }

  throw new Error(
    `Paperclip API unreachable from this agent. Tried candidates from PAPERCLIP_API_URL/PAPERCLIP_API_CANDIDATES_JSON.${
      lastNetworkError ? ` Last error: ${lastNetworkError}` : ""
    }`,
  );
}

main()
  .then((code) => exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    exit(1);
  });
