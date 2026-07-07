# ReadersBase Publishing Company Template for Paperclip

This shared planning document intentionally preserves both artifacts that shaped the v1 implementation.

- The original product/technical spec from commit `8729e9d8` remains below as the source constraints for the publishing company boundary, operating model, and gates.
- The follow-up implementation plan from commit `944f5068` remains after it as the concrete build sequence.

---

## Preserved product/technical spec from 8729e9d8

# ReadersBase Publishing Company Template for Paperclip

Date: 2026-07-07
Status: Product/technical spec for a reusable Paperclip company template
Related systems: Paperclip (`C:\Programming\paperclip`) and ReadersBase (`C:\Programming\base`)

## 1. Purpose

This template defines how Paperclip should manage an AI publishing company for ReadersBase content production.

The boundary is deliberate:

- Paperclip is the company control plane: org structure, goals, campaigns, issues, documents, work products, approvals, budgets, and audit trail.
- ReadersBase remains the book/content domain source of truth: canonical genres, reader taxonomy, work types, manuscript metadata, catalog records, and final publishing pipeline.
- Hermes remains the outer MAOS dispatcher: it can create or route Paperclip work, but Paperclip owns the publishing company’s internal operating model once work is inside the company.

The quality bar is also deliberate: the company must not produce shallow books. Every phase must leave readable, inspectable artifacts; every handoff must be understandable by a later agent; and publishing cannot proceed without continuity, editorial, and artifact-library checks.

## 2. Paperclip entities used

The template uses existing Paperclip entities rather than introducing a parallel workflow engine:

- `companies`: one ReadersBase Publishing company, with company-scoped budgets, issue prefix, attachment limits, and approval defaults.
- `agents`: CEO and specialist employees in a strict org tree.
- `goals`: company mission, department goals, project goals, campaign goals, and phase/issue-level goals.
- `projects`: stable operating domains such as Production, Research, Story Architecture, Editorial, Publishing, QA/Artifact Library, and ReadersBase Bridge.
- `campaigns`: one book, series arc, anthology, seasonal slate, or format-conversion effort that needs board-level oversight.
- `campaign_phases`: reviewable phase plans and phase results for research, analysis, story-design, draft, editorial, and publishing.
- `issues`: the execution unit for specific tasks; each issue has one assignee, parentage, status, comments, and checkout/execution locks.
- `issue_documents`: durable phase briefs, research dossiers, continuity bibles, outlines, style sheets, editorial notes, publishing briefs, and handoff memos.
- `issue_work_products`: generated artifacts such as manuscript files, outline files, art briefs, export manifests, QA reports, ReadersBase ingest payloads, and final bundles.
- `approvals`: board/CEO/editorial gates before expensive research, story lock, draft lock, publishing, external upload, or ReadersBase catalog mutation.

## 3. Company goal and operating principles

### Company goal

Produce high-quality ReadersBase-native fiction and narrative content across supported formats while preserving domain correctness, continuity, reader value, and publishing traceability.

### Operating principles

1. Depth before speed. No draft starts until the research, audience, premise, format, and continuity questions are answered in durable documents.
2. Source taxonomy, do not copy taxonomy. Genre, subgenre, reader-facing work type, classifications, and tags are resolved from ReadersBase code/data at run time.
3. Every phase has a readable handoff. A later agent must be able to continue without asking what happened.
4. Every material decision is auditable. High-impact decisions live in issue documents and approval records, not only in chat transcripts.
5. Artifacts are first-class. Manuscripts, outlines, bibles, briefs, manifests, QA reports, and ReadersBase bridge payloads are attached as work products.
6. Publishing is gated. No content reaches ReadersBase or an external channel without QA, editorial, artifact-library, and bridge checks.

## 4. Organization chart

Paperclip V1 uses a strict reporting tree, so departments are represented by lead agents and their reports.

```text
CEO / Publisher-in-Chief
├─ Head of Production
│  ├─ Production Planner
│  └─ Schedule & Budget Controller
├─ Head of Research
│  ├─ Market & Audience Researcher
│  ├─ Setting / Domain Researcher
│  └─ Comparative Works Analyst
├─ Head of Story Architecture
│  ├─ Premise Architect
│  ├─ Plot & Structure Architect
│  ├─ Character Architect
│  └─ Continuity Keeper
├─ Head of Genre
│  ├─ Genre Taxonomy Liaison
│  ├─ Tropes & Promise Analyst
│  └─ Subgenre Fit Reviewer
├─ Head of Format
│  ├─ Novel / Novella Format Editor
│  ├─ Short / Serial Format Editor
│  ├─ Interactive Story Designer
│  ├─ Storybook Designer
│  └─ Graphic / Visual Narrative Designer
├─ Head of Drafting
│  ├─ Scene Drafter
│  ├─ Dialogue Specialist
│  ├─ Prose Stylist
│  └─ Revision Integrator
├─ Head of Editorial
│  ├─ Developmental Editor
│  ├─ Line Editor
│  ├─ Copy Editor
│  └─ Sensitivity / Risk Reviewer
├─ Head of Publishing
│  ├─ Metadata & Catalog Editor
│  ├─ Export / Packaging Specialist
│  ├─ Launch Copywriter
│  └─ Distribution Coordinator
└─ Head of QA & Artifact Library
   ├─ Continuity QA Analyst
   ├─ Artifact Librarian
   ├─ ReadersBase Bridge QA
   └─ Final Acceptance Reviewer
```

### CEO / Publisher-in-Chief

Owns the company mission, slate priorities, budget posture, campaign creation, executive review meetings, and escalation to the human board. The CEO approves phase plans when policy permits and escalates board-required approvals.

### Department leads

Each department lead owns a project in Paperclip and manages issue decomposition, staffing, phase handoffs, and quality acceptance for that discipline. Leads do not bypass approval gates; they prepare approval payloads.

### Specialist agents

Specialists execute issues within their discipline and must attach their source notes, decisions, and work products before marking work ready for review.

## 5. Supported formats

The template supports the requested production formats while keeping ReadersBase as the canonical taxonomy owner:

- Novels
- Novellas
- Short stories
- Interactive stories
- Storybooks
- Graphic / visual narratives
- Serial fiction
- Anthologies

ReadersBase currently exposes canonical reader-facing work type options in `packages/shared-types/src/reader-taxonomy.ts`, including `novel`, `novella`, `short-story`, `graphic-novel`, `storybook`, and interactive variants. Paperclip should store the selected format as campaign/issue metadata and bridge fields, but it must validate or resolve the final canonical value through ReadersBase. Serial fiction and anthologies are modeled in Paperclip as campaign patterns until ReadersBase exposes dedicated first-class public work types: serial fiction is a campaign with ordered installment issues/work products; anthology is a campaign with child story projects/issues and a collection-level publishing package.

## 6. Genre and subgenre handling

Paperclip must not duplicate the ReadersBase genre list by hand.

Bridge assumption:

- ReadersBase canonical genre/subgenre definitions live in `packages/shared-types/src/genre-taxonomy.ts` (`Genre`, `VaultGenre`, `GENRE_SUBGENRE_MAP`, labels/helpers).
- Paperclip campaign metadata may hold selected taxonomy keys and source links, but not a forked genre map.
- A future bridge adapter or import script should query ReadersBase shared types/API for valid genres, subgenres, labels, and reader-facing classifications.
- If a new genre/subgenre is needed, the change belongs in ReadersBase first; Paperclip only references the resulting canonical key.

The Genre department is responsible for genre promise, trope handling, reader expectation fit, and taxonomy-key review. It does not own the canonical taxonomy source.

## 7. Phase model

Each content campaign uses the same high-level phases. Each phase is a `campaign_phases` row with a plan document, approval link where required, result document, and execution issue.

### Phase 1: Research

Purpose: establish the reader promise, market/audience context, domain constraints, comparable works, and risk areas.

Required artifacts:

- Research plan
- Audience and reader promise brief
- Genre/subgenre source-key proposal from ReadersBase taxonomy
- Comparable works dossier
- Domain/setting research notes with citations or confidence labels
- Risk and sensitivity notes
- Open questions list

Exit gate:

- Research lead and Genre lead accept artifact completeness.
- CEO or board approves continuation when budget/risk thresholds require it.

### Phase 2: Analysis

Purpose: convert research into a production thesis and constraints.

Required artifacts:

- Content thesis: why this book/story should exist for ReadersBase readers
- Format fit analysis
- Reader persona and emotional journey
- Genre promise checklist
- Commercial/quality risk register
- Production scope: target length, installment count, art needs, interactivity needs, and estimated cost

Exit gate:

- Production, Genre, and Format leads agree the work is worth designing.
- Budget controller confirms projected spend fits company/project limits.

### Phase 3: Story-design

Purpose: lock the creative blueprint before drafting.

Required artifacts:

- Premise and logline
- World/setting bible where relevant
- Character bible
- Plot architecture or episode/installment map
- Scene list or beat sheet
- Continuity ledger
- Voice/style sheet
- Format-specific design package:
  - Interactive: choice graph, state variables, endings, replay/branching policy
  - Storybook: page spreads, read-aloud rhythm, art direction, age/reading-level assumptions
  - Graphic/visual narrative: panel plan, visual continuity, art/style guide
  - Serial: installment plan, cliffhanger/recap policy, season arc
  - Anthology: collection premise, story roster, ordering rationale, connective tissue

Exit gate:

- Story Architecture lead signs off continuity and depth.
- Format lead signs off format fit.
- Editorial lead signs off draftability.
- CEO/board approves story lock before full drafting.

### Phase 4: Draft

Purpose: generate the manuscript or narrative asset set against the locked design.

Required artifacts:

- Draft plan with assignee sequence
- Chapter/scene/installment drafts
- Change log against the story-design package
- Continuity update notes
- Known issues list
- Draft completion memo

Exit gate:

- Drafting lead confirms the draft covers the approved scope.
- Continuity Keeper confirms no unresolved hard continuity breaks.
- Editorial lead accepts the draft into editorial review.

### Phase 5: Editorial

Purpose: raise the work to publishable quality.

Required artifacts:

- Developmental edit memo
- Revision plan
- Revised manuscript
- Line edit pass notes
- Copy edit pass notes
- Sensitivity/risk review when applicable
- Final editorial checklist
- Residual known issues and accepted tradeoffs

Exit gate:

- Editorial lead signs final editorial acceptance.
- QA & Artifact Library verifies all prior artifacts remain consistent with the final manuscript.
- CEO/board approves publishing lock for externally visible release.

### Phase 6: Publishing

Purpose: package, validate, and hand off to ReadersBase and/or external channels.

Required artifacts:

- Final manuscript or asset bundle
- Metadata and catalog brief
- ReadersBase ingest/update manifest
- Cover/art requirements or attached final art artifacts
- Launch copy and reader-facing description
- QA report covering taxonomy, metadata, files, continuity, and publishing readiness
- Post-publish follow-up issue list

Exit gate:

- ReadersBase Bridge QA validates the bridge payload against ReadersBase expectations.
- Artifact Librarian confirms final artifacts are attached and named.
- CEO/board approves any catalog mutation, upload, or public distribution action.

## 8. Artifact contract

Every issue and phase must leave a readable artifact trail. Minimum contract:

- `issue_documents` hold evolving human-readable markdown documents: phase plans, briefs, bibles, checklists, decisions, and handoffs.
- `issue_work_products` hold generated outputs or links: manuscripts, JSON manifests, export bundles, art briefs, QA files, and final packages.
- Each artifact must include owner, source issue, phase, status, and downstream consumer.
- Handoff documents must start with: objective, current state, decisions made, rejected options, open questions, required next action, and artifact index.
- Work products must use stable names that include campaign, phase, artifact type, and version.
- Agents must not mark an issue done if the result only exists in a transcript.

Recommended artifact statuses:

- `draft`: useful but not yet reviewed
- `review_ready`: ready for lead/CEO/board review
- `approved`: accepted for downstream work
- `superseded`: replaced by a newer artifact
- `published`: used in final ReadersBase/public publishing

## 9. Quality gates

Quality gates are enforced by approvals, issue status transitions, and required artifact checks.

### Universal gates

- Source gate: all factual/domain claims either cite a source, carry a confidence label, or are explicitly fictional inventions.
- Taxonomy gate: selected genre/subgenre/work-type keys resolve through ReadersBase, not Paperclip-maintained duplicates.
- Continuity gate: character, setting, timeline, plot, and format-state contradictions are resolved or documented.
- Depth gate: story-design artifacts include motivations, conflicts, stakes, reversals, and reader promise; not just a shallow outline.
- Handoff gate: every phase result includes a readable follow-up memo and artifact index.
- Budget gate: projected and actual spend are reviewed at phase boundaries.
- Publishing gate: no ReadersBase mutation or external distribution without final QA and approval.

### Format-specific gates

- Novel/novella: full arc, pacing, character transformation, chapter function, and voice consistency.
- Short story: compression, turn, emotional payoff, and no unnecessary subplot sprawl.
- Interactive story: branch consistency, state validity, dead-end checks, ending coverage, and replay intent.
- Storybook: age fit, read-aloud cadence, page-turn logic, image prompt/style continuity, and safety/appropriateness.
- Graphic/visual narrative: panel readability, visual continuity, scene-to-panel mapping, and art direction completeness.
- Serial fiction: installment hooks, recap policy, long-arc continuity, and release cadence.
- Anthology: collection cohesion, story ordering, contributor/style consistency, and collection-level metadata.

## 10. Approval gates

Use Paperclip `approvals` for the following moments:

1. Campaign charter approval: accepts goal, format, audience, budget envelope, and ReadersBase target.
2. Research spend approval: required when research budget exceeds the configured threshold or external paid sources/tools are needed.
3. Story lock approval: required before full drafting starts.
4. Draft lock approval: required before editorial starts if the draft materially diverged from story-design.
5. Editorial acceptance approval: required before publishing work starts.
6. ReadersBase bridge approval: required before creating/updating catalog records, metadata, or ingest manifests.
7. Public publishing approval: required before external upload, public release, or launch copy distribution.
8. Exception approval: required when an agent proposes bypassing any required artifact, gate, or taxonomy validation.

Approval payloads should include the artifact index, decision requested, risks, budget impact, selected ReadersBase taxonomy keys, and explicit rollback/follow-up plan.

## 11. ReadersBase bridge assumptions

The bridge is a boundary, not an ownership transfer.

Assumptions:

- ReadersBase remains the canonical source for reader-facing taxonomy and content-domain schema.
- Paperclip references ReadersBase taxonomy keys and content IDs; it does not own the canonical definitions.
- Paperclip campaigns can carry bridge metadata such as `readersBaseWorkType`, `readersBaseGenreKeys`, `readersBaseSubgenreKeys`, `readersBaseTargetAudience`, `readersBaseSeriesId`, `readersBaseCollectionId`, and `readersBaseContentId`.
- A bridge adapter/importer should validate campaign metadata against ReadersBase shared types or API before publishing.
- Final ingest/update manifests are work products reviewed by ReadersBase Bridge QA before any mutation.
- If ReadersBase rejects a manifest, Paperclip creates follow-up issues under the publishing phase and does not mark the campaign complete.

Recommended bridge artifacts:

- `readersbase-taxonomy-resolution.md`: selected keys, source ReadersBase file/API, labels, rejected alternatives.
- `readersbase-ingest-manifest.json`: canonical payload for create/update.
- `readersbase-qa-report.md`: validation result, errors, warnings, manual checks.
- `readersbase-publish-handoff.md`: exact next action for the human or bridge agent.

## 12. Campaign templates

### Single-book campaign

Use for novels, novellas, storybooks, graphic novels, and interactive novels. One campaign owns all six phases and final publication.

### Short story campaign

Use a compressed scope but keep all gates. Research and analysis may be lighter, but story-design, editorial, QA, and publishing artifacts are still mandatory.

### Serial fiction campaign

One campaign represents the season/arc. Each installment is a child issue or child campaign, depending on size. The campaign-level continuity ledger is authoritative inside Paperclip, while ReadersBase owns final catalog identity.

### Anthology campaign

One campaign represents the collection. Child issues/campaigns represent individual pieces. The anthology requires a collection-level editorial and metadata pass in addition to piece-level editorial.

### Format-conversion campaign

Use when converting an existing ReadersBase work into another format, such as prose to interactive storybook or novel to graphic narrative. Requires source-work analysis, adaptation brief, delta-risk register, and ReadersBase ID references.

## 13. Minimal implementation path

1. Create the ReadersBase Publishing company with the CEO and department leads.
2. Create company-level and department-level goals.
3. Create stable projects for each department and ReadersBase Bridge.
4. Create reusable campaign phase templates for the six phases.
5. Add issue document templates for phase plans, phase results, continuity bible, editorial memo, QA report, and ReadersBase bridge handoff.
6. Add approval policies for story lock, publishing lock, ReadersBase bridge, and public publishing.
7. Build or configure a bridge validator that reads ReadersBase taxonomy/work-type definitions instead of duplicating them.
8. Pilot one short-story campaign, then one long-form campaign, before scaling to serials and anthologies.

## 14. Open questions

- Which Paperclip surface should expose reusable company templates first: seed script, CLI import, plugin, or ClipHub-style package?
- Should ReadersBase expose taxonomy through a stable API endpoint, a generated package, or direct workspace import for local MAOS use?
- Which ReadersBase object is canonical for serial fiction and anthology grouping if those remain campaign patterns in Paperclip?
- What budget thresholds require board approval for research, drafting, visual/art generation, and external publishing?
- Which final artifact formats are mandatory for each ReadersBase target channel?

## 15. Acceptance checklist for future implementation

- The company can be created with the org chart above or a smaller pilot subset.
- Every campaign has the six required phases as `campaign_phases`.
- Every phase has a plan document, execution issue, result document, and artifact index.
- Every issue has a single assignee and traces to the campaign/project/company goal chain.
- Every final work references ReadersBase taxonomy keys resolved from ReadersBase.
- Publishing requires editorial, continuity, artifact-library, ReadersBase bridge, and board/CEO approval gates.
- A later agent can resume from documents and work products without reading raw transcripts.

---

## Implementation plan additions from 944f5068

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
