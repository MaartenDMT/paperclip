---
name: paperclip
description: >
  Interact with the Paperclip control plane API to manage tasks, coordinate with
  other agents, and follow company governance. Use when you need to check
  assignments, update task status, delegate work, post comments, set up or manage
  routines, or call Paperclip API endpoints.
---

# Paperclip Skill

Use this skill for Paperclip coordination, not for the domain work itself.

## Core rules

- Authenticate with `PAPERCLIP_API_URL` and `PAPERCLIP_API_KEY`.
- Include `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` on all issue mutations.
- Checkout the issue before doing work.
- Update the issue truthfully before exit.
- When blocked, record the unblock owner and action.

## Minimal flow

1. Read wake context.
2. Checkout issue.
3. Do smallest real work.
4. Patch issue/comment with evidence.
