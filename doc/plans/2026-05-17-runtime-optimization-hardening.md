# Runtime Optimization Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe runtime/UI optimization primitives inspired by upstream Codex/OpenCode performance PRs without changing Paperclip execution semantics.

**Architecture:** Keep existing endpoints backward-compatible while adding cursor metadata, log summary mode, and phase-level timing logs. Avoid large API redesigns in this pass; expose primitives that UI/API callers can adopt incrementally.

**Tech Stack:** Express routes, Drizzle queries, TypeScript API clients, Vitest targeted tests.

---

### Task 1: Heartbeat Run List Cursor Metadata

**Files:**
- Modify: `server/src/services/heartbeat.ts`
- Modify: `server/src/routes/agents.ts`
- Modify: `ui/src/api/heartbeats.ts`
- Test: `ui/src/api/heartbeats.test.ts`

- [x] **Step 1: Add a list response wrapper type in the UI client**

Update `ui/src/api/heartbeats.ts` so `heartbeatsApi.listPage()` returns `{ runs, nextCursor }` and `heartbeatsApi.list()` remains backward-compatible by returning only `runs`.

- [x] **Step 2: Add route cursor parsing**

Update `GET /companies/:companyId/heartbeat-runs` to accept `cursorCreatedAt` and `cursorId`, pass them into the heartbeat service, and return wrapped output when `page=cursor`.

- [x] **Step 3: Add service cursor filter**

Update `heartbeat.list()` to accept options while preserving the old positional signature. Cursor filtering must order by `createdAt desc, id desc` and fetch `limit + 1` rows to compute `nextCursor`.

- [x] **Step 4: Verify**

Run `pnpm exec vitest run ui/src/api/heartbeats.test.ts`.

### Task 2: Run Log Metadata and Summary Mode

**Files:**
- Modify: `server/src/services/run-log-store.ts`
- Modify: `server/src/services/heartbeat.ts`
- Modify: `server/src/routes/agents.ts`
- Modify: `ui/src/api/heartbeats.ts`

- [x] **Step 1: Add log stat support**

Expose `stat(handle)` from `RunLogStore` returning `{ bytes }`.

- [x] **Step 2: Add `metadataOnly=true` to run log route**

When set, return run id, store, ref, and byte size without reading content.

- [x] **Step 3: Preserve existing log route behavior**

Existing `/heartbeat-runs/:runId/log?offset=&limitBytes=` response shape must remain unchanged for current UI callers.

### Task 3: Latency Timing Logs

**Files:**
- Modify: `server/src/routes/agents.ts`

- [x] **Step 1: Add route timing helper**

Add a small local helper that records elapsed ms and logs with route name, company/run ids, and row/byte counts.

- [x] **Step 2: Instrument heavy heartbeat endpoints**

Instrument heartbeat list, live-runs, events, and log endpoints.

### Task 4: Verification

**Files:**
- Test commands only.

- [x] **Step 1: Run focused tests**

Run `pnpm exec vitest run ui/src/api/heartbeats.test.ts`.

- [ ] **Step 2: Run TypeScript checks for touched areas**

Run `pnpm --filter @paperclipai/server exec tsc --noEmit --pretty false` and `pnpm --filter @paperclipai/ui exec tsc --noEmit --pretty false` if they complete within the environment timeout.

Result: package-level server and UI TypeScript checks timed out in this workspace after 4 minutes without diagnostics. Focused Vitest coverage for touched server/UI paths passed.

- [x] **Step 3: Run whitespace validation**

Run `git diff --check`.
