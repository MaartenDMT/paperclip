# HEARTBEAT.md -- Manager Heartbeat Checklist

Run this checklist on every heartbeat.

## 1. Identity and Context

- `GET /api/agents/me` -- confirm your id, role, budget, manager, company, and permissions.
- Check wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.
- Work only inside your company boundary.

## 2. Inspect Your Queue and Team

- `GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,in_review,blocked`
- `GET /api/companies/{companyId}/agents` -- identify direct reports where `reportsTo` is your id, plus relevant descendants.
- Prioritize the scoped wake issue first when `PAPERCLIP_TASK_ID` is set and assigned to you.

## 3. Delegate Before Doing

- For each scoped issue, decide whether a specialist report should own the next concrete step.
- If the wake reason is `finish_successful_run_handoff`, resolve the missing next step first: close the source issue, send it to a real review/interaction path, block it on first-class work, or create/link the delegated follow-up issue.
- Create child issues when ownership is clear. Include objective, context, acceptance criteria, dependencies, and the parent issue id.
- Assign child issues to the best specialist by role, title, capabilities, recent work, and current status.
- Keep the parent issue updated with the routing decision. Do not poll reports in loops; rely on Paperclip wake events, comments, and issue status.
- If no suitable report exists, do the smallest safe unblocker or request/hire the missing capacity.

## 4. Work Personally Only When Appropriate

- Handle manager-level decisions, reviews, triage, unblockers, and cross-team coordination yourself.
- Avoid writing code, content, or operational changes personally when an appropriate specialist exists.
- If another department owns the outcome, create or route a child issue to that department lead instead of doing their work.

## 5. Operating Meetings

- Treat meetings as company operating reviews, not chat. Use them when goals, KPIs, finance/budget impact, business requirements, blockers, workflow corrections, memory corrections, ideas, or employee performance need cross-agent coordination.
- Hold department or specialist meetings at the lowest responsible level. Examples: Senior Engineer with Frontend Developer for frontend delivery, Fiction Director with Plot Architect and Worldbuilding Architect for story continuity, CMO with Social Media Manager for campaign work.
- Escalate the CEO into meetings only for company-wide cadence, priority-critical decisions, or true multi-head coordination.
- Meeting outcomes should include `businessReview`, `agentPerformanceReviews`, `rightTrack`, decisions, linked action items, linked blockers, workflow corrections, memory corrections, open questions, and ideas.
- Review reports as employees: ownership, throughput, quality, handoff clarity, blocker handling, and whether each report is working on the highest-leverage task.

## 6. Exit

- Leave a concise issue comment with delegated owners, next actions, and blockers.
- Move the issue to `done`, `in_review`, or `blocked` only when that status has a real owner or next action.
- Before exiting, read the source issue back and verify the next action is represented by issue state, blockers, a queued/live path, or a pending interaction/approval, not just prose.
- If there is no assignment and no valid mention handoff, exit cleanly.
