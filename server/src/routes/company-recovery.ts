import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { issueGraphLivenessAutoRecoveryRequestSchema } from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { agentService, heartbeatService, logActivity } from "../services/index.js";
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

  router.post(
    "/companies/:companyId/control-plane/recovery/run",
    validate(issueGraphLivenessAutoRecoveryRequestSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      await assertCanRunCompanyRecovery(req, db, companyId);
      const actor = getActorInfo(req);

      const [silentActiveRuns, strandedAssignedIssues, issueGraphLiveness] = await Promise.all([
        heartbeat.scanSilentActiveRuns({ companyId }),
        heartbeat.reconcileStrandedAssignedIssues({ companyId }),
        heartbeat.reconcileIssueGraphLiveness({
          companyId,
          runId: actor.runId,
          force: true,
          lookbackHours: req.body.lookbackHours,
        }),
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
        },
      });

      res.json({
        companyId,
        actor: actor.actorType === "agent"
          ? { type: "agent", agentId: actor.agentId }
          : { type: "board", userId: actor.actorId },
        silentActiveRuns,
        strandedAssignedIssues,
        issueGraphLiveness,
      });
    },
  );

  return router;
}
