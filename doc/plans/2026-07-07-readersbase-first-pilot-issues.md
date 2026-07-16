# ReadersBase First Pilot Issue Specs

Date: 2026-07-07
Status: Safe seed/spec artifact for the first governed pilot issues
Related pilot: `doc/plans/2026-07-07-readersbase-deep-fiction-pilot.md`
Related code seed: `packages/db/src/templates/readersbase-first-pilot-issues.ts`

## Scope

This document defines the first three launchable Paperclip issue specs for `The Ashen Observatory`.
They are safe seed artifacts only.
They do not insert database rows, wake agents, publish externally, start mass generation, or mutate ReadersBase.

In scope:

1. Research
2. Analysis
3. Story Design

Out of scope until later approval:

- Draft
- Editorial
- Publishing
- External publication
- ReadersBase catalog mutation
- Mass book generation

## Launch order and gates

| Sequence | Phase | Issue slug | Assigned role | Required artifacts | Approval points | Gate |
|---|---|---|---|---|---|---|
| 1 | Research | `ashen-observatory-sci-fi-mystery-novel:research` | `head-of-research` | `research-brief` | Research lead completeness review; Genre lead source-key review | Research and Genre leads accept the research brief before analysis starts. |
| 2 | Analysis | `ashen-observatory-sci-fi-mystery-novel:analysis` | `head-of-genre` | `classification-bridge-manifest`; `genre-reader-promise-gate` | Production lead scope review; Genre lead promise review; Bridge validation | Production, Genre, and Format leads agree the pilot is worth designing and bridge metadata remains metadata-only. |
| 3 | Story Design | `ashen-observatory-sci-fi-mystery-novel:story-design` | `head-of-story-architecture` | `story-bible`; `format-design-spec` | Story Architecture lead continuity signoff; Format lead novel-fit signoff; CEO story-lock review | CEO approves story lock before draft issues are created. |

## Issue dependency rules

- Research has no phase dependency and is the only issue that can begin first.
- Analysis is blocked by Research approval and the accepted `research-brief`.
- Story Design is blocked by Analysis approval and accepted `classification-bridge-manifest` plus `genre-reader-promise-gate`.
- Story Design may produce draft readiness criteria, but must not create Draft work.
- Draft remains blocked until CEO story lock is explicitly approved in a separate follow-up.

## Artifact and work-product requirements

Each issue spec includes:

- a reviewable issue title and description
- phase slug, pilot slug, campaign slug, project slug, and goal slug
- assigned role slug
- required artifact keys and artifact contract details
- approval points and exit gate
- dependency context for earlier phases
- follow-up context for the next allowed phase
- execution policy flags:
  - `noExternalPublication: true`
  - `noMassBookGeneration: true`
  - `noLiveReadersBaseMutation: true`
  - `stopBeforeDraft: true`
- a ReadersBase bridge work-product seed carrying `noLiveReadersBaseMutation: true`

## Human approval boundary

A human review is required before turning these specs into live DB rows.
If live database mutation is approved later, create only these three issues first and preserve their phase dependencies.
Do not create Draft, Editorial, or Publishing issues in the same step.

## Follow-up context

Research agent:
Create the research brief first.
Include comparable works, reader promise evidence, taxonomy source refs, setting/domain notes, confidence labels, risks, and open questions.
Do not draft story scenes.

Analysis agent:
Use the approved research brief as input.
Produce classification-bridge-manifest and genre-reader-promise-gate artifacts.
Confirm this remains a single sci-fi mystery novel pilot with no live ReadersBase mutation.

Story Design agent:
Build story-bible and format-design-spec artifacts from approved analysis only.
Include fair-play mystery clue map, continuity ledger, setting rules, cast arcs, target length range, and draft readiness criteria.
Stop before Draft unless CEO story lock is explicitly approved.
