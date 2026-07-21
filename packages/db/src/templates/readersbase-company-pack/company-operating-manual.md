# ReadersBase Publishing Operating Manual

ReadersBase Publishing is a Paperclip company for governed ReadersBase-native fiction production.

Paperclip owns company control: agents, goals, campaigns, issues, documents, work products, approvals, budgets, and audit trail.

ReadersBase remains the source of truth for reader taxonomy, content-domain schema, catalog records, manuscript metadata, and final publishing behavior.

## Source truth order

Use this order when facts conflict:

1. Live ReadersBase behavior and approved ReadersBase source/schema references.
2. Paperclip company documents, issue documents, work products, artifact contracts, and approval records.
3. Current workspace repository files and tests.
4. External web sources for current market or factual evidence, cited with date and confidence.
5. Agent chat transcripts only as supporting context, never as the final artifact of record.

## Codex operating posture

ReadersBase Publishing agents run on `codex_local` by default.

Default model routing is `gpt-5.6-terra` with `modelReasoningEffort: medium` for lean, high-quality company work; quality-gate roles (publisher-in-chief and the editorial/craft leads) run `gpt-5.6-sol`, and cheap heartbeats use a `gpt-5.4-mini` profile.

Paperclip prepares an isolated Codex home per company at `companies/<company-id>/codex-home/` and seeds it from the host Codex login, so agents should not ask for credentials unless the adapter reports missing auth.

Routine ReadersBase work keeps heavy MCP servers off.
Docker MCP, GIMP MCP, browser-heavy visual workflows, and full-MCP runs are only for issues that explicitly ask for those capabilities.

Every agent should load matching Paperclip skills before work when the adapter presents them.
At minimum, use the Paperclip company skill for issue workflow, artifact handoff, comments, approvals, and workspace discipline.

## Hermes integration posture

Hermes is optional for this fork and should be installed through the Adapter manager as a plugin (`hermes_local` or gateway-backed package) when an operator explicitly wants Hermes workers.

Do not assume a built-in Hermes adapter, do not seed mandatory Hermes agents, and do not add hardcoded Hermes imports to core template code.

Use Hermes for orchestration or cross-agent routing only after the operator has configured the plugin and approved the integration path.

## ReadersBase Agent Gateway and live-write status

ReadersBase now ships a native Agent Gateway: delegated REST (`/api/agent/v1/*`) and remote MCP (`/mcp`) over one grant-scoped action layer, with its own OAuth/confidential-client token domain, durable approvals, budgets, and audit. This is the sanctioned path for external agents to eventually read and write ReadersBase, and it replaces any shared-author login.

Current develop status (re-verify before relying on it):

- Read and status actions are live: capability discovery, scoped action-status reads, and scoped approval-status reads.
- Draft-write actions (`work.create`/`work.update`, `document.create`/`document.update`, scope `content:draft-write`) are declared but availability `planned`; they return `CAPABILITY_NOT_IMPLEMENTED` (HTTP 501). No live write path exists yet.
- Publishing, deletion, and high-cost AI are approval-gated with a client-held one-time execution challenge, and an agent can never approve its own request.

ReadersBase also closed systemic access-control gaps (IDOR remediation, develop 2026-07-20): every phase, draft, story-design, research, and cross-document read plus all mutating phase-progression routes enforce strict project-access scoping, and coarse OAuth scopes (`agent:read`/`agent:write`) are satisfiable only by grants that already cover matching actions. Any automation identity must hold explicit project access; a global ID alone authorizes nothing.

## Hard boundaries

- Do not mutate ReadersBase from this company pack.
- Do not publish externally from this company pack.
- Do not start mass book generation.
- Do not create Draft work until Story Design is approved and story lock is granted.
- Do not create Publishing work until Draft and Editorial gates are complete.
- Treat every live ReadersBase mutation as not-yet-available: the Agent Gateway's write actions are still `planned` (501), so all mutation and publishing stay board-gated until writes are activated.

## Issue and watchdog discipline

Design issues so a watchdog can tell whether useful work is happening.
Keep each issue scoped to one reviewable artifact or decision gate, and write progress into comments or work products instead of hiding it in chat.

Use ask work mode when a creative premise, market positioning, rights decision, bridge mutation, external publication, or budget choice is missing.
Do not improvise irreversible business or publishing decisions.

If blocked, leave a precise question and the smallest useful evidence bundle for the next operator.

## Quality bar

Depth beats speed.

No shallow drafts, placeholder research, ungrounded market claims, or catalog-ready metadata without evidence.

Every phase must leave reviewable artifacts.

A later agent must be able to continue from Paperclip documents and work products without reading raw chat transcripts.

Every factual/domain claim must cite a source, carry a confidence label, or be marked as fictional invention.

## Department skill expectations

- Production: Paperclip issue workflow, dependency tracking, budget/watchdog escalation, and handoff hygiene.
- Research: source citation hygiene, confidence labels, ReadersBase product/source alignment, and market/current-fact checking.
- Story Architecture: story-bible discipline, continuity checks, conflict/character/setting coherence, and approval-gated story lock.
- Drafting: approved-artifact grounded drafting, scene-level craft, continuity preservation, and no placeholder prose.
- Editorial: developmental, line, copy, sensitivity, rights, and risk review with explicit acceptance notes.
- Publishing: metadata package QA, launch copy review, no external publishing without board approval, and bridge-manifest readiness.
- QA & Artifact Library: artifact completeness, traceability, review-gate state, and ReadersBase bridge validation.

## Current fiction priority

Prioritize full-length novels and series development, especially fantasy, genre-mix, and sci-fi lanes.

Standalone short-story and novella production is paused unless the board explicitly reactivates it.
