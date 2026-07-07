# ReadersBase Publishing Company Template Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Convert the current ReadersBase fiction runtime audit into reusable Paperclip template definitions and a seedable publishing-company operating model.

**Architecture:** Keep Paperclip core focused on generic reusable company-template plumbing and a template runner that writes normal Paperclip entities. Put the ReadersBase-specific publishing org, campaign phases, artifact requirements, and bridge metadata in a template package/module. Keep live ReadersBase catalog mutation and taxonomy synchronization behind a future bridge adapter so Paperclip does not duplicate ReadersBase domain truth.

**Tech Stack:** TypeScript, Drizzle/PostgreSQL, Express REST services, shared zod validators/types, Vitest, existing Paperclip company portability and campaign/document/issue services.

---

## 1. Current repo evidence

Read before planning:

- `AGENTS.md` says V1 is defined by `doc/SPEC-implementation.md`, new repo plans belong in `doc/plans/YYYY-MM-DD-slug.md`, and company boundaries must be enforced in routes/services.
- `doc/GOAL.md` defines Paperclip as the autonomous-company control plane, not the execution or domain-content plane.
- `doc/PRODUCT.md` keeps Paperclip centered on companies, org charts, goals, issues/comments, budgets, approvals, work products, and plugins.
- `doc/SPEC-implementation.md` makes all business records company-scoped and defines strict org trees, campaigns, documents, approvals, issues, costs, and activity logs as V1 primitives.
- `doc/DEVELOPING.md` confirms `pnpm test` / targeted Vitest as the normal smallest verification path.
- `doc/DATABASE.md` confirms normal schema/migration workflow and that campaign phase plans/results already use existing `documents` and `document_revisions`.

Inspected implementation surfaces:

- Current ReadersBase one-off audit/remediation:
  - `packages/db/src/readersbase-fiction-runtime-audit.ts`
  - `packages/db/src/readersbase-fiction-runtime-audit.test.ts`
- Company import/export and portable company shape:
  - `packages/shared/src/types/company-portability.ts`
  - `packages/shared/src/validators/company-portability.ts`
  - `server/src/services/company-portability.ts`
  - `server/src/routes/companies.ts`
  - `cli/src/commands/client/company.ts`
- Core company/org/project/goal/issue/campaign/artifact surfaces:
  - `packages/db/src/schema/agents.ts`
  - `packages/db/src/schema/campaigns.ts`
  - `packages/db/src/schema/documents.ts`
  - `packages/db/src/schema/issue_documents.ts`
  - `packages/db/src/schema/issue_work_products.ts`
  - `packages/db/src/schema/approvals.ts`
  - `server/src/services/agents.ts`
  - `server/src/services/campaigns.ts`
  - `server/src/services/work-products.ts`
  - `packages/shared/src/types/campaign.ts`
  - `packages/shared/src/types/work-product.ts`
- Basic seed precedent:
  - `packages/db/src/seed.ts`

Important current constraints:

- There is no first-class `company_templates` table or generic template registry today.
- Company portability can already import/export company, agents, projects, issues, skills, env inputs, comments, project workspaces, and metadata.
- Portability does not currently cover campaigns, campaign phases, issue documents, approvals, or work products, so it is not enough by itself for the ReadersBase publishing workflow.
- Campaigns and campaign phases already exist and are a better fit than adding a parallel workflow engine.
- Work products already support generic `artifact` and `document` types plus arbitrary metadata; that is enough for the initial artifact contract.

---

## 2. Core vs template vs bridge decisions

### Stays in Paperclip core

Generic, reusable capabilities that any company template could need:

1. A typed company-template definition format in shared code.
2. A template materializer service that creates normal Paperclip entities transactionally:
   - company
   - agents with strict `reportsTo` tree
   - goals
   - projects
   - optional starter issues
   - campaigns and campaign phases
   - phase plan documents
   - issue documents and work products where applicable
3. A CLI/server command path for dry-run and apply.
4. Validation of company boundaries, reporting-tree references, slug uniqueness, and adapter-config override inputs.
5. Tests proving template definitions materialize into existing tables without violating V1 invariants.

### Lives in the ReadersBase template seed/module

ReadersBase-specific operating content:

1. Publishing company name, mission, issue prefix, budget defaults, approval posture.
2. Agent roster and org chart:
   - CEO / Publisher-in-Chief
   - Production, Research, Story Architecture, Genre, Format, Drafting, Editorial, Publishing, QA & Artifact Library, ReadersBase Bridge leads
   - specialist agents under each lead
3. Agent capabilities, role names, icons, default runtime config, and default adapter assumptions.
4. Publishing campaign phase template:
   - Research
   - Analysis
   - Story-design
   - Draft
   - Editorial
   - Publishing
5. Markdown templates for plans/results/handoffs/checklists.
6. Artifact contract metadata keys and required artifact lists.
7. Initial campaign seed command/service for a book/series/anthology/format-conversion campaign.

### Future bridge, not this implementation

Defer until Paperclip can talk to ReadersBase as an external system:

1. Live Reads from ReadersBase taxonomy modules/API.
2. Validation of canonical ReadersBase genre/subgenre/work-type keys against live ReadersBase source.
3. ReadersBase ingest/update manifest submission.
4. Catalog mutation, file upload, external publication, and rollback.
5. Cross-repo package dependency on ReadersBase shared types.

Initial implementation should store bridge intent in metadata/work products and keep validation as a placeholder interface.

---

## 3. Data model and migration decision

### Decision: no migration for v1 template seed

Use existing tables and metadata fields first.

Why no migration:

- `agents.metadata`, `projects.metadata`, `issues.metadata`, `issue_work_products.metadata`, campaign fields, `documents`, and `approvals.payload` already support the needed template identity and artifact metadata.
- The seed can be idempotent by natural keys in code (`company.issuePrefix`, template slug, agent slug/name, project slug/name, phase sequence/title, issue origin fields) without a new template-instance table.
- Avoids schema churn while the template contract is still experimental.

Add a migration only in a follow-up if these become product requirements:

- UI needs to list installed templates and versions.
- Operators need to upgrade an existing company from template version N to N+1.
- Multiple template packages need lifecycle tracking, provenance, and marketplace-style install state.

Future migration candidate:

- `company_template_installations(id, company_id, template_slug, template_version, source_kind, source_locator, installed_at, installed_by_user_id, metadata jsonb)`.

---

## 4. Proposed template contract

Create a generic contract in shared code, then put ReadersBase values in a separate definition file.

### New shared types

Create `packages/shared/src/types/company-template.ts`:

- `CompanyTemplateDefinition`
- `CompanyTemplateCompanyDefinition`
- `CompanyTemplateAgentDefinition`
- `CompanyTemplateGoalDefinition`
- `CompanyTemplateProjectDefinition`
- `CompanyTemplateCampaignDefinition`
- `CompanyTemplateCampaignPhaseDefinition`
- `CompanyTemplateIssueDefinition`
- `CompanyTemplateArtifactContract`
- `CompanyTemplateSeedOptions`
- `CompanyTemplateMaterializationPlan`
- `CompanyTemplateMaterializationResult`

Minimum shape:

```ts
export interface CompanyTemplateDefinition {
  schemaVersion: 1;
  slug: string;
  version: string;
  name: string;
  description: string;
  company: CompanyTemplateCompanyDefinition;
  agents: CompanyTemplateAgentDefinition[];
  goals: CompanyTemplateGoalDefinition[];
  projects: CompanyTemplateProjectDefinition[];
  campaignTemplates: CompanyTemplateCampaignDefinition[];
  artifactContracts: CompanyTemplateArtifactContract[];
}
```

Key rules:

- References use template slugs, not database IDs.
- Runtime materialization resolves slugs to IDs in one transaction.
- Agent adapter config must be overrideable at seed time so a user can choose Codex, Claude, process, HTTP, or an external plugin without editing the template.
- ReadersBase bridge references are metadata, not foreign keys.

### New validators

Create `packages/shared/src/validators/company-template.ts` with zod schemas matching the types.

Validation must reject:

- duplicate slugs inside each entity group
- missing `reportsToSlug` references
- more than one root CEO unless explicitly allowed later
- campaign phase duplicate sequence numbers
- artifact contracts without owner phase/project
- adapter config values that are not records

Export from:

- `packages/shared/src/types/index.ts`
- `packages/shared/src/index.ts`
- validators barrel exports if present in neighboring code

---

## 5. ReadersBase template definitions

Create `packages/db/src/templates/readersbase-publishing.ts` for now.

Reason: the existing audit script is already in `packages/db/src`, seed/materialization will need Drizzle access, and this avoids mixing ReadersBase operating content into server routes. If this graduates to plugin/ClipHub later, the definition can move without changing the generic contract.

### Company definition

- slug: `readersbase-publishing`
- name: `ReadersBase Publishing`
- issue prefix: `RB`
- description: AI publishing company for ReadersBase-native fiction and narrative content.
- status: active
- `requireBoardApprovalForNewAgents`: true by default for safety
- metadata:
  - `templateSlug`
  - `templateVersion`
  - `domain: readersbase-publishing`
  - `bridge: readersbase`

### Department/projects

Create stable projects:

1. `production`
2. `research`
3. `story-architecture`
4. `genre`
5. `format`
6. `drafting`
7. `editorial`
8. `publishing`
9. `qa-artifact-library`
10. `readersbase-bridge`

Each project gets metadata:

- `templateSlug`
- `departmentSlug`
- `artifactPolicy`
- optional `readersBaseBridgeRole`

### Agent org chart

Use a strict Paperclip tree:

```text
publisher-in-chief
├─ head-of-production
│  ├─ production-planner
│  └─ schedule-budget-controller
├─ head-of-research
│  ├─ market-audience-researcher
│  ├─ setting-domain-researcher
│  └─ comparative-works-analyst
├─ head-of-story-architecture
│  ├─ premise-architect
│  ├─ plot-structure-architect
│  ├─ character-architect
│  └─ continuity-keeper
├─ head-of-genre
│  ├─ genre-taxonomy-liaison
│  ├─ tropes-promise-analyst
│  └─ subgenre-fit-reviewer
├─ head-of-format
│  ├─ novel-novella-format-editor
│  ├─ short-serial-format-editor
│  ├─ interactive-story-designer
│  ├─ storybook-designer
│  └─ graphic-visual-narrative-designer
├─ head-of-drafting
│  ├─ scene-drafter
│  ├─ dialogue-specialist
│  ├─ prose-stylist
│  └─ revision-integrator
├─ head-of-editorial
│  ├─ developmental-editor
│  ├─ line-editor
│  ├─ copy-editor
│  └─ sensitivity-risk-reviewer
├─ head-of-publishing
│  ├─ metadata-catalog-editor
│  ├─ export-packaging-specialist
│  ├─ launch-copywriter
│  └─ distribution-coordinator
└─ head-of-qa-artifact-library
   ├─ continuity-qa-analyst
   ├─ artifact-librarian
   ├─ readersbase-bridge-qa
   └─ final-acceptance-reviewer
```

The existing audit’s fiction agents map into this template as follows:

- `Fiction Director` -> `Publisher-in-Chief` or `Head of Story Architecture` depending on migration mode.
- `Research & Classification Agent` -> `Genre Taxonomy Liaison` plus `Market & Audience Researcher` responsibilities.
- `Series Architect` -> `Plot & Structure Architect` / optional future specialist.
- `Genre-Mix Architect`, `Sci-Fi Architect`, `Fantasy Architect` -> `Tropes & Promise Analyst` / `Subgenre Fit Reviewer` specializations or optional template add-ons.

Do not delete the old audit in the first implementation. Mark it legacy and have it import shared ReadersBase prompt notes/agent-role constants once the template constants exist.

---

## 6. Artifact contract types

Use existing `issue_documents` and `issue_work_products` for v1.

### Shared artifact contract model

Add the following template-level concepts, not database enums:

- `ArtifactKind`: `markdown_document | json_manifest | manuscript | outline | bible | checklist | qa_report | package | external_link`
- `ArtifactLifecycleStatus`: `draft | review_ready | approved | superseded | published`
- `ArtifactReviewGate`: `lead_review | ceo_review | board_approval | bridge_validation | final_acceptance`

Map to existing storage:

- Markdown artifacts -> `documents` + `issue_documents.key`
- Generated files/links -> `issue_work_products` with `type: "artifact"` or `type: "document"`
- Status -> `issue_work_products.status` where possible (`draft`, `ready_for_review`, `approved`, `archived`) plus exact template status in `metadata.templateStatus`
- Review gate -> `reviewState` and/or `approvals.payload`

Recommended `issue_work_products.metadata`:

```ts
{
  templateSlug: "readersbase-publishing",
  campaignPhaseSlug: "research",
  artifactKind: "qa_report",
  templateStatus: "review_ready",
  downstreamConsumer: "readersbase-bridge-qa",
  readersBase: {
    workTypeKey?: string,
    genreKeys?: string[],
    subgenreKeys?: string[],
    contentId?: string,
    seriesId?: string,
    collectionId?: string
  }
}
```

---

## 7. Campaign phase seed service

Create a seed/materialization service that can:

1. Install the reusable company template.
2. Create a new content campaign inside an existing ReadersBase Publishing company.
3. Seed the six campaign phases with plan documents.
4. Optionally create the first execution issue for the Research phase.

Suggested files:

- `packages/db/src/templates/company-template-materializer.ts`
- `packages/db/src/templates/readersbase-publishing.ts`
- `packages/db/src/templates/readersbase-campaign-seed.ts`
- `packages/db/src/templates/index.ts`
- `packages/db/src/readersbase-publishing-template.ts` (CLI entrypoint) or `scripts/seed-readersbase-publishing-template.ts`

CLI shape:

```sh
pnpm --filter @paperclipai/db tsx src/readersbase-publishing-template.ts --dry-run
pnpm --filter @paperclipai/db tsx src/readersbase-publishing-template.ts --apply
pnpm --filter @paperclipai/db tsx src/readersbase-publishing-template.ts --apply --company "ReadersBase Publishing"
pnpm --filter @paperclipai/db tsx src/readersbase-publishing-template.ts --apply --seed-campaign --campaign-title "..." --format novel
```

Dry-run output should list:

- company create/update
- agents create/update/skip
- projects create/update/skip
- goals create/update/skip
- campaign phases to create
- warnings for unsupported bridge/taxonomy validation

Apply mode should be idempotent:

- Re-run does not duplicate agents/projects/goals/phases.
- Existing user-edited records are not overwritten unless `--replace-template-managed` is passed.
- Template-managed fields are identified by `metadata.templateSlug` and stable slugs.

---

## 8. Implementation sequence

### Task 1: Extract reusable ReadersBase constants from the audit

**Objective:** Stop burying reusable ReadersBase operating language in a one-off script.

**Files:**

- Create: `packages/db/src/templates/readersbase-notes.ts`
- Modify: `packages/db/src/readersbase-fiction-runtime-audit.ts`
- Test: `packages/db/src/readersbase-fiction-runtime-audit.test.ts`

**Steps:**

1. Move `READERSBASE_CURRENT_FICTION_PRIORITY_NOTE`, `READERSBASE_FICTION_DEPARTMENT_NOTE`, and creative prompt assembly helpers to `readersbase-notes.ts`.
2. Import them back into the audit script.
3. Keep exported names compatible so existing tests still pass.
4. Run:

```sh
pnpm test -- packages/db/src/readersbase-fiction-runtime-audit.test.ts
```

Expected: existing three tests pass.

### Task 2: Add shared company-template types and validators

**Objective:** Define the generic template contract without database changes.

**Files:**

- Create: `packages/shared/src/types/company-template.ts`
- Create: `packages/shared/src/validators/company-template.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/validators/company-template.test.ts`

**Steps:**

1. Add minimal generic types from section 4.
2. Add zod validators with reference integrity checks using `.superRefine`.
3. Add tests for duplicate slugs, missing `reportsToSlug`, duplicate phase sequence, and a valid ReadersBase-shaped definition.
4. Run:

```sh
pnpm test -- packages/shared/src/validators/company-template.test.ts
pnpm -r --filter @paperclipai/shared typecheck
```

### Task 3: Create the ReadersBase publishing template definition

**Objective:** Encode org chart, projects, goals, phase templates, and artifact contracts as data.

**Files:**

- Create: `packages/db/src/templates/readersbase-publishing.ts`
- Create: `packages/db/src/templates/readersbase-publishing.test.ts`
- Modify: `packages/db/src/templates/index.ts` if present, otherwise create it

**Steps:**

1. Build a `READERSBASE_PUBLISHING_TEMPLATE` object using the shared contract.
2. Include the full agent org chart from section 5.
3. Include department projects and company/department goals.
4. Include six campaign phase templates and required artifacts.
5. Add metadata for bridge assumptions, but no live ReadersBase imports.
6. Test that the definition parses with `companyTemplateDefinitionSchema` and has one org root.
7. Run:

```sh
pnpm test -- packages/db/src/templates/readersbase-publishing.test.ts
```

### Task 4: Build a dry-run materialization planner

**Objective:** Produce a deterministic create/update/skip plan before writing anything.

**Files:**

- Create: `packages/db/src/templates/company-template-materializer.ts`
- Create: `packages/db/src/templates/company-template-materializer.test.ts`

**Steps:**

1. Add `planCompanyTemplateInstall(db, template, options)`.
2. Query existing company/agents/projects/goals by company ID/name and metadata slug.
3. Resolve template slugs to existing DB IDs or planned creates.
4. Return `CompanyTemplateMaterializationPlan` with warnings.
5. Test against a mocked/in-memory DB helper if available; otherwise unit-test pure planner helpers and keep DB integration for Task 5.
6. Run targeted tests.

### Task 5: Implement transactional apply

**Objective:** Install/update the template using normal Paperclip tables.

**Files:**

- Modify: `packages/db/src/templates/company-template-materializer.ts`
- Test: `packages/db/src/templates/company-template-materializer.integration.test.ts`

**Steps:**

1. Add `applyCompanyTemplateInstall(db, template, options)`.
2. Create/update company.
3. Insert root agent first, then children by topological order.
4. Insert goals and projects.
5. Preserve user-owned values unless a field is explicitly template-managed and `--replace-template-managed` is passed.
6. Wrap in one transaction.
7. Test idempotency by applying twice and asserting counts stay stable.
8. Run targeted tests.

### Task 6: Add campaign phase seed service

**Objective:** Seed a content campaign from the ReadersBase phase template.

**Files:**

- Create: `packages/db/src/templates/readersbase-campaign-seed.ts`
- Create: `packages/db/src/templates/readersbase-campaign-seed.test.ts`

**Steps:**

1. Add `seedReadersBasePublishingCampaign(db, companyId, options)`.
2. Create a campaign using existing `campaigns` table.
3. Link department projects through `campaign_projects`.
4. Create phases with plan documents using the campaign phase plan conventions already in `server/src/services/campaigns.ts`.
5. Store bridge/taxonomy selections in campaign/phase/issue metadata only where fields exist; otherwise put them in plan documents and work product metadata.
6. Optionally create the Research phase execution issue with `originKind: "template_seed"` and stable `originFingerprint`.
7. Test idempotent phase creation.

### Task 7: Add CLI entrypoint

**Objective:** Make the template usable without a UI build.

**Files:**

- Create: `packages/db/src/readersbase-publishing-template.ts`
- Modify: `package.json` or `packages/db/package.json` only if adding a named script is worth it
- Test: CLI dry-run smoke test via `tsx`

**Steps:**

1. Parse flags: `--apply`, `--company`, `--company-id`, `--seed-campaign`, `--campaign-title`, `--format`, `--replace-template-managed`.
2. Require `DATABASE_URL` or use existing migration-runtime resolver if consistent with nearby scripts.
3. Print dry-run plan by default.
4. Apply only with `--apply`.
5. Exit non-zero for invalid references or missing company in campaign-only mode.

### Task 8: Route through server/CLI later, not first

**Objective:** Avoid bloating UI/core until seed behavior is proven.

Defer these until after the DB-level seed is stable:

- `POST /api/company-templates/install`
- UI template picker
- ClipHub/package registry integration
- Company portability schema v2 extensions for campaigns/documents/work products

---

## 9. Testing plan

Minimum tests:

1. Existing audit tests still pass.
2. Shared template validator tests:
   - valid ReadersBase definition
   - duplicate slugs fail
   - invalid `reportsToSlug` fails
   - duplicate campaign phase sequence fails
3. Definition tests:
   - one root agent
   - every project has a lead/department slug
   - every phase has required artifacts
   - no live ReadersBase imports
4. Materializer tests:
   - dry-run reports creates on empty DB
   - apply creates company/org/projects/goals
   - second apply is idempotent
   - user-edited fields are preserved by default
5. Campaign seed tests:
   - creates six phases in order
   - plan documents are created
   - optional research issue is linked
   - repeated seed does not duplicate phases

Verification commands:

```sh
pnpm test -- packages/db/src/readersbase-fiction-runtime-audit.test.ts
pnpm test -- packages/shared/src/validators/company-template.test.ts packages/db/src/templates/readersbase-publishing.test.ts packages/db/src/templates/company-template-materializer.test.ts packages/db/src/templates/readersbase-campaign-seed.test.ts
pnpm -r --filter @paperclipai/shared --filter @paperclipai/db typecheck
```

Before PR-ready handoff, run the broader repo checks required by `AGENTS.md` if the implementation touches shared/server/UI contracts:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

---

## 10. Risks and mitigations

1. **Risk: Template content becomes hardcoded product clutter.**
   - Mitigation: generic contract in shared/core, ReadersBase content in `packages/db/src/templates/readersbase-*`, future move to plugin/ClipHub package.

2. **Risk: Paperclip duplicates ReadersBase taxonomy.**
   - Mitigation: store only selected keys and bridge metadata; live validation is future bridge responsibility.

3. **Risk: Re-running seed overwrites operator edits.**
   - Mitigation: idempotent planner, template-managed metadata, preserve-by-default behavior, explicit replace flag.

4. **Risk: Org chart too large for first install.**
   - Mitigation: support `profile: "pilot" | "full"` seed option; pilot installs CEO + leads + core specialists.

5. **Risk: Campaign phases are seeded without executable work.**
   - Mitigation: campaign seed optionally creates the first Research execution issue and uses phase documents as source of truth.

6. **Risk: Artifact contract cannot be enforced strongly without migrations.**
   - Mitigation: enforce in template validator and seed tests first; add DB-backed required-artifact policy only if UI/runtime enforcement needs it.

---

## 11. Immediate next steps

1. Implement Task 1 and keep the current audit tests green.
2. Implement Task 2 so all later template content is typed and validated.
3. Implement Task 3 with a pilot profile first; add the full org chart after validator/materializer tests pass.
4. Implement dry-run before apply.
5. Only after dry-run/apply is safe, add campaign seed and optional CLI script.

---

## 12. Plan verification performed for this document

This planning pass inspected the required repo docs and the active implementation surfaces listed in section 1. The smallest relevant code verification for this documentation-only change is the existing ReadersBase audit unit test, because the plan deliberately preserves that script until the template constants/materializer exist.
