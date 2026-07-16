# todo - paperclip

Canonical per-repo task file per the maart-workflow task-state convention. Workflow goals: `C:\Programming\agent-wiki\operations\goals.md`. System direction: Engineering Brain `Roadmaps/roadmap.md`.

## Active

- [x] Verify the Windows local plugin workers fix (5f28e26d) end-to-end with a real local plugin install - done 2026-07-16 - evidence: commit 5f28e26d in git log, fix: support Windows local plugin workers.
- [ ] CLIPHUB backlog: template publishing, browsing, detail page, semantic search, `cliphub:` install command, GitHub OAuth - source: `doc/CLIPHUB.md` checklist - evidence: checklist items closed.
- [ ] [dispatch] CLIPHUB: implement the `cliphub:` install command per the `doc/CLIPHUB.md` checklist - scope: install-command parsing/resolution/install path plus unit tests only; no publishing, no OAuth, no template-hub server changes - verify: repo test suite green (`pnpm test`) including new install-command tests covering valid ref, bad ref, and already-installed cases - evidence: passing test output naming the new tests.
- [ ] [dispatch] Remove the stale `node_modules.broken-1783494644/` directory from the repo root - scope: delete that one directory only, touch nothing else - verify: directory absent, then `pnpm install` and `pnpm build` (or the repo's build script) still green - evidence: clean install/build output after removal.
- [ ] Land or discard the unlanded worktree features (found 2026-07-13 audit) - owner: Maarten decision, then Codex worker - `.worktrees\paperclip-novel-quality` holds the uncommitted paperclip half of the NovelQualityHandoff feature (zod validator + artifact contract in readersbase-publishing.ts, pairs with base\.worktrees\base-novel-quality); `.worktrees\paperclip\preflight-gate` holds an uncommitted preflight gate (run-preflight.mjs, biome.jsonc, package.json scripts; drop the two model-ID test tweaks already in main). Evidence: features committed+merged, or worktrees explicitly discarded.
