import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { heartbeatRuns, instanceUserRoles, invites } from "@paperclipai/db";
import type { DeploymentExposure, DeploymentMode } from "@paperclipai/shared";
import { readPersistedDevServerStatus, toDevServerHealthStatus } from "../dev-server-status.js";
import { logger } from "../middleware/logger.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { serverVersion } from "../version.js";

const DEFAULT_HEALTH_DB_TIMEOUT_MS = 5_000;

class HealthProbeTimeoutError extends Error {
  constructor(readonly probe: string) {
    super(`Health check probe timed out: ${probe}`);
    this.name = "HealthProbeTimeoutError";
  }
}

function healthDbTimeoutMs() {
  const parsed = Number.parseInt(process.env.PAPERCLIP_HEALTH_DB_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HEALTH_DB_TIMEOUT_MS;
}

function withHealthProbeTimeout<T>(probe: string, promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HealthProbeTimeoutError(probe)), healthDbTimeoutMs());
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function runDatabaseHealthProbe(db: Db, databaseProbe?: () => Promise<void>) {
  const appPoolProbe = () => db.execute(sql`SELECT 1`).then(() => undefined);
  try {
    await withHealthProbeTimeout("database_app_pool", appPoolProbe());
  } catch (error) {
    if (!databaseProbe) throw error;
    logger.warn({ err: error }, "Health check app-pool database probe failed; retrying through dedicated connection");
    await withHealthProbeTimeout("database", databaseProbe());
  }
}

function shouldExposeFullHealthDetails(
  actorType: "none" | "board" | "agent" | null | undefined,
  deploymentMode: DeploymentMode,
) {
  if (deploymentMode !== "authenticated") return true;
  return actorType === "board" || actorType === "agent";
}

function hasDevServerStatusToken(providedToken: string | undefined) {
  const expectedToken = process.env.PAPERCLIP_DEV_SERVER_STATUS_TOKEN?.trim();
  const token = providedToken?.trim();
  if (!expectedToken || !token) return false;

  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(token);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function healthRoutes(
  db?: Db,
  opts: {
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    authReady: boolean;
    companyDeletionEnabled: boolean;
    databaseProbe?: () => Promise<void>;
  } = {
    deploymentMode: "local_trusted",
    deploymentExposure: "private",
    authReady: true,
    companyDeletionEnabled: true,
  },
) {
  const router = Router();

  router.get("/", async (req, res) => {
    const actorType = "actor" in req ? req.actor?.type : null;
    const exposeFullDetails = shouldExposeFullHealthDetails(
      actorType,
      opts.deploymentMode,
    );
    const exposeDevServerDetails =
      exposeFullDetails || hasDevServerStatusToken(req.get("x-paperclip-dev-server-status-token"));

    if (!db) {
      res.json(
        exposeFullDetails
          ? { status: "ok", version: serverVersion }
          : { status: "ok", deploymentMode: opts.deploymentMode },
      );
      return;
    }

    try {
      await runDatabaseHealthProbe(db, opts.databaseProbe);
    } catch (error) {
      logger.warn({ err: error }, "Health check database probe failed");
      res.status(503).json({
        status: "unhealthy",
        version: serverVersion,
        error: error instanceof HealthProbeTimeoutError ? "database_timeout" : "database_unreachable"
      });
      return;
    }

    try {
      let bootstrapStatus: "ready" | "bootstrap_pending" = "ready";
      let bootstrapInviteActive = false;
      if (opts.deploymentMode === "authenticated") {
        const roleCount = await withHealthProbeTimeout(
          "bootstrap_roles",
          db
            .select({ count: count() })
            .from(instanceUserRoles)
            .where(sql`${instanceUserRoles.role} = 'instance_admin'`)
            .then((rows) => Number(rows[0]?.count ?? 0)),
        );
        bootstrapStatus = roleCount > 0 ? "ready" : "bootstrap_pending";

        if (bootstrapStatus === "bootstrap_pending") {
          const now = new Date();
          const inviteCount = await withHealthProbeTimeout(
            "bootstrap_invites",
            db
              .select({ count: count() })
              .from(invites)
              .where(
                and(
                  eq(invites.inviteType, "bootstrap_ceo"),
                  isNull(invites.revokedAt),
                  isNull(invites.acceptedAt),
                  gt(invites.expiresAt, now),
                ),
              )
              .then((rows) => Number(rows[0]?.count ?? 0)),
          );
          bootstrapInviteActive = inviteCount > 0;
        }
      }

      const persistedDevServerStatus = readPersistedDevServerStatus();
      let devServer: ReturnType<typeof toDevServerHealthStatus> | undefined;
      if (exposeDevServerDetails && persistedDevServerStatus && typeof (db as { select?: unknown }).select === "function") {
        const instanceSettings = instanceSettingsService(db);
        const experimentalSettings = await withHealthProbeTimeout(
          "dev_server_settings",
          instanceSettings.getExperimental(),
        );
        const activeRunCount = await withHealthProbeTimeout(
          "dev_server_active_runs",
          db
            .select({ count: count() })
            .from(heartbeatRuns)
            .where(inArray(heartbeatRuns.status, ["queued", "running"]))
            .then((rows) => Number(rows[0]?.count ?? 0)),
        );

        devServer = toDevServerHealthStatus(persistedDevServerStatus, {
          autoRestartEnabled: experimentalSettings.autoRestartDevServerWhenIdle ?? false,
          activeRunCount,
        });
      }

      if (!exposeFullDetails) {
        res.json({
          status: "ok",
          deploymentMode: opts.deploymentMode,
          bootstrapStatus,
          bootstrapInviteActive,
          ...(devServer ? { devServer } : {}),
        });
        return;
      }

      res.json({
        status: "ok",
        version: serverVersion,
        deploymentMode: opts.deploymentMode,
        deploymentExposure: opts.deploymentExposure,
        authReady: opts.authReady,
        bootstrapStatus,
        bootstrapInviteActive,
        features: {
          companyDeletionEnabled: opts.companyDeletionEnabled,
        },
        ...(devServer ? { devServer } : {}),
      });
    } catch (error) {
      logger.warn({ err: error }, "Health check detail probe failed");
      res.status(503).json({
        status: "unhealthy",
        version: serverVersion,
        error: error instanceof HealthProbeTimeoutError ? "database_timeout" : "database_unreachable"
      });
    }
  });

  return router;
}
