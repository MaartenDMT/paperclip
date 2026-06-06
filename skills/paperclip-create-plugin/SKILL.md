---
name: paperclip-create-plugin
description: >
  Create new Paperclip plugins with the current alpha SDK/runtime. Use when
  scaffolding a plugin package, adding a new example plugin, or updating plugin
  authoring docs.
---

# Create a Paperclip Plugin

Use this skill when the task is to create, scaffold, or document a Paperclip plugin.

## Preferred workflow

```bash
pnpm --filter @paperclipai/create-paperclip-plugin build
node packages/plugins/create-paperclip-plugin/dist/index.js <npm-package-name> --output <target-dir>
```
