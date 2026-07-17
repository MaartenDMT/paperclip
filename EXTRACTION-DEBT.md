# MAOS Company Plugin Extraction Debt

This file records MAOS and ReadersBase code that still lives in Paperclip core after the first plugin extraction slice.

The installable plugin is `plugins/maos-company`.
New plugin-owned records use its restricted `maos_company` database namespace.

## Campaign compatibility API

Retained core files:

- `server/src/routes/campaigns.ts`
- `server/src/services/campaigns.ts`
- `server/src/services/approvals.ts`
- `packages/shared/src/types/campaign.ts`
- `packages/shared/src/validators/campaign.ts`
- `packages/db/src/schema/campaigns.ts`

Reason:

The existing Work UI and regression suite still call core campaign routes.
The current plugin SDK can read approval summaries and receive approval events, but it cannot create a governed approval.
Removing the core service now would break phase-plan submission and approval-gated execution.

Next extraction:

Add a capability-gated approval creation and link API to `@paperclipai/plugin-sdk`.
Migrate the Work UI to the plugin page or scoped plugin API.
Add an explicit one-time migration from public campaign tables into the plugin namespace.
Then replace the legacy core routes with a time-bounded compatibility redirect and remove the public campaign schema.

## Company identifier compatibility

Retained core files:

- `packages/db/src/schema/companies.ts`
- `packages/shared/src/types/company.ts`
- `packages/shared/src/validators/company.ts`
- `server/src/services/companies.ts`

Reason:

Live companies already persist `maosCompanyId`, and external consumers read it through the normal company API.
The first plugin slice moves goal-to-MAOS-system bindings into `maos_company.goal_bindings`, but it does not migrate the company identifier yet.

Next extraction:

Add a plugin-owned company binding record and a migration that preserves existing identifiers.
Keep a read-only compatibility projection until every consumer uses the plugin API.

## Goal identifier compatibility

Retained core files:

- `packages/db/src/schema/goals.ts`
- `packages/shared/src/types/goal.ts`
- `packages/shared/src/validators/goal.ts`

Reason:

Existing goals already persist `maosSystemId` and current callers expect it on core goal objects.
The plugin now owns the normalized goal binding table and validates goal ownership through `ctx.goals`.

Next extraction:

Backfill plugin bindings from existing goal fields during install.
Move callers to `goal-bindings.list` and `goal-bindings.upsert`.
Remove the core field only after a compatibility window and data verification.

## First-class meeting records and UI

Retained core files:

- `server/src/services/meetings.ts`
- `server/src/services/issue-thread-interactions.ts`
- `server/src/routes/issues.ts` participant authorization touchpoint
- meeting tables under `packages/db/src/schema/meetings.ts`
- meeting types and validators in `packages/shared`
- current meeting UI surfaces

Reason:

Meetings are first-class board records with participants, issue links, contributions, wakeups, activity logs, and legacy interaction migration.
The plugin SDK does not expose first-class meeting CRUD or contribution APIs.
Core must still authorize an agent who answers a legacy meeting as a named participant.
Moving those records into private plugin storage now would hide governed work from the board and break existing links.

Moved now:

The plugin owns the MAOS trigger catalog, agendas, expected outputs, severity rules, recommendation construction, and recommendation persistence.
Core keeps a compact outcome compatibility shim so existing first-class meeting records and issue-thread tests continue to work.

Next extraction:

Add capability-gated meeting host APIs or promote meetings to a documented plugin-managed resource type.
Move recommendation and reconciliation callers to the worker.
Migrate public meeting rows only after the UI reads the plugin or managed-resource API.

## ReadersBase UI and template contracts

Retained core files:

- ReadersBase artifact bridge contracts in `packages/shared`
- company-template campaign definitions and template materialization surfaces
- existing campaign and meeting UI components

Reason:

This slice intentionally does not touch `packages/db/src/templates`, teams catalogs, skills catalogs, or UI schema coupling.
Another worker owns company-definition-to-Markdown work.

Next extraction:

Move ReadersBase-only UI to plugin slots after the plugin API replaces the legacy campaign endpoints.
Keep generic artifact and company-template contracts in shared only if upstream product behavior still uses them.
