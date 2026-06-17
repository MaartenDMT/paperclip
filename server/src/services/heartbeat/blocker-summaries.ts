// Unresolved-blocker summary lookup extracted from heartbeat.ts.
//
// Given an issue and a set of candidate blocker issue ids, returns compact
// summaries of the still-open blocking issues (those linked by a `blocks`
// relation). Reads from the passed-in Db/transaction; holds no heartbeat state.

import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issueRelations, issues } from "@paperclipai/db";

export async function listUnresolvedBlockerSummaries(
  dbOrTx: Pick<Db, "select">,
  companyId: string,
  issueId: string,
  unresolvedBlockerIssueIds: string[],
) {
  const ids = [...new Set(unresolvedBlockerIssueIds.filter(Boolean))];
  if (ids.length === 0) return [];
  return dbOrTx
    .select({
      id: issues.id,
      identifier: issues.identifier,
      title: issues.title,
      status: issues.status,
      priority: issues.priority,
      assigneeAgentId: issues.assigneeAgentId,
      assigneeUserId: issues.assigneeUserId,
    })
    .from(issueRelations)
    .innerJoin(issues, eq(issueRelations.issueId, issues.id))
    .where(
      and(
        eq(issueRelations.companyId, companyId),
        eq(issueRelations.type, "blocks"),
        eq(issueRelations.relatedIssueId, issueId),
        inArray(issues.id, ids),
      ),
    )
    .orderBy(asc(issues.title));
}
