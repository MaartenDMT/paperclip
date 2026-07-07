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
