# ReadersBase Deep Fiction Pilot: The Ashen Observatory

Date: 2026-07-07
Status: Pilot seed/runbook for one governed ReadersBase deep-fiction campaign
Related template: `READERSBASE_PUBLISHING_TEMPLATE`
Related pilot fixture: `READERSBASE_DEEP_FICTION_PILOT`

## Scope

This pilot defines exactly one deep-fiction campaign for the ReadersBase Publishing company template.

- Pilot name: The Ashen Observatory
- Format: novel
- Genre lane: sci-fi mystery / science-fantasy mystery
- Campaign template: `fiction-production`
- First executable sequence: Research -> Analysis -> Story Design
- External publishing: out of scope
- Mass book generation: out of scope
- Live ReadersBase mutation: out of scope for v1

## Premise

A disgraced orbital archivist investigates impossible star charts that predict murders inside a decaying monastery-observatory, uncovering a vanished civilization's memory engine before it rewrites the witnesses.

The reader promise is atmospheric sci-fi mystery with deep lore, fair-play clues, emotionally costly revelations, and explicit governance before any publication or catalog mutation.

## Safe seed data

The code fixture lives at `packages/db/src/templates/readersbase-deep-fiction-pilot.ts`.
It is safe to import in tests or dry-run setup because it only builds metadata and `issue_work_products` input objects.
It does not insert database rows, publish externally, or call ReadersBase.

Use the exported helpers:

- `READERSBASE_DEEP_FICTION_PILOT` for the campaign seed/runbook data.
- `buildReadersBaseDeepFictionPilotWorkProducts()` for reviewable phase artifact work-product payloads.

Every generated work product carries `noLiveReadersBaseMutation: true` through the ReadersBase artifact bridge metadata.
The publishing-phase work product is marked `needs_board_review` because its required contracts include the board approval gate.

## Phase gates

| Phase | Assigned role | Required artifact keys | Approval points | Exit gate |
|---|---|---|---|---|
| Research | `head-of-research` | `research-brief` | Research lead completeness review; Genre lead source-key review | Research and Genre leads accept the research brief before analysis starts. |
| Analysis | `head-of-genre` | `classification-bridge-manifest`; `genre-reader-promise-gate` | Production lead scope review; Genre lead promise review; Bridge validation | Production, Genre, and Format leads agree the pilot is worth designing and bridge metadata remains metadata-only. |
| Story Design | `head-of-story-architecture` | `story-bible`; `format-design-spec` | Story Architecture lead continuity signoff; Format lead novel-fit signoff; CEO story-lock review | CEO approves story lock before draft issues are created. |
| Draft | `head-of-drafting` | `draft-manuscript`; `deep-fiction-quality-gate` | Drafting lead review; Continuity QA review; CEO deep-fiction quality gate | Deep-fiction quality gate is approved before editorial starts. |
| Editorial | `head-of-editorial` | `editorial-review-report` | Editorial lead acceptance; Final acceptance reviewer readiness check | Editorial review report is approved before publishing package work starts. |
| Publishing | `head-of-publishing` | `publishing-package`; `publishing-approval-manifest` | Bridge validation; CEO review; Board approval; Final acceptance | Board approval is required before any external publication or ReadersBase catalog mutation, both of which are out of scope for this pilot. |

## Follow-up execution order

1. Create or select a ReadersBase Publishing company seeded from the reusable company template.
2. Create one campaign from the `fiction-production` campaign template with pilot slug `ashen-observatory-sci-fi-mystery-novel`.
3. Run Research first and attach `research-brief` as the required artifact.
4. Run Analysis only after the research gate passes.
5. Run Story Design only after the analysis gate passes.
6. Stop before Draft unless the CEO approves story lock.
7. Stop before Publishing unless editorial and final acceptance are complete.
8. Do not publish externally and do not mutate ReadersBase until a future live bridge plus explicit board approval exist.

## Initial agent instructions

Research agent:
Create the research brief first.
Include comparable works, reader promise evidence, taxonomy source refs, setting/domain notes, confidence labels, risks, and open questions.
Do not draft story scenes.

Analysis agent:
Use the research brief as input.
Produce classification-bridge-manifest and genre-reader-promise-gate artifacts.
Confirm this remains a single sci-fi mystery novel pilot with no live ReadersBase mutation.

Story Design agent:
Build story-bible and format-design-spec artifacts from approved analysis only.
Include fair-play mystery clue map, continuity ledger, setting rules, cast arcs, target length range, and draft readiness criteria.

## Approval boundary

Human board approval is mandatory before external publication or ReadersBase catalog mutation.
For this v1 pilot, follow-up agents should prepare reviewable artifacts only.
They should not start mass generation, upload content, or call a live ReadersBase mutation path.
