# MAOS Company Package Contract

Paperclip owns company structure, goals, projects, issues, agents, approvals, budgets, and execution handoffs.
Paperclip does not store the knowledge held by ReadersBase, Social Media Automations, or project vaults.

## Portable aliases

Initiative and Milestone are context aliases, not new Paperclip entities.

- An Initiative points to an existing goal with `initiative_kind: goal` and `initiative_id`.
- A Milestone points to an existing project or issue with `milestone_kind: project | issue` and `milestone_id`.

These identifiers are portable source references.
An importer must not assume that an identifier from another Paperclip instance is a local database ID.

## Company metadata

MAOS metadata lives under `metadata.maos` in `COMPANY.md`.
Unknown non-MAOS metadata remains backward compatible.

```yaml
metadata:
  maos:
    company_id: readersbase
    system_id: maos-readersbase
    initiative_id: goal-market-fit
    initiative_kind: goal
    milestone_id: project-launch
    milestone_kind: project
    source_links:
      - system: readersbase
        label: Product evidence
        url: https://readersbase.example/sources
      - system: sma
        label: Campaign execution
        url: https://sma.example/campaigns
      - system: vault
        label: Project memory
        path: ReadersBase/Projects/Launch.md
    approval_boundary: Board approval is required before spend or external publishing.
    kpis:
      - name: Qualified readers
        target: 1000
        unit: readers
    specialist_ownership:
      - research
      - growth
      - content
      - product_customer
      - ops_finance
      - security_risk
      - engineering_release
    handoff_contracts:
      - from: research
        to: content
        deliverable: Source-linked brief
        acceptance: Every claim has an external source link
```

## Specialist agents

An agent may declare one of the same role values at `.paperclip.yaml` under `agents.<slug>.metadata.maos.specialist_role`.
This is ownership metadata only.
It does not create or require a Hermes profile, adapter, credential, budget, or runtime.

## Joining external sources

Use `source_links` to join work to ReadersBase, SMA, or a vault.
Store only a label plus a URL or workspace-relative vault path.
URLs must use HTTP or HTTPS.
Local source paths must be relative and must not use absolute paths or `file:` URLs.
Do not copy articles, research notes, campaign assets, vault pages, credentials, or source bodies into company metadata.

Create Paperclip goals, projects, and issues for the work to perform.
Attach source links to the portable context and put approval limits in `approval_boundary`.
The `approval_boundary` value is descriptive portable context only.
It never grants authority, satisfies an approval, or replaces Paperclip approval records and enforcement.
Use `handoff_contracts` to state the expected deliverable and acceptance rule between specialist owners.

Imports and exports preserve this metadata.
Import into an existing company replaces metadata only when `COMPANY.md` explicitly contains `metadata`.
Legacy packages that omit `metadata` preserve the target company's existing metadata.
They do not fetch, write, or validate the external source itself.
