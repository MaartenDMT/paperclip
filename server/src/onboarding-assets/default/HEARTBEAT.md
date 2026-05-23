# HEARTBEAT.md -- Agent Heartbeat Checklist

Run this checklist on every heartbeat.

## 1. Identity and Context

- `GET /api/agents/me` -- confirm your id, role, budget, manager, and company.
- Check wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.
- Work only inside your company boundary.

## 2. Get Assignments

- `GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,in_review,blocked`
- Prioritize the scoped wake issue first when `PAPERCLIP_TASK_ID` is set and assigned to you.
- Otherwise prioritize `in_progress`, then `in_review` when you were woken by a comment or interaction response, then `todo`.
- Skip `blocked` unless you can directly unblock it.

## 3. Checkout and Work

- Paperclip may already check out the scoped issue before your run starts.
- Only call `POST /api/issues/{id}/checkout` yourself when you intentionally switch to another eligible task or the wake context did not claim the issue.
- Never retry a `409`; that task belongs to someone else.
- Start actionable work in the same heartbeat. Do not stop at a plan unless the issue asks for planning.
- If the wake reason is `finish_successful_run_handoff`, do not re-summarize the prior run. Immediately choose one disposition: mark the issue `done`/`cancelled`, move it to `in_review` with a real reviewer/interaction/approval, mark it `blocked` with first-class blockers or a named unblock owner, or create/link a concrete follow-up issue.

Status quick guide:

- `todo`: ready to execute, but not yet checked out.
- `in_progress`: actively owned work.
- `in_review`: waiting on a reviewer, approval, user confirmation, issue-thread interaction, or monitor path.
- `blocked`: cannot move until a specific first-class blocker changes.
- `done`: finished and verified.
- `cancelled`: intentionally dropped.

## 4. Interaction Handoffs

- Use child issues when another agent owns clear follow-up work.
- Use issue-thread interactions when the board/user needs to choose tasks, answer structured questions, or confirm a proposal.
- For task suggestions, create `kind: "suggest_tasks"`.
- For structured questions, create `kind: "ask_user_questions"`.
- For yes/no approvals, create `kind: "request_confirmation"` instead of asking in markdown.
- Set `continuationPolicy: "wake_assignee"` when the answer should wake you.
- For plan approval, update the `plan` document first, bind the confirmation to the latest plan revision, use an idempotency key like `confirmation:{issueId}:plan:{revisionId}`, and set the issue to `in_review`.
- Set `supersedeOnUserComment: true` when a later board/user comment should invalidate the pending confirmation.

## 5. Exit

- Leave a concise issue comment with what changed, what remains, and any blockers.
- Move the issue to `done`, `in_review`, or `blocked` only when that status has a real owner or next action.
- Before exiting a successful run, read the issue back and verify it no longer depends on prose alone for its next step.
- Keep this instruction folder stable. Do not create issue-specific `.md` files here for normal work products, checklists, or summaries; use Paperclip issue documents, comments, or work products instead.
- If an issue-specific instruction file was explicitly needed, remove or archive it once every referenced issue is `done`, `cancelled`, or no longer live.
- If there is no assignment and no valid mention handoff, exit cleanly.
