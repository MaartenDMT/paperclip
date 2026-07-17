# MAOS Company Plugin Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move severable MAOS campaign, company-goal binding, and meeting policy logic from Paperclip core into an installable automation plugin.

**Architecture:** Add a standalone local-path plugin at `plugins/maos-company`.
The worker owns campaign, phase, goal-binding, and meeting-recommendation records in its restricted database namespace and exposes JSON routes below `/api/plugins/:pluginId/api/*`.
Paperclip core keeps only upstream-owned entity operations and currently entangled compatibility paths.

**Tech Stack:** TypeScript, Vitest, esbuild, `@paperclipai/plugin-sdk`, PostgreSQL plugin namespaces.

## Global Constraints

- Do not touch `packages/db/src/templates` or teams and skills catalogs.
- Do not touch adapters or heartbeat capacity code.
- Add no external dependencies.
- Keep existing campaign and meeting behavior green.
- Record deferred extraction in root `EXTRACTION-DEBT.md`.

---

### Task 1: Plugin domain contracts

**Files:**
- Create: `plugins/maos-company/src/campaign-policy.ts`
- Create: `plugins/maos-company/src/meeting-policy.ts`
- Test: `plugins/maos-company/tests/domain.test.ts`

**Interfaces:**
- Produces: `assertCampaignPhaseTransition(current, next)`, `buildMeetingRecommendation(input)`, and `meetingWorkflowPolicy`.

- [ ] **Step 1: Write failing domain tests**

Test legal and illegal campaign transitions plus deterministic meeting severity, title, agenda, and expected outputs.

- [ ] **Step 2: Run the test and verify red**

Run: `pnpm exec vitest run --config plugins/maos-company/vitest.config.ts plugins/maos-company/tests/domain.test.ts`

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Add the minimum policy implementation**

Implement explicit transition sets and pure meeting recommendation data.

- [ ] **Step 4: Run the test and verify green**

Run the command from step 2.

Expected: PASS.

### Task 2: Plugin manifest, namespace, and worker API

**Files:**
- Create: `plugins/maos-company/src/manifest.mjs`
- Create: `plugins/maos-company/src/worker.ts`
- Create: `plugins/maos-company/migrations/001_initial.sql`
- Test: `plugins/maos-company/tests/plugin.spec.ts`
- Test: `server/src/__tests__/maos-company-plugin-loader.test.ts`

**Interfaces:**
- Consumes: policy functions from Task 1.
- Produces: campaign CRUD, phase CRUD/transitions, company-goal binding CRUD, meeting policy, and meeting recommendation routes.

- [ ] **Step 1: Write failing manifest and worker tests**

Validate the manifest categories, capabilities, namespace declaration, route declarations, and worker setup registrations.

- [ ] **Step 2: Run the tests and verify red**

Run: `pnpm exec vitest run --config plugins/maos-company/vitest.config.ts`

Expected: FAIL until the package implementation exists.

- [ ] **Step 3: Add namespace migration and worker handlers**

Use only `ctx.db` for plugin-owned records and host clients for core company, goal, agent, project, issue, document, and activity operations.

- [ ] **Step 4: Build and verify loader compatibility**

Run: `pnpm --dir plugins/maos-company build`.
Then run the focused server loader test.

Expected: manifest loads and validates through `pluginLoader.loadManifest()`.

### Task 3: Core boundary and extraction debt

**Files:**
- Modify only identified campaign/meeting compatibility files where a safe deletion is proven.
- Create: `EXTRACTION-DEBT.md`

**Interfaces:**
- Consumes: plugin API route contract.
- Produces: explicit retained-core boundary and measured core delta reduction.

- [ ] **Step 1: Remove duplicated severable core policy only where callers can use the plugin boundary**

Do not replace out-of-process calls with direct source imports from the plugin.

- [ ] **Step 2: Record entangled persistence, approval, UI, and migration debt**

Each debt item names the retained file, reason, and required future host capability.

- [ ] **Step 3: Run focused campaign, meeting, issue-thread, shared, plugin, typecheck, and loader tests**

Use the smallest relevant Vitest invocations first.

- [ ] **Step 4: Measure and commit**

Compare `git diff upstream/master --numstat -- server/src` before and after.
Review `git diff --check`, status, and staged diffs before each logical commit.
