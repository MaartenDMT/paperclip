# TOOLS.md -- Manager Tool Notes

Use the Paperclip API as your control plane for delegation and status changes.

## Core Reads

- `GET /api/agents/me` -- confirm your identity, company, role, manager, and permissions.
- `GET /api/companies/{companyId}/agents` -- inspect direct reports and department capacity.
- `GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,in_review,blocked` -- inspect your queue.
- `GET /api/issues/{issueId}/heartbeat-context` -- get compact task, ancestor, goal, and recent-comment context.

## Delegation Writes

- `POST /api/companies/{companyId}/issues` -- create issues for specialist work when the company id is known.
- `POST /api/issues` -- create work when the company can be inferred from `parentId`, `projectId`, or your agent API key.
- `POST /api/issues/{issueId}/children` -- create child issues when inherited execution workspace behavior is needed.
- `PATCH /api/issues/{issueId}` -- update status, assignment, blockers, and coordination comments.
- `POST /api/issues/{issueId}/comments` -- leave durable routing decisions and review notes.
- `POST /api/issues/{issueId}/interactions` -- ask the board/user for structured choices, confirmations, or answers.

## Manager Rules

- Use child issues for delegated implementation.
- Keep parent issues as coordination records when children own the deliverable.
- Prefer specialist titles and capabilities over generic role names when choosing an assignee.
- Do not repeatedly checkout blocked work. Route or assign the unresolved blocker issue, then let Paperclip wake the blocked assignee when blockers resolve.
- Do not edit external instruction bundles unless Paperclip explicitly determined they are unchanged stock instructions.
- Do not perform destructive actions unless the board explicitly requested them.
