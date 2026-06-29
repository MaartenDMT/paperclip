import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { issueGraphLivenessAutoRecoveryRequestSchema } from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { agentService, heartbeatService, issueService, logActivity } from "../services/index.js";
import { normalizeAgentPermissions } from "../services/agent-permissions.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

async function assertCanRunCompanyRecovery(req: Request, db: Db, companyId: string) {
  assertCompanyAccess(req, companyId);
  if (req.actor.type === "board") return;

  if (req.actor.type !== "agent" || !req.actor.agentId) {
    throw forbidden("Board or company CEO access required");
  }

  const agent = await agentService(db).getById(req.actor.agentId);
  if (!agent || agent.companyId !== companyId) {
    throw forbidden("Agent key cannot repair another company");
  }

  const permissions = normalizeAgentPermissions(agent.permissions, agent.role);
  if (!permissions.canRepairControlPlane) {
    throw forbidden("Only the company CEO can run control-plane recovery");
  }
}

export function companyRecoveryRoutes(db: Db) {
  const router = Router();
  const heartbeat = heartbeatService(db);
  const issues = issueService(db);

  router.get(
    "/companies/:companyId/control-plane/pull-request-work-products/backfill/preview",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      await assertCanRunCompanyRecovery(req, db, companyId);

      const preview = await issues.previewPullRequestWorkProductBackfillFromComments(companyId);
      res.json({
        companyId,
        preview,
      });
    },
  );

  router.post(
    "/companies/:companyId/control-plane/pull-request-work-products/backfill/apply",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      await assertCanRunCompanyRecovery(req, db, companyId);
      const actor = getActorInfo(req);

      const result = await issues.recoverPullRequestWorkProducts(
        companyId,
        { runId: actor.runId },
        { force: true },
      );
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "company.pull_request_work_product_recovery",
        entityType: "company",
        entityId: companyId,
        details: result,
      });

      res.json({
        companyId,
        actor: actor.actorType === "agent"
          ? { type: "agent", agentId: actor.agentId }
          : { type: "board", userId: actor.actorId },
        result,
      });
    },
  );

  router.post(
    "/companies/:companyId/control-plane/recovery/run",
    validate(issueGraphLivenessAutoRecoveryRequestSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      await assertCanRunCompanyRecovery(req, db, companyId);
      const actor = getActorInfo(req);

      const [
        persistedHeartbeatRuntimeState,
        orphanedHeartbeatRuns,
        silentActiveRuns,
        strandedAssignedIssues,
        issueGraphLiveness,
        pullRequestWorkProductRecovery,
      ] = await Promise.all([
        heartbeat.reconcilePersistedHeartbeatRuntimeState({ companyId }),
        heartbeat.reapOrphanedRuns({ staleThresholdMs: 5 * 60 * 1000 }),
        heartbeat.scanSilentActiveRuns({ companyId }),
        heartbeat.reconcileStrandedAssignedIssues({ companyId }),
        heartbeat.reconcileIssueGraphLiveness({
          companyId,
          runId: actor.runId,
          force: true,
          lookbackHours: req.body.lookbackHours,
        }),
        issues.recoverPullRequestWorkProducts(companyId, { runId: actor.runId }),
      ]);

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "company.control_plane_recovery_run",
        entityType: "company",
        entityId: companyId,
        details: {
          persistedHeartbeatRuntimeState,
          orphanedHeartbeatRuns,
          silentActiveRuns,
          strandedAssignedIssues,
          issueGraphLiveness: {
            findings: issueGraphLiveness.findings,
            escalationsCreated: issueGraphLiveness.escalationsCreated,
            existingEscalations: issueGraphLiveness.existingEscalations,
            skipped: issueGraphLiveness.skipped,
            skippedOutsideLookback: issueGraphLiveness.skippedOutsideLookback,
            obsoleteRecoveriesRetired: issueGraphLiveness.obsoleteRecoveriesRetired,
            obsoleteRecoveryBlockerRelationsRemoved:
              issueGraphLiveness.obsoleteRecoveryBlockerRelationsRemoved,
            escalationIssueIds: issueGraphLiveness.escalationIssueIds,
            retiredRecoveryIssueIds: issueGraphLiveness.retiredRecoveryIssueIds,
          },
          pullRequestWorkProductRecovery,
        },
      });

      res.json({
        companyId,
        actor: actor.actorType === "agent"
          ? { type: "agent", agentId: actor.agentId }
          : { type: "board", userId: actor.actorId },
        persistedHeartbeatRuntimeState,
        orphanedHeartbeatRuns,
        silentActiveRuns,
        strandedAssignedIssues,
        issueGraphLiveness,
        pullRequestWorkProductBackfill: pullRequestWorkProductRecovery.backfill,
        pullRequestWorkProductStatusSync: pullRequestWorkProductRecovery.githubStatusSync,
        pullRequestWorkProductRecovery,
      });
    },
  );

  return router;
}
