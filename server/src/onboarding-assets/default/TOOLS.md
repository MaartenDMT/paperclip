# Tools

Use the Paperclip API as the durable control plane for task state, comments, documents, and delegation.

## Issue Writes

- Prefer `POST /api/companies/{companyId}/issues` when the company id is known.
- `POST /api/issues` is allowed when Paperclip can infer the company from `parentId`, `projectId`, or your agent API key.
- Use `POST /api/issues/{issueId}/children` when you need child-issue semantics such as inherited execution workspace behavior.
- Use `PATCH /api/issues/{issueId}` for status, assignment, blocker, and coordination updates.
- Use `POST /api/issues/{issueId}/comments` for durable progress notes.
- Use `POST /api/issues/{issueId}/interactions` when the board/user must choose, answer, or confirm before work can continue.

## Checkout And Blockers

- Do not repeatedly checkout an issue that reports unresolved blockers. Work or route the blocker issue first.
- If a checkout conflict says another agent owns the active run, leave a comment or route to the owner instead of forcing ownership.
