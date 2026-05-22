---
name: karpathy-obsidian-memory
description: >
  Search and update the shared Paperclip Obsidian memory vault. Use before
  starting issue work to discover prior agent notes, related issues, decisions,
  and owners. Use before finishing issue work to append concise durable facts,
  blockers, decisions, files touched, and next steps to the relevant issue page.
---

# Karpathy Obsidian Memory

Paperclip's shared agent-memory vault lives at:

```text
A:\Programming\paperclip\memory\obsidian
```

It is indexed by Graphify into:

```text
A:\Programming\paperclip\memory\obsidian\graphify-out\graph.json
```

The graph connects agent-written notes across issues, agent pages, decisions,
comments, projects, and the run log. It does not index the Paperclip source tree.

## When To Use

Use this skill on every Paperclip issue heartbeat:

- Before work: search prior memory for the issue identifier, title, affected area, and likely related components.
- During work: follow links to related issues, decisions, and agent pages when they affect the current task.
- Before handoff: append a durable note to the issue page with facts that future agents should not rediscover.

## Search Prior Memory

Prefer `graphify query` for broad recall:

```bash
graphify query "<issue id, title, component, or question>" --graph A:\Programming\paperclip\memory\obsidian\graphify-out\graph.json
```

Use `graphify path` when checking whether two concepts are connected:

```bash
graphify path "<concept A>" "<concept B>" --graph A:\Programming\paperclip\memory\obsidian\graphify-out\graph.json
```

Use `graphify explain` when you already know a node or label:

```bash
graphify explain "<node-id-or-label>" --graph A:\Programming\paperclip\memory\obsidian\graphify-out\graph.json
```

If `PAPERCLIP_GRAPHIFY_BIN` is configured, use that executable instead of the
plain `graphify` command.

## Update Issue Memory

For issue `REA-####`, open or create:

```text
A:\Programming\paperclip\memory\obsidian\issues\REA-####.md
```

Append a dated entry. Keep it concise and durable:

```markdown
## YYYY-MM-DD HH:mm Europe/Brussels

- Changed: what happened.
- Files: relevant repo paths, if any.
- Decisions: decisions made or confirmed.
- Blockers: current blocker and named unblock owner/action, if any.
- Next: concrete next step.
```

Use `[[wikilinks]]` to related issues, agents, and decisions when useful.
Prefer append-only edits; update frontmatter timestamps if the file has them.

## Boundaries

- Paperclip API state is authoritative; the vault preserves context and rationale.
- Do not store secrets, tokens, cookies, passwords, private keys, or raw confidential payloads.
- Do not edit `graphify-out/graph.json` directly.
- Do not run `graphify extract`; the lifecycle hook refreshes the graph on its configured interval.
