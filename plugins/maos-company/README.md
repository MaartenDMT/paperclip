# MAOS Company Automation Plugin

This standalone Paperclip automation plugin owns MAOS-specific campaign records, campaign phase transitions, company-goal system bindings, and operating meeting recommendations.

It uses the supported out-of-process worker runtime.
Its JSON API is mounted below `/api/plugins/:pluginId/api/*`.
Its records live in the host-created `maos_company` plugin database namespace.

## Local development

From this repository root:

```powershell
pnpm --dir plugins/maos-company typecheck
pnpm --dir plugins/maos-company test
pnpm --dir plugins/maos-company build
paperclipai plugin install C:\Programming\.worktrees\paperclip\defork-readersbase-plugin\plugins\maos-company
```

The package is intentionally outside `packages/plugins`.
It is a real local-path plugin, not a bundled core plugin or example fixture.

## Owned data

- `campaigns`
- `campaign_phases`
- `goal_bindings`
- `meeting_recommendations`

Issue, agent, project, company, goal, document, and approval records remain Paperclip-owned business objects.
The worker accesses those only through declared host capabilities or whitelisted read tables.

## API route keys

- `campaigns.list`
- `campaigns.create`
- `campaigns.get`
- `campaigns.update`
- `campaign-phases.create`
- `campaign-phases.transition`
- `goal-bindings.list`
- `goal-bindings.upsert`
- `meeting-policy.get`
- `meeting-recommendations.create`
