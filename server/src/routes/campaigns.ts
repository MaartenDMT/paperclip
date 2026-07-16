import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createCampaignPhaseSchema,
  createCampaignSchema,
  completeCampaignPhaseSchema,
  linkCampaignPhaseExecutionIssueSchema,
  replaceCampaignProjectsSchema,
  submitCampaignPhasePlanForReviewSchema,
  updateCampaignPhaseSchema,
  updateCampaignSchema,
  upsertCampaignPhasePlanSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { campaignService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function campaignRoutes(db: Db) {
  const router = Router();
  const svc = campaignService(db);

  function actorFromReq(req: Parameters<typeof getActorInfo>[0]) {
    return {
      agentId: req.actor.type === "agent" ? req.actor.agentId : null,
      userId: req.actor.type === "board" ? req.actor.userId ?? "board" : null,
      runId: req.actor.runId ?? null,
    };
  }

  router.get("/companies/:companyId/campaigns", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.list(companyId));
  });

  router.post("/companies/:companyId/campaigns", validate(createCampaignSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const campaign = await svc.create(companyId, req.body, actorFromReq(req));
    const detail = await svc.getDetail(campaign.id);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "campaign.created",
      entityType: "campaign",
      entityId: campaign.id,
      details: {
        title: campaign.title,
        projectIds: req.body.projectIds ?? [],
      },
    });
    res.status(201).json(detail ?? campaign);
  });

  router.get("/campaigns/:campaignId", async (req, res) => {
    const campaignId = req.params.campaignId as string;
    const detail = await svc.getDetail(campaignId);
    if (!detail) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    assertCompanyAccess(req, detail.companyId);
    res.json(detail);
  });

  router.patch("/campaigns/:campaignId", validate(updateCampaignSchema), async (req, res) => {
    const campaignId = req.params.campaignId as string;
    const existing = await svc.get(campaignId);
    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const updated = await svc.update(existing.companyId, campaignId, req.body, actorFromReq(req));
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "campaign.updated",
      entityType: "campaign",
      entityId: campaignId,
      details: { changedKeys: Object.keys(req.body).sort() },
    });
    res.json(updated);
  });

  router.put("/campaigns/:campaignId/projects", validate(replaceCampaignProjectsSchema), async (req, res) => {
    const campaignId = req.params.campaignId as string;
    const existing = await svc.get(campaignId);
    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const updated = await svc.replaceProjects(existing.companyId, campaignId, req.body.projectIds);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "campaign.projects_replaced",
      entityType: "campaign",
      entityId: campaignId,
      details: { projectIds: req.body.projectIds },
    });
    res.json(updated);
  });

  router.get("/campaigns/:campaignId/phases", async (req, res) => {
    const campaignId = req.params.campaignId as string;
    const existing = await svc.get(campaignId);
    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    res.json(await svc.listPhases(existing.companyId, campaignId));
  });

  router.post("/campaigns/:campaignId/phases", validate(createCampaignPhaseSchema), async (req, res) => {
    const campaignId = req.params.campaignId as string;
    const existing = await svc.get(campaignId);
    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const phase = await svc.createPhase(existing.companyId, campaignId, req.body, actorFromReq(req));
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "campaign_phase.created",
      entityType: "campaign_phase",
      entityId: phase.id,
      details: {
        campaignId,
        title: phase.title,
        sequenceNumber: phase.sequenceNumber,
      },
    });
    res.status(201).json(phase);
  });

  router.patch("/campaign-phases/:phaseId", validate(updateCampaignPhaseSchema), async (req, res) => {
    const phaseId = req.params.phaseId as string;
    const existing = await svc.getPhase(phaseId);
    if (!existing) {
      res.status(404).json({ error: "Campaign phase not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const phase = await svc.updatePhase(existing.companyId, phaseId, req.body, actorFromReq(req));
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "campaign_phase.updated",
      entityType: "campaign_phase",
      entityId: phaseId,
      details: {
        campaignId: existing.campaignId,
        changedKeys: Object.keys(req.body).sort(),
      },
    });
    res.json(phase);
  });

  router.put(
    "/campaign-phases/:phaseId/execution-issue",
    validate(linkCampaignPhaseExecutionIssueSchema),
    async (req, res) => {
      const phaseId = req.params.phaseId as string;
      const existing = await svc.getPhase(phaseId);
      if (!existing) {
        res.status(404).json({ error: "Campaign phase not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const phase = await svc.linkExecutionIssue(existing.companyId, phaseId, req.body, actorFromReq(req));
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "campaign_phase.execution_issue_linked",
        entityType: "campaign_phase",
        entityId: phaseId,
        details: {
          campaignId: existing.campaignId,
          issueId: req.body.issueId,
        },
      });
      res.json(phase);
    },
  );

  router.post(
    "/campaign-phases/:phaseId/complete",
    validate(completeCampaignPhaseSchema),
    async (req, res) => {
      const phaseId = req.params.phaseId as string;
      const existing = await svc.getPhase(phaseId);
      if (!existing) {
        res.status(404).json({ error: "Campaign phase not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const phase = await svc.completePhase(existing.companyId, phaseId, req.body, actorFromReq(req));
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "campaign_phase.completed",
        entityType: "campaign_phase",
        entityId: phaseId,
        details: {
          campaignId: existing.campaignId,
          resultDocumentId: phase.resultDocumentId,
        },
      });
      res.json(phase);
    },
  );

  router.put("/campaign-phases/:phaseId/plan", validate(upsertCampaignPhasePlanSchema), async (req, res) => {
    const phaseId = req.params.phaseId as string;
    const existing = await svc.getPhase(phaseId);
    if (!existing) {
      res.status(404).json({ error: "Campaign phase not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const document = await svc.upsertPhasePlan(existing.companyId, phaseId, req.body, actorFromReq(req));
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "campaign_phase.plan_upserted",
      entityType: "campaign_phase",
      entityId: phaseId,
      details: {
        campaignId: existing.campaignId,
        documentId: document.id,
        latestRevisionId: document.latestRevisionId,
        latestRevisionNumber: document.latestRevisionNumber,
      },
    });
    res.json(document);
  });

  router.post(
    "/campaign-phases/:phaseId/submit-plan",
    validate(submitCampaignPhasePlanForReviewSchema),
    async (req, res) => {
      const phaseId = req.params.phaseId as string;
      const existing = await svc.getPhase(phaseId);
      if (!existing) {
        res.status(404).json({ error: "Campaign phase not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const submission = await svc.submitPlanForReview(existing.companyId, phaseId, req.body, actorFromReq(req));
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "campaign_phase.plan_submitted",
        entityType: "campaign_phase",
        entityId: phaseId,
        details: {
          campaignId: existing.campaignId,
          approvalId: submission.approval.id,
          planRevisionId: submission.planRevision.id,
        },
      });
      res.status(201).json(submission);
    },
  );

  return router;
}
