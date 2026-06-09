# Real Agent Meetings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Paperclip work meetings behave like structured multi-agent operating reviews by collecting participant updates before chair synthesis.

**Architecture:** Keep meetings as first-class company coordination threads, not chat. Add a `meeting_contributions` table for per-agent structured updates, expose contribution submission through the meeting service/API, wake missing contributors before the chair, and show contributions in the board UI.

**Tech Stack:** TypeScript, Drizzle/PostgreSQL, Express REST routes, shared Zod validators/types, React + TanStack Query.

---

### Task 1: Meeting Contribution Contract

**Files:**
- Modify: `packages/shared/src/types/issue.ts`
- Modify: `packages/shared/src/validators/issue.ts`
- Test: `packages/shared/src/issue-thread-interactions.test.ts`

- [ ] **Step 1: Write the failing validator/type test**

Add a test that parses a valid contribution payload:

```ts
import { meetingContributionPayloadSchema } from "./validators/issue.js";

it("validates structured meeting contribution payloads", () => {
  expect(meetingContributionPayloadSchema.parse({
    summaryMarkdown: "Progress is healthy but the API decision is blocked.",
    progress: ["Finished schema review."],
    blockers: ["Need API owner."],
    risks: ["Review may slip."],
    nextActions: ["Assign owner."],
    proposedDecisions: ["Split API and UI work."],
    betterAlternatives: ["Move API work to platform team."],
  })).toMatchObject({
    summaryMarkdown: "Progress is healthy but the API decision is blocked.",
    blockers: ["Need API owner."],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/shared test -- issue-thread-interactions.test.ts`

Expected: FAIL because `meetingContributionPayloadSchema` is not exported.

- [ ] **Step 3: Add shared contract**

Add:

```ts
export interface MeetingContributionPayload {
  summaryMarkdown: string;
  progress: string[];
  blockers: string[];
  risks: string[];
  nextActions: string[];
  proposedDecisions: string[];
  betterAlternatives: string[];
}

export interface MeetingContributionSummary extends MeetingContributionPayload {
  id: string;
  meetingId: string;
  agentId: string;
  agentName: string | null;
  agentRole: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}
```

Add a Zod schema with trimmed strings, `summaryMarkdown` min 1/max 10000, and each list max 20 items/max 1000 chars per item.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @paperclipai/shared test -- issue-thread-interactions.test.ts`

Expected: PASS.

### Task 2: Meeting Contributions Persistence

**Files:**
- Modify: `packages/db/src/schema/meetings.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/migrations/0092_meeting_contributions.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Test: `server/src/__tests__/issue-thread-interactions-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Add tests that:

1. Insert a pending meeting with chair and participant.
2. Call `meetingService(db).contribute(meetingId, payload, { agentId })`.
3. Assert the meeting remains `pending`.
4. Assert participant status becomes `contributed`.
5. Assert `listForCompany()` includes `contributions`, `contributedAgentIds`, and `pendingParticipantAgentIds`.
6. Assert `reconcilePendingWorkflowWakeups()` wakes missing non-chair participants before the chair.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- server/src/__tests__/issue-thread-interactions-service.test.ts -t "meeting contributions"`

Expected: FAIL because `meetingContributions` and `contribute()` do not exist.

- [ ] **Step 3: Add table and migration**

Create `meeting_contributions` with:

```sql
CREATE TABLE IF NOT EXISTS "meeting_contributions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "meeting_id" uuid NOT NULL REFERENCES "meetings"("id") ON DELETE cascade,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "summary_markdown" text NOT NULL,
  "progress" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "next_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "proposed_decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "better_alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_contributions_meeting_agent_uq" ON "meeting_contributions" ("meeting_id","agent_id");
CREATE INDEX IF NOT EXISTS "meeting_contributions_company_meeting_idx" ON "meeting_contributions" ("company_id","meeting_id");
CREATE INDEX IF NOT EXISTS "meeting_contributions_company_agent_idx" ON "meeting_contributions" ("company_id","agent_id");
```

- [ ] **Step 4: Run tests again**

Run: `pnpm test -- server/src/__tests__/issue-thread-interactions-service.test.ts -t "meeting contributions"`

Expected: still FAIL because service behavior is missing.

### Task 3: Meeting Contribution Service

**Files:**
- Modify: `server/src/services/meetings.ts`
- Modify: `packages/shared/src/types/issue.ts`
- Test: `server/src/__tests__/issue-thread-interactions-service.test.ts`

- [ ] **Step 1: Implement `contribute()`**

Add `meetingService.contribute(meetingId, payload, actor)`:

```ts
async function contribute(meetingId: string, input: MeetingContributionPayload, actor: MeetingActor) {
  if (!actor.agentId) throw forbidden("Only meeting participants can contribute to this meeting");
  const meeting = await getMeetingById(meetingId);
  if (!meeting) throw notFound("Meeting not found");
  if (meeting.status !== "pending") throw conflict("Meeting has already been resolved");
  if (!(await isParticipant(meetingId, actor.agentId))) throw forbidden("Only meeting participants can contribute to this meeting");
  const payload = meetingContributionPayloadSchema.parse(input);
  upsert the contribution;
  set that participant status to "contributed";
  log "meeting.contributed";
  return the contribution row;
}
```

- [ ] **Step 2: Add contribution summaries to list output**

`listForCompany()` should attach:

```ts
contributions: MeetingContributionSummary[];
contributedAgentIds: string[];
pendingParticipantAgentIds: string[];
```

Pending means participant agents that have no contribution and are not the chair unless every non-chair has contributed, in which case the chair is pending synthesis.

- [ ] **Step 3: Update wake target selection**

`reconcilePendingWorkflowWakeups()` should:

1. Skip meetings with an active running meeting run.
2. Wake non-chair participants missing contributions first.
3. Wake the chair only after all non-chair runnable participants contributed.
4. Keep single-participant chair-only meetings working.

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm test -- server/src/__tests__/issue-thread-interactions-service.test.ts -t "meeting contributions"`

Expected: PASS.

### Task 4: REST API and Agent Guidance

**Files:**
- Modify: `server/src/routes/issues.ts`
- Modify: `server/src/services/heartbeat.ts`
- Modify: `packages/adapter-utils/src/server-utils.ts`
- Test: `server/src/__tests__/heartbeat-context-summary.test.ts`

- [ ] **Step 1: Add contribution endpoint**

Add:

```ts
POST /api/meetings/:meetingId/contributions
```

Agent access: same-company participant only. Board access: board may submit only with an explicit `agentId` if needed later; first version can reject board submissions to keep audit clear.

- [ ] **Step 2: Update wake guidance**

When a meeting wake is for a non-chair contributor, instruct:

```text
Submit your participant update with POST /api/meetings/{meetingId}/contributions before treating the heartbeat as complete.
```

When the wake is for the chair, instruct:

```text
Review participant contributions and then respond with POST /api/meetings/{meetingId}/respond.
```

- [ ] **Step 3: Run targeted guidance tests**

Run: `pnpm test -- server/src/__tests__/heartbeat-context-summary.test.ts`

Expected: PASS.

### Task 5: Board UI Visibility

**Files:**
- Modify: `ui/src/pages/WorkMeetings.tsx`
- Modify: `ui/src/api/issues.ts`
- Modify: `packages/shared/src/types/issue.ts`

- [ ] **Step 1: Show meeting readiness**

In meeting rows and detail modal, show:

```text
2/3 contributed
```

Use `contributedAgentIds.length / participantAgentIds.length`.

- [ ] **Step 2: Show participant contributions**

Add a detail section listing each contribution with agent name, summary, blockers, risks, next actions, proposed decisions, and better alternatives.

- [ ] **Step 3: Run UI typecheck**

Run: `pnpm --filter @paperclipai/ui typecheck`

Expected: PASS.

### Task 6: Final Verification

**Files:**
- All touched files

- [ ] **Step 1: Run focused tests**

Run:

```sh
pnpm test -- server/src/__tests__/issue-thread-interactions-service.test.ts -t "meeting"
pnpm test -- server/src/__tests__/heartbeat-context-summary.test.ts
pnpm --filter @paperclipai/shared test -- issue-thread-interactions.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck for touched packages**

Run:

```sh
pnpm --filter @paperclipai/db typecheck
pnpm --filter @paperclipai/server typecheck
pnpm --filter @paperclipai/ui typecheck
```

Expected: PASS.

