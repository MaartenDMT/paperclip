# Paperclip productivity & observability backlog

Implementation-ready specs for keeping agents productive and adding the visibility
the operator asked for. Each item is sized small enough to ship as a single PR.

Status legend: `READY` = spec complete, no design questions left.
Order is **ROI-descending** — ship top-to-bottom.

---

## 1. Skill-activation visibility (operator request) — READY

**Goal:** see at a glance which skills a heartbeat actually invoked, so loops
and unused-skill bloat surface immediately.

### 1a. Schema
Add table `run_skill_events`:
```
id            text  pk
run_id        text  fk -> runs.id, indexed
skill_name    text  not null
plugin_scope  text  null     -- e.g. "vercel" for "vercel:bootstrap"
invoked_at    timestamptz default now()
duration_ms   integer null
outcome       text  null     -- "ok" | "error" | "noop"
```
Drizzle migration in `server/src/db/schema.ts` + `server/src/db/migrations/`.

### 1b. Capture in adapters
In each `packages/adapters/*/src/server/execute.ts`, parse the SDK tool-use
stream. When a `Skill` tool call (or platform equivalent — see per-adapter notes)
is emitted, append `{ runId, skill, plugin, invokedAt, durationMs, outcome }` to
the table.

Per-adapter notes:
- **claude-local**: parse Anthropic stream for `tool_use` blocks where
  `name === "Skill"` and read `input.skill`.
- **codex-local**: codex emits `skill_invoked` notifications on the app-server
  RPC channel; hook the existing notification listener.
- **opencode-local**: skill activation appears as a `skill` event in the
  opencode message stream — extend the existing event router.

### 1c. API surface
- Extend `GET /api/runs/{runId}` response with `skillEvents: [...]`.
- New `GET /api/companies/{companyId}/skill-usage?since=24h` — aggregates
  skill → count → done/blocked/cancelled outcome breakdown.
- Inject into `GET /api/issues/{issueId}/heartbeat-context` so the next heartbeat
  sees what its previous heartbeat invoked (helps avoid double-invocation).

### 1d. Surface in comments
In `server/src/services/heartbeat.ts`, when the run posts its final status
comment, append a one-line footer:
```
Skills used: paperclip, diagnose-why-work-stopped, using-git-worktrees (3)
```
Gate behind `company.settings.showSkillsInComments` (default true).

### 1e. UI badge
On the issue detail page, render chips per heartbeat using the data from 1c.
Hover tooltip: invocation timestamp + duration + outcome.

**Files touched:**
`server/src/db/schema.ts`, `server/src/db/migrations/*`,
`packages/adapters/{claude,codex,opencode}-local/src/server/execute.ts`,
`server/src/services/runs.ts`, `server/src/routes/runs.ts`,
`server/src/services/heartbeat.ts` (comment footer),
`web/src/components/IssueDetail/SkillChips.tsx` (new).

---

## 2. Routine health telemetry + auto-pause — READY

**Goal:** noisy routines surface themselves before they flood the queue
(the antidote to the 200-issue cleanup we just did).

### 2a. Telemetry fields
Extend `routine_runs` table with:
```
status_changes_made  integer default 0   -- count of issue mutations this run
duration_ms          integer
```
On every routine run, set `status_changes_made = 0` when nothing was mutated.

### 2b. Health view
`GET /api/companies/{companyId}/routines/health` returns:
```json
[
  {
    "routineId": "...",
    "lastFiredAt": "...",
    "lastSuccessAt": "...",
    "consecutiveFailures": 0,
    "noopRate20": 0.85,    // last 20 runs that did nothing
    "avgDurationMs": 4231,
    "autoPaused": false
  }
]
```

### 2c. Auto-pause
Background job (extend `server/src/services/routines.ts`):
- if `consecutiveFailures >= 5` → pause + create approval request
- if `noopRate20 > 0.8` AND `total_runs > 20` → pause + create approval

Paused routines require board approval to reactivate. Approval payload
includes top 3 most recent failure reasons + a 7-day signal chart.

### 2d. Self-test routine
Built-in routine `self_test_company`. Every 6h:
1. Create a `noop_test` issue, assign to a fixed test agent
2. Verify the agent flips it to `done` within 2 min
3. If not, fire a `system_unhealthy` notification to CEO

**Files touched:**
`server/src/db/schema.ts`, `server/src/services/routines.ts`,
`server/src/routes/routines.ts` (new health endpoint),
`server/src/services/routines/self-test.ts` (new).

---

## 3. Recovery dismissal record extensions — READY

**Goal:** close the last amplifier escape hatch from the cancel-then-recreate
cleanup we did this session.

### 3a. Transitive dismissal
In `server/src/services/recovery/service.ts`, before creating a stranded-issue
recovery for issue X, also check whether X's `parentId` (and its parent, up
to depth 3) has a cancelled-recovery dismissal record. If yes, suppress for X
with log `recovery.skipped_stranded_issue_recovery_parent_dismissed`.

Rationale: when an operator cancelled a recovery on the parent, they intend
the whole subtree to stay quiet.

### 3b. Dismissal dashboard
`GET /api/companies/{companyId}/recovery-dismissals` lists all cancelled
recovery markers with: source-issue title, dismissed-by user/agent, dismissed-at,
"un-dismiss" action.

`POST /api/companies/{companyId}/recovery-dismissals/{id}/revoke` re-arms the
watchdog by deleting the dismissal marker.

### 3c. `cancelledByKind` enum
Add column `cancelled_by_kind` to `issues`:
`'agent' | 'user' | 'recovery' | 'cycle_detector' | 'cleanup_sweep'`.
Backfill: existing cancelled issues → `'user'`. Future cancellations route
through `cancelIssue(reason, kind)` helper. Makes future cleanup audits trivial.

**Files touched:**
`server/src/services/recovery/service.ts`,
`server/src/routes/recovery.ts` (new),
`server/src/db/schema.ts`.

---

## 4. Wake-storm dampener — READY

**Goal:** prevent post-cleanup heartbeat stampede when 100+ issues mutate at once.

In `server/src/services/heartbeat.ts` wake dispatcher:
- maintain in-memory `recentWakeReasons: Map<agentId, RingBuffer<{reason, ts}>>`
- if an agent received `>= 20` wakes in the last 60s with the same reason
  (e.g. `issue_status_changed`), coalesce remaining wakes into one composite
  `bulk_state_change` wake carrying `affectedIssueIds: string[]`.

The agent skill can then prioritise the batch instead of doing 20 heartbeats.

**Files touched:**
`server/src/services/heartbeat.ts`,
`skills/paperclip/SKILL.md` (document `bulk_state_change` wake reason).

---

## 5. Heartbeat token-saver: `firstUnreadCommentIndex` — READY

**Goal:** -30% input tokens on busy issues; agents stop replaying full thread.

In `GET /api/issues/{issueId}/heartbeat-context` response:
- track per-agent `lastSeenCommentId` in `agent_issue_view` table
- compute `firstUnreadCommentIndex` and `unreadCount`
- payload includes only `comments[firstUnreadCommentIndex:]` by default; full
  thread is available via `?includeFullThread=true`.

**Files touched:**
`server/src/db/schema.ts` (new `agent_issue_view`),
`server/src/routes/issues.ts` (heartbeat-context handler),
`skills/paperclip/SKILL.md` (document incremental usage).

---

## 6. Heartbeat cost ledger — READY

**Goal:** see runaway agents in cost before they're noticed by ops.

Every adapter already receives token usage from the model SDK. Persist it.

### 6a. Schema
New table `run_cost`:
```
run_id    text pk
input_tokens   integer
output_tokens  integer
cache_read_tokens     integer
cache_write_tokens    integer
estimated_cost_usd    numeric(10,4)
```

### 6b. Capture
In each adapter `execute.ts`, after the model loop, insert one row.
Estimate cost via `pricing.ts` (per-model rate table, manually maintained
or fetched from a small static config).

### 6c. Aggregate views
`GET /api/companies/{id}/cost?groupBy=agent|issue|day` returns sortable rows.
UI dashboard shows top 10 spend by agent (last 7d).

**Files touched:**
`server/src/db/schema.ts`,
`packages/adapters/{claude,codex,opencode}-local/src/server/execute.ts`,
`server/src/services/pricing.ts` (new),
`server/src/routes/cost.ts` (new).

---

## 7. Inbox prioritisation by blocker-depth — READY

**Goal:** agents stop picking issues whose blockers are 3+ hops away.

In `GET /api/agents/me/inbox-lite`, compute per-issue `blockerDepth` (number
of unresolved transitive blockers). Sort:
```
score = priorityWeight * recencyWeight * (1 / (1 + blockerDepth))
```
Filter out items with `blockerDepth >= 3` unless wake reason is
`issue_blockers_resolved` for that exact issue.

**Files touched:** `server/src/routes/agents.ts`.

---

## 8. Adapter base-class extraction — READY (refactor, no behaviour change)

**Goal:** kill ~60% duplication across the 3 local adapters.

Extract `packages/adapter-utils/src/local-adapter-base.ts`:
```ts
export abstract class LocalAdapterBase {
  abstract spawnCommand(): { command: string; args: string[] }
  abstract parseToolEvents(stream: ReadableStream): AsyncIterable<ToolEvent>
  protected buildEnv(...) { /* uses applyAdapterConfigEnv */ }
  protected captureSkillEvents(...) { /* feature 1b above */ }
  protected captureCost(...) { /* feature 6b above */ }
  protected handlePaperclipWorkspace(...) { /* shared workspace wiring */ }
}
```

Each `claude-local`, `codex-local`, `opencode-local` adapter then extends this
class and only implements the adapter-specific parts.

Already-shipped helper `applyAdapterConfigEnv` is step 1 of this. Steps 2-4
extract: spawn/IPC, heartbeat streaming, skill-event parsing.

**Files touched:**
`packages/adapter-utils/src/local-adapter-base.ts` (new),
`packages/adapters/{claude,codex,opencode}-local/src/server/execute.ts`
(slimmed to ~200 LOC each).

---

## 9. Issue-graph cycle guard — READY

**Goal:** reject any mutation that would create a cycle in
`parent ∪ blockedBy`.

In `server/src/services/issues.ts` `updateIssue()`:
- before commit, compute the new dep-graph
- run a 3-line DFS to detect cycles
- reject with 422 if any cycle found, error message names the cycle

`blockedByIssueIds` already does pairwise check — this adds transitive
guard across `parentId` chains.

**Files touched:** `server/src/services/issues.ts`.

---

## 10. Skill-loop warning — READY

**Goal:** auto-detect a skill stuck activating itself.

In feature 1b capture path: if same skill activates `>= 3` times in a single
run, fire a `recovery.skill_loop_suspected` log + post a tag on the run
record. Surface in the run detail page so the operator can flag the agent's
prompt or skill description as buggy.

**Files touched:** wherever 1b lands.

---

## How to dispatch this work

These ten items are independent (except #1b/#6b/#10 share a code path, ship #1
first). Each fits in a single PR. Recommended cadence:

1. Week 1: items 1, 2, 3, 4 (visibility + defensive)
2. Week 2: items 5, 6, 7 (cost + speed wins)
3. Week 3: items 8, 9, 10 (cleanup + safety)

For each PR follow `rules/common/development-workflow.md`: planner → TDD →
code-reviewer → commit.

---

## Already shipped (context for these specs)

- `applyAdapterConfigEnv` helper that protects Paperclip-owned env keys
  (`e817d5f4`) — prerequisite for adapter base-class.
- Permanent dismissal records for stranded-issue recovery and stale-active-run
  evaluation (`9357370a`) — items #3a/#3b extend this.
- 200 noise issues cancelled, 1 unblocked during the cleanup that motivated
  this backlog.
