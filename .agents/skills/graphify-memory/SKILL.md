---
name: graphify-memory
description: >
  Search and traverse the Paperclip agent-memory knowledge graph that connects
  every note any agent has written across issues, agent pages, decisions, and
  the run log. Use BEFORE starting work on any issue to discover prior work,
  related issues, agents who touched the same area, and surprising connections
  that span departments. Triggers on: "what do we already know about ...",
  "has anyone worked on ...", "find related issues", "trace from X to Y",
  "explain this concept", or whenever you are about to write a new entry into
  A:\Programming\paperclip\memory\obsidian\issues\REA-####.md and want to
  consult prior agent memory first. Do NOT use to index source code (the graph
  only indexes the agent-written memory vault, not the paperclip codebase).
---

# graphify-memory

The Paperclip karpathy-memory vault at `A:\Programming\paperclip\memory\obsidian`
is indexed by [graphify](https://github.com/graphifyy/graphify) into a knowledge
graph at `A:\Programming\paperclip\memory\obsidian\graphify-out\graph.json`.

The graph connects the active high-signal memory classes — issue pages, agent
role pages, decisions, comments, and project notes — across the whole company.
The lifecycle hook builds a compact corpus before extraction: it bounds large
markdown files, excludes raw daily/log noise and generated Graphify output, and
then arms a periodic background `graphify extract` refresh after successful
heartbeat runs. It uses the local ollama backend and refreshes on the configured
interval (default: 15 minutes), rather than spawning a graphify process for
every run.

## When to use

**ALWAYS query before re-discovering known facts.** Paperclip agents work
across many heartbeats and many departments; the graph is how you find what
peer agents already learned without reading every issue.

Concrete triggers:
- Picked up a new REA-#### → query for that ID + the issue title keywords
- Hit a blocker → query the blocker concept (e.g. "recovery stalled run owner")
- Considering an architectural change → traverse from the area you're touching
- Need to know who owns/owned an area → look up the agent role page neighbors
- Suspicious déjà vu → query the symptom and check recent log.md entries

## Commands

The graphify CLI is installed locally. All commands accept `--graph` pointing
at the memory vault's graph file.

### Search for related notes (BFS traversal)
```bash
graphify query "<your question>" \
  --graph A:\Programming\paperclip\memory\obsidian\graphify-out\graph.json
```
Returns the best neighborhood of nodes matching your question, with the
[[wikilinks]] of the markdown files that backed each node. Use `--budget N`
to cap tokens. Use `--dfs` to trace one specific path instead of fanning out.
For issue lookups, start with the exact identifier first, for example
`graphify query "REA-4459" ...`, then broaden with title/status/agent terms if
needed. The Paperclip hook adds deterministic `vault-issue-*` and `vault-agent-*`
anchors so exact REA ids remain findable even when semantic extraction is sparse.

### Trace shortest path between two concepts
```bash
graphify path "<concept A>" "<concept B>" \
  --graph A:\Programming\paperclip\memory\obsidian\graphify-out\graph.json
```
Useful for "is REA-892 connected to the recovery service refactor?" type
questions. Returns the chain of intermediate nodes + the edges that link them.

### Explain a single node
```bash
graphify explain "<node-id-or-label>" \
  --graph A:\Programming\paperclip\memory\obsidian\graphify-out\graph.json
```
Plain-language summary of one node and its closest neighbors. Good when you
already know a concept label and want to understand its context. Prefer
`graphify query "REA-####"` for exact issue-id lookup; current Graphify releases
resolve issue ids more reliably through `query`/`path` than through `explain`.

## Workflow on heartbeat wake

When you receive a Paperclip task in your prompt:

1. **Search prior memory first** — run `graphify query` with the issue title
   and key terms from the description. Read the cited issue/agent pages
   before forming a plan.
2. **Check related issues** — for any REA-#### IDs surfaced by the query,
   open the corresponding `A:\Programming\paperclip\memory\obsidian\issues\<id>.md`
   and read the latest dated entry.
3. **Trace decisions** — if an architectural choice is involved, query for the
   decision name or run `graphify path` between the affected components.
4. **Do the work.**
5. **Append your durable note** — write your progress to
   `A:\Programming\paperclip\memory\obsidian\issues\<your-issue>.md` using
   [[wikilinks]] to issues/agents you referenced. The lifecycle hook refreshes
   graphify on its periodic interval, so the next agent can find your note after
   the next background refresh.

## Vault layout (what's indexed)

```
A:\Programming\paperclip\memory\obsidian\
├── agents\<slug>.md          ← one per Paperclip agent (role, handling rules, evidence)
├── issues\REA-####.md        ← one per issue (dated work log, [[wikilinks]] to related issues)
├── decisions\*.md            ← cross-cutting decisions
├── comments\, projects\      ← supplementary
├── log.md                    ← auto-appended audit trail of every heartbeat run
└── graphify-out\graph.json   ← the indexed knowledge graph (do NOT edit by hand)
```

The graph only indexes the agent-written memory — it does **not** index the
paperclip source code. For source code questions use file reading or
`Grep`/`Glob`, not graphify.

## Do not

- Do not run `graphify extract` yourself — the lifecycle hook handles refreshes.
- Do not write to `graphify-out\graph.json` directly.
- Do not query graphify for source-code questions (it's not indexed there).
- Do not skip the query step on wakeup; treat it as part of the assignment.

## Configuration (advanced)

The server-side hook reads these env vars:
- `PAPERCLIP_MEMORY_VAULT` — vault root (default: `A:/Programming/paperclip/memory/obsidian`)
- `PAPERCLIP_GRAPHIFY_BIN` — graphify CLI shim (default: `graphify`)
- `PAPERCLIP_GRAPHIFY_BACKEND` — LLM backend for extraction (default: `ollama`)
- `PAPERCLIP_GRAPHIFY_MODEL` — model name (default: `qwen3.5:9b` for `ollama`)
- `PAPERCLIP_GRAPHIFY_CORPUS_MODE` — `compact` indexes a bounded generated corpus, `vault` indexes raw vault files (default: `compact`)
- `PAPERCLIP_GRAPHIFY_MAX_DOC_BYTES` — max bytes per markdown file in compact corpus before trimming/summarizing (default: `12000`)
- `PAPERCLIP_GRAPHIFY_MAX_ISSUE_FILES` — max recent issue-note files kept in the compact corpus by mtime; `0` means all active issue pages (default: `0`)
- `PAPERCLIP_GRAPHIFY_MAX_AGENT_FILES` — max recent agent role pages kept in the compact corpus by mtime; `0` means all active agent pages (default: `0`)
- `PAPERCLIP_GRAPHIFY_TOKEN_BUDGET` — Graphify semantic extraction token budget (default: `4096` for ollama, `60000` otherwise)
- `PAPERCLIP_GRAPHIFY_API_TIMEOUT_SECONDS` — per-request LLM timeout passed to Graphify (default: `900`)
- `PAPERCLIP_GRAPHIFY_INTERVAL_MS` — ms between refreshes (default: 900000 = 15 min)
- `PAPERCLIP_GRAPHIFY_LOCK_DIR` — cross-process lock directory for extraction ownership (default: `<vault>/.graphify-extract.lock`)
- `PAPERCLIP_GRAPHIFY_LOCK_STALE_MS` — age after which an abandoned extraction lock can be reclaimed (default: 21600000 = 6 hours)
- `PAPERCLIP_GRAPHIFY_DISABLE=1` — disables automatic graphify refresh

Troubleshooting:
- Keep the CLI and assistant skill aligned. The verified local target is
  `graphify 0.8.37` from the official PyPI package `graphifyy`; after upgrading,
  run `graphify install --platform codex` so the active skill version matches
  the package version.
- On Windows, multiple `graphify.exe` shims can exist on PATH. If `graphify query`
  fails from the shell but another shim works, set `PAPERCLIP_GRAPHIFY_BIN` to
  the working executable so the refresh hook and agent commands use the same CLI.
- `gemma4:12b-it-q4_K_M` is installed locally and can return simple JSON through
  `ollama run --think=false`, but a Graphify smoke extraction through the
  OpenAI-compatible Ollama path produced `0 nodes, 0 edges` with truncation
  warnings. Treat it as experimental for this hook unless Graphify gains a way
  to disable thinking for that model path.
- Compact mode intentionally keeps high-signal vault classes: active issue
  pages, agent pages, and durable note classes such as `decisions/`, `comments/`,
  and `projects/`. It excludes noisy classes like `daily/`, `deliverables/`,
  `digests/`, `queries/`, and the giant root `log.md`.
