/// <reference path="./types/express.d.ts" />
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import type { Request as ExpressRequest, RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import {
  checkPostgresConnection,
  createDb,
  ensurePostgresDatabase,
  formatEmbeddedPostgresError,
  getPostgresDataDirectory,
  inspectMigrations,
  isEmbeddedPostgresStartupTransientError,
  applyPendingMigrations,
  createEmbeddedPostgresLogBuffer,
  readEmbeddedPostgresPostmasterPid,
  readEmbeddedPostgresPostmasterPort,
  reconcilePendingMigrationHistory,
  formatDatabaseBackupResult,
  runDatabaseBackup,
  startEmbeddedPostgresWithRecovery,
  waitForEmbeddedPostgresReady,
  authUsers,
  companies,
  companyMemberships,
  instanceUserRoles,
} from "@paperclipai/db";
import detectPort from "detect-port";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { logger } from "./middleware/logger.js";
import { setupLiveEventsWebSocketServer } from "./realtime/live-events-ws.js";
import {
  feedbackService,
  heartbeatService,
  instanceSettingsService,
  issueThreadInteractionService,
  memoryMaintenanceRoutineService,
  executionWorkspaceService,
  reconcilePersistedRuntimeServicesOnStartup,
  routineService,
} from "./services/index.js";
import { createFeedbackTraceShareClientFromConfig } from "./services/feedback-share-client.js";
import { buildRuntimeApiCandidateUrls, choosePrimaryRuntimeApiUrl } from "./runtime-api.js";
import { createPluginWorkerManager } from "./services/plugin-worker-manager.js";
import { createStorageServiceFromConfig } from "./storage/index.js";
import { printStartupBanner } from "./startup-banner.js";
import { getBoardClaimWarningUrl, initializeBoardClaimChallenge } from "./board-claim.js";
import { maybePersistWorktreeRuntimePorts } from "./worktree-config.js";
import { resolvePaperclipInstanceRoot } from "./home-paths.js";
import { initTelemetry, getTelemetryClient } from "./telemetry.js";
import { conflict } from "./errors.js";
import type {
  InstanceDatabaseBackupRunResult,
  InstanceDatabaseBackupTrigger,
} from "./routes/instance-database-backups.js";

const startupDebugEnabled = process.env.PAPERCLIP_DEBUG_STARTUP === "true";
const CONTROL_PLANE_SCHEDULER_LEASE_FILENAME = "control-plane-scheduler.lock";
const CONTROL_PLANE_SCHEDULER_LEASE_STALE_MS = 10 * 60 * 1000;
const STARTUP_LEASE_FILENAME = "server-startup.lock";
const STARTUP_LEASE_STALE_MS = 2 * 60 * 1000;

function startupDebug(message: string) {
  if (!startupDebugEnabled) return;
  process.stderr.write(`[paperclip][startup] ${message}\n`);
}

type BetterAuthSessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

type BetterAuthSessionResult = {
  session: { id: string; userId: string } | null;
  user: BetterAuthSessionUser | null;
};

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

type ControlPlaneSchedulerLeaseFile = {
  pid?: number;
  startedAt?: string;
  updatedAt?: string;
  requestedPort?: number;
  listenPort?: number;
};

type ControlPlaneSchedulerLease = {
  acquired: boolean;
  lockPath: string;
  release: () => Promise<void>;
};

type InstanceLease = ControlPlaneSchedulerLease;

function computeLeaseRefreshIntervalMs(staleMs: number): number {
  return Math.max(5_000, Math.min(30_000, Math.floor(staleMs / 3)));
}

function isPidAlive(pid: number | null | undefined): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseLeaseFile(raw: string): ControlPlaneSchedulerLeaseFile | null {
  try {
    const parsed = JSON.parse(raw) as ControlPlaneSchedulerLeaseFile;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

async function acquireControlPlaneSchedulerLease(input: {
  requestedPort: number;
  listenPort: number;
}): Promise<ControlPlaneSchedulerLease> {
  return acquireInstanceLease({
    filename: CONTROL_PLANE_SCHEDULER_LEASE_FILENAME,
    staleMs: CONTROL_PLANE_SCHEDULER_LEASE_STALE_MS,
    requestedPort: input.requestedPort,
    listenPort: input.listenPort,
  });
}

async function acquireInstanceLease(input: {
  filename: string;
  staleMs: number;
  requestedPort: number;
  listenPort: number;
}): Promise<InstanceLease> {
  const lockPath = resolve(resolvePaperclipInstanceRoot(), input.filename);
  const now = new Date();
  const lease: Required<ControlPlaneSchedulerLeaseFile> = {
    pid: process.pid,
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    requestedPort: input.requestedPort,
    listenPort: input.listenPort,
  };
  const writeLease = async () => {
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify(lease, null, 2)}\n`, { flag: "wx" });
  };

  try {
    await writeLease();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const existing = await readFile(lockPath, "utf8").then(parseLeaseFile, () => null);
    const existingUpdatedAt = existing?.updatedAt ? Date.parse(existing.updatedAt) : Number.NaN;
    const existingAgeMs = Number.isFinite(existingUpdatedAt)
      ? Date.now() - existingUpdatedAt
      : input.staleMs + 1;
    const existingOwnerAlive = isPidAlive(existing?.pid);
    if (existingOwnerAlive && existingAgeMs < input.staleMs) {
      return {
        acquired: false,
        lockPath,
        release: async () => {},
      };
    }
    await unlink(lockPath).catch(() => undefined);
    try {
      await writeLease();
    } catch (writeErr) {
      if ((writeErr as NodeJS.ErrnoException).code === "EEXIST") {
        return {
          acquired: false,
          lockPath,
          release: async () => {},
        };
      }
      throw writeErr;
    }
  }

  const refresh = setInterval(() => {
    const refreshed = {
      ...lease,
      updatedAt: new Date().toISOString(),
    };
    void writeFile(lockPath, `${JSON.stringify(refreshed, null, 2)}\n`).catch((err) => {
      logger.warn({ err, lockPath }, "Failed to refresh Paperclip instance lease");
    });
  }, computeLeaseRefreshIntervalMs(input.staleMs));
  refresh.unref?.();

  return {
    acquired: true,
    lockPath,
    release: async () => {
      clearInterval(refresh);
      const existing = await readFile(lockPath, "utf8").then(parseLeaseFile, () => null);
      if (existing?.pid === process.pid) {
        await unlink(lockPath).catch(() => undefined);
      }
    },
  };
}


export interface StartedServer {
  server: ReturnType<typeof createServer>;
  host: string;
  listenPort: number;
  apiUrl: string;
  databaseUrl: string;
}

function readExternalAdapterStartupWaitMs(): number {
  const raw = process.env.PAPERCLIP_EXTERNAL_ADAPTER_STARTUP_WAIT_MS?.trim();
  if (!raw) return 15_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 15_000;
  return Math.max(0, Math.floor(parsed));
}

async function waitForExternalAdaptersWithTimeout(
  waitForExternalAdapters: () => Promise<void>,
  timeoutMs: number,
): Promise<"ready" | "timed_out"> {
  if (timeoutMs <= 0) {
    await waitForExternalAdapters();
    return "ready";
  }

  return await new Promise<"ready" | "timed_out">((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve("timed_out");
    }, timeoutMs);

    void waitForExternalAdapters()
      .then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve("ready");
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function startServer(): Promise<StartedServer> {
  startupDebug("startServer: begin");
  let config = loadConfig();
  const shutdownTimers: ReturnType<typeof setInterval>[] = [];
  const registerShutdownInterval = (callback: () => void, intervalMs: number) => {
    const timer = setInterval(callback, intervalMs);
    timer.unref?.();
    shutdownTimers.push(timer);
    return timer;
  };
  const clearShutdownIntervals = () => {
    while (shutdownTimers.length > 0) {
      const timer = shutdownTimers.pop();
      if (timer) clearInterval(timer);
    }
  };
  startupDebug("startServer: config loaded");
  const startupLease = await acquireInstanceLease({
    filename: STARTUP_LEASE_FILENAME,
    staleMs: STARTUP_LEASE_STALE_MS,
    requestedPort: config.port,
    listenPort: config.port,
  });
  if (!startupLease.acquired) {
    throw new Error(
      `Another Paperclip server startup is already in progress for ${config.host}:${config.port}. ` +
        `Wait for it to finish or remove a stale lease at ${startupLease.lockPath}.`,
    );
  }
  initTelemetry({ enabled: config.telemetryEnabled });
  startupDebug("startServer: telemetry initialized");
  try {
    if (process.env.PAPERCLIP_SECRETS_PROVIDER === undefined) {
      process.env.PAPERCLIP_SECRETS_PROVIDER = config.secretsProvider;
    }
    if (process.env.PAPERCLIP_SECRETS_STRICT_MODE === undefined) {
      process.env.PAPERCLIP_SECRETS_STRICT_MODE = config.secretsStrictMode ? "true" : "false";
    }
    if (process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE === undefined) {
      process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = config.secretsMasterKeyFilePath;
    }
  
  type MigrationSummary =
    | "skipped"
    | "already applied"
    | "applied (empty database)"
    | "applied (pending migrations)";
  
  function formatPendingMigrationSummary(migrations: string[]): string {
    if (migrations.length === 0) return "none";
    return migrations.length > 3
      ? `${migrations.slice(0, 3).join(", ")} (+${migrations.length - 3} more)`
      : migrations.join(", ");
  }
  
  async function promptApplyMigrations(migrations: string[]): Promise<boolean> {
    if (process.env.PAPERCLIP_MIGRATION_AUTO_APPLY === "true") return true;
    if (process.env.PAPERCLIP_MIGRATION_PROMPT === "never") return false;
    if (!stdin.isTTY || !stdout.isTTY) return true;
  
    const prompt = createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await prompt.question(
        `Apply pending migrations (${formatPendingMigrationSummary(migrations)}) now? (y/N): `,
      )).trim().toLowerCase();
      return answer === "y" || answer === "yes";
    } finally {
      prompt.close();
    }
  }
  
  type EnsureMigrationsOptions = {
    autoApply?: boolean;
  };
  
  async function ensureMigrations(
    connectionString: string,
    label: string,
    opts?: EnsureMigrationsOptions,
  ): Promise<MigrationSummary> {
    const autoApply = opts?.autoApply === true;
    let state = await inspectMigrations(connectionString);
    if (state.status === "needsMigrations" && state.reason === "pending-migrations") {
      const repair = await reconcilePendingMigrationHistory(connectionString);
      if (repair.repairedMigrations.length > 0) {
        logger.warn(
          { repairedMigrations: repair.repairedMigrations },
          `${label} had drifted migration history; repaired migration journal entries from existing schema state.`,
        );
        state = await inspectMigrations(connectionString);
        if (state.status === "upToDate") return "already applied";
      }
    }
    if (state.status === "upToDate") return "already applied";
    if (state.status === "needsMigrations" && state.reason === "no-migration-journal-non-empty-db") {
      logger.warn(
        { tableCount: state.tableCount },
        `${label} has existing tables but no migration journal. Run migrations manually to sync schema.`,
      );
      const apply = autoApply ? true : await promptApplyMigrations(state.pendingMigrations);
      if (!apply) {
        throw new Error(
          `${label} has pending migrations (${formatPendingMigrationSummary(state.pendingMigrations)}). ` +
            "Refusing to start against a stale schema. Run pnpm db:migrate or set PAPERCLIP_MIGRATION_AUTO_APPLY=true.",
        );
      }
  
      logger.info({ pendingMigrations: state.pendingMigrations }, `Applying ${state.pendingMigrations.length} pending migrations for ${label}`);
      await applyPendingMigrations(connectionString);
      return "applied (pending migrations)";
    }
  
    const apply = autoApply ? true : await promptApplyMigrations(state.pendingMigrations);
    if (!apply) {
      throw new Error(
        `${label} has pending migrations (${formatPendingMigrationSummary(state.pendingMigrations)}). ` +
          "Refusing to start against a stale schema. Run pnpm db:migrate or set PAPERCLIP_MIGRATION_AUTO_APPLY=true.",
      );
    }
  
    logger.info({ pendingMigrations: state.pendingMigrations }, `Applying ${state.pendingMigrations.length} pending migrations for ${label}`);
    await applyPendingMigrations(connectionString);
    return "applied (pending migrations)";
  }
  
  function isLoopbackHost(host: string): boolean {
    const normalized = host.trim().toLowerCase();
    return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
  }

  function rewriteLocalUrlPort(rawUrl: string | undefined, port: number): string | undefined {
    if (!rawUrl) return undefined;
    try {
      const parsed = new URL(rawUrl);
      // The URL API normalizes default ports like :80/:443 to "", so treat them as stable URLs.
      if (!parsed.port) return rawUrl;
      parsed.port = String(port);
      return parsed.toString();
    } catch {
      return rawUrl;
    }
  }
  
  const LOCAL_BOARD_USER_ID = "local-board";
  const LOCAL_BOARD_USER_EMAIL = "local@paperclip.local";
  const LOCAL_BOARD_USER_NAME = "Board";
  
  async function ensureLocalTrustedBoardPrincipal(db: any): Promise<void> {
    const now = new Date();
    const existingUser = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.id, LOCAL_BOARD_USER_ID))
      .then((rows: Array<{ id: string }>) => rows[0] ?? null);
  
    if (!existingUser) {
      await db.insert(authUsers).values({
        id: LOCAL_BOARD_USER_ID,
        name: LOCAL_BOARD_USER_NAME,
        email: LOCAL_BOARD_USER_EMAIL,
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  
    const role = await db
      .select({ id: instanceUserRoles.id })
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, LOCAL_BOARD_USER_ID), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows: Array<{ id: string }>) => rows[0] ?? null);
    if (!role) {
      await db.insert(instanceUserRoles).values({
        userId: LOCAL_BOARD_USER_ID,
        role: "instance_admin",
      });
    }
  
    const companyRows = await db.select({ id: companies.id }).from(companies);
    for (const company of companyRows) {
      const membership = await db
        .select({ id: companyMemberships.id })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, company.id),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, LOCAL_BOARD_USER_ID),
          ),
        )
        .then((rows: Array<{ id: string }>) => rows[0] ?? null);
      if (membership) continue;
      await db.insert(companyMemberships).values({
        companyId: company.id,
        principalType: "user",
        principalId: LOCAL_BOARD_USER_ID,
        status: "active",
        membershipRole: "owner",
      });
    }
  }
  
  let db;
  let pluginMigrationDb;
  let embeddedPostgres: EmbeddedPostgresInstance | null = null;
  let embeddedPostgresStartedByThisProcess = false;
  let migrationSummary: MigrationSummary = "skipped";
  let activeDatabaseConnectionString: string;
  let resolvedEmbeddedPostgresPort: number | null = null;
  let startupDbInfo:
    | { mode: "external-postgres"; connectionString: string }
    | { mode: "embedded-postgres"; dataDir: string; port: number };
  if (config.databaseUrl) {
    startupDebug("startServer: using external postgres");
    const migrationUrl = config.databaseMigrationUrl ?? config.databaseUrl;
    migrationSummary = await ensureMigrations(migrationUrl, "PostgreSQL");
  
    db = createDb(config.databaseUrl, {
      max: Math.max(1, Math.floor(Number(process.env.PAPERCLIP_DB_POOL_MAX ?? 20))),
    });
    pluginMigrationDb = config.databaseMigrationUrl ? createDb(config.databaseMigrationUrl) : db;
    logger.info("Using external PostgreSQL via DATABASE_URL/config");
    activeDatabaseConnectionString = config.databaseUrl;
    startupDbInfo = { mode: "external-postgres", connectionString: config.databaseUrl };
  } else {
    startupDebug("startServer: using embedded postgres");
    const moduleName = "embedded-postgres";
    let EmbeddedPostgres: EmbeddedPostgresCtor;
    try {
      const mod = await import(moduleName);
      EmbeddedPostgres = mod.default as EmbeddedPostgresCtor;
    } catch {
      throw new Error(
        "Embedded PostgreSQL mode requires dependency `embedded-postgres`. Reinstall dependencies (without omitting required packages), or set DATABASE_URL for external Postgres.",
      );
    }
  
    const dataDir = resolve(config.embeddedPostgresDataDir);
    const configuredPort = config.embeddedPostgresPort;
    let port = configuredPort;
    const logBuffer = createEmbeddedPostgresLogBuffer(120);
    const verboseEmbeddedPostgresLogs = process.env.PAPERCLIP_EMBEDDED_POSTGRES_VERBOSE === "true";
    const appendEmbeddedPostgresLog = (message: unknown) => {
      logBuffer.append(message);
      if (!verboseEmbeddedPostgresLogs) {
        return;
      }
      const lines = typeof message === "string"
        ? message.split(/\r?\n/)
        : message instanceof Error
          ? [message.message]
          : [String(message ?? "")];
      for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line) continue;
        logger.info({ embeddedPostgresLog: line }, "embedded-postgres");
      }
    };
    const logEmbeddedPostgresFailure = (phase: "initialise" | "start", err: unknown) => {
      const recentLogs = logBuffer.getRecentLogs();
      if (recentLogs.length > 0) {
        logger.error(
          {
            phase,
            recentLogs,
            err,
          },
          "Embedded PostgreSQL failed; showing buffered startup logs",
        );
      }
    };
  
    if (config.databaseMode === "postgres") {
      logger.warn("Database mode is postgres but no connection string was set; falling back to embedded PostgreSQL");
    }
  
    const clusterVersionFile = resolve(dataDir, "PG_VERSION");
    const clusterAlreadyInitialized = existsSync(clusterVersionFile);
    const postmasterPidFile = resolve(dataDir, "postmaster.pid");
    const runningPid = readEmbeddedPostgresPostmasterPid(postmasterPidFile);
    const runningPort = readEmbeddedPostgresPostmasterPort(postmasterPidFile);
    let shouldStartManagedEmbeddedPostgres = false;
    if (runningPid) {
      const candidatePort = runningPort ?? port;
      const adminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${candidatePort}/postgres`;
      const candidateConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${candidatePort}/paperclip`;
      try {
        const ready = await waitForEmbeddedPostgresReady({
          adminConnectionString,
          databaseName: "paperclip",
          targetConnectionString: candidateConnectionString,
        });
        if (!ready) {
          logger.warn(
            `Embedded PostgreSQL pid ${runningPid} exists but port ${candidatePort} did not become ready within the grace window; attempting managed restart instead.`,
          );
          shouldStartManagedEmbeddedPostgres = true;
        } else {
          port = candidatePort;
          logger.warn(`Embedded PostgreSQL already running; reusing existing process (pid=${runningPid}, port=${port})`);
        }
      } catch (err) {
        if (!isEmbeddedPostgresStartupTransientError(err)) {
          throw err;
        }
        logger.warn(
          `Embedded PostgreSQL pid ${runningPid} exists but port ${candidatePort} is not accepting connections; attempting managed restart instead.`,
        );
        shouldStartManagedEmbeddedPostgres = true;
      }
    } else {
      const configuredAdminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${configuredPort}/postgres`;
      try {
        const actualDataDir = await getPostgresDataDirectory(configuredAdminConnectionString);
        if (
          typeof actualDataDir !== "string" ||
          resolve(actualDataDir) !== resolve(dataDir)
        ) {
          throw new Error("reachable postgres does not use the expected embedded data directory");
        }
        await ensurePostgresDatabase(configuredAdminConnectionString, "paperclip");
        logger.warn(
          `Embedded PostgreSQL appears to already be reachable without a pid file; reusing existing server on configured port ${configuredPort}`,
        );
      } catch {
        shouldStartManagedEmbeddedPostgres = true;
      }
    }

    if (shouldStartManagedEmbeddedPostgres) {
      const detectedPort = await detectPort(configuredPort);
      if (detectedPort !== configuredPort && clusterAlreadyInitialized) {
        logger.warn(
          `Embedded PostgreSQL configured port ${configuredPort} is occupied while existing cluster data is present; retrying managed recovery on the configured port instead of starting a second instance on ${detectedPort}.`,
        );
      } else if (detectedPort !== configuredPort) {
        logger.warn(`Embedded PostgreSQL port is in use; using next free port (requestedPort=${configuredPort}, selectedPort=${detectedPort})`);
      }
      port = detectedPort !== configuredPort && clusterAlreadyInitialized ? configuredPort : detectedPort;
      logger.info(`Using embedded PostgreSQL because no DATABASE_URL set (dataDir=${dataDir}, port=${port})`);
      embeddedPostgres = new EmbeddedPostgres({
        databaseDir: dataDir,
        user: "paperclip",
        password: "paperclip",
        port,
        persistent: true,
        initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
        onLog: appendEmbeddedPostgresLog,
        onError: appendEmbeddedPostgresLog,
      });

      if (!clusterAlreadyInitialized) {
        try {
          await embeddedPostgres.initialise();
        } catch (err) {
          logEmbeddedPostgresFailure("initialise", err);
          throw formatEmbeddedPostgresError(err, {
            fallbackMessage: `Failed to initialize embedded PostgreSQL cluster in ${dataDir} on port ${port}`,
            recentLogs: logBuffer.getRecentLogs(),
          });
        }
      } else {
        logger.info(`Embedded PostgreSQL cluster already exists (${clusterVersionFile}); skipping init`);
      }

      try {
        await startEmbeddedPostgresWithRecovery({
          instance: embeddedPostgres,
          postmasterPidFile,
          getRecentLogs: () => logBuffer.getRecentLogs(),
          verifyStarted: () => waitForEmbeddedPostgresReady({
            adminConnectionString: `postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`,
            databaseName: "paperclip",
            targetConnectionString: `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`,
          }),
          onRecovered: (message) => logger.warn(message),
        });
      } catch (err) {
        logEmbeddedPostgresFailure("start", err);
        throw formatEmbeddedPostgresError(err, {
          fallbackMessage: `Failed to start embedded PostgreSQL on port ${port}`,
          recentLogs: logBuffer.getRecentLogs(),
        });
      }
      embeddedPostgresStartedByThisProcess = true;
    }
  
    const embeddedAdminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`;
    const dbStatus = await ensurePostgresDatabase(embeddedAdminConnectionString, "paperclip");
    if (dbStatus === "created") {
      logger.info("Created embedded PostgreSQL database: paperclip");
    }
  
    const embeddedConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
    const shouldAutoApplyFirstRunMigrations = !clusterAlreadyInitialized || dbStatus === "created";
    if (shouldAutoApplyFirstRunMigrations) {
      logger.info("Detected first-run embedded PostgreSQL setup; applying pending migrations automatically");
    }
    migrationSummary = await ensureMigrations(embeddedConnectionString, "Embedded PostgreSQL", {
      autoApply: shouldAutoApplyFirstRunMigrations,
    });
  
    db = createDb(embeddedConnectionString, {
      max: Math.max(1, Math.floor(Number(process.env.PAPERCLIP_EMBEDDED_POSTGRES_POOL_MAX ?? 3))),
    });
    pluginMigrationDb = db;
    logger.info("Embedded PostgreSQL ready");
    startupDebug("startServer: embedded postgres ready");
    activeDatabaseConnectionString = embeddedConnectionString;
    resolvedEmbeddedPostgresPort = port;
    startupDbInfo = { mode: "embedded-postgres", dataDir, port };
  }
  
  if (config.deploymentMode === "local_trusted" && !isLoopbackHost(config.host)) {
    throw new Error(
      `local_trusted mode requires loopback host binding (received: ${config.host}). ` +
        "Use authenticated mode for non-loopback deployments.",
    );
  }
  
  if (config.deploymentMode === "local_trusted" && config.deploymentExposure !== "private") {
    throw new Error("local_trusted mode only supports private exposure");
  }
  
  if (config.deploymentMode === "authenticated") {
    if (config.authBaseUrlMode === "explicit" && !config.authPublicBaseUrl) {
      throw new Error("auth.baseUrlMode=explicit requires auth.publicBaseUrl");
    }
    if (config.deploymentExposure === "public") {
      if (config.authBaseUrlMode !== "explicit") {
        throw new Error("authenticated public exposure requires auth.baseUrlMode=explicit");
      }
      if (!config.authPublicBaseUrl) {
        throw new Error("authenticated public exposure requires auth.publicBaseUrl");
      }
    }
  }

  const requestedListenPort = config.port;
  const listenPort = await detectPort(requestedListenPort);
  const isPrimaryPortProcess = listenPort === requestedListenPort;
  const controlPlaneSchedulerLease =
    isPrimaryPortProcess && (config.heartbeatSchedulerEnabled || config.databaseBackupEnabled)
      ? await acquireControlPlaneSchedulerLease({ requestedPort: requestedListenPort, listenPort })
      : null;
  const isPrimaryControlPlaneProcess = isPrimaryPortProcess && (controlPlaneSchedulerLease?.acquired ?? true);
  if ((config.heartbeatSchedulerEnabled || config.databaseBackupEnabled) && controlPlaneSchedulerLease && !controlPlaneSchedulerLease.acquired) {
    logger.warn(
      { requestedPort: requestedListenPort, listenPort, lockPath: controlPlaneSchedulerLease.lockPath },
      "Control-plane scheduler disabled because another Paperclip server owns the scheduler lease",
    );
  }
  startupDebug(`startServer: listen port resolved to ${listenPort}`);
  if (config.authBaseUrlMode === "explicit" && config.authPublicBaseUrl) {
    config.authPublicBaseUrl = rewriteLocalUrlPort(config.authPublicBaseUrl, listenPort);
  }
  
  let authReady = config.deploymentMode === "local_trusted";
  let betterAuthHandler: RequestHandler | undefined;
  let resolveSession:
    | ((req: ExpressRequest) => Promise<BetterAuthSessionResult | null>)
    | undefined;
  let resolveSessionFromHeaders:
    | ((headers: Headers) => Promise<BetterAuthSessionResult | null>)
    | undefined;
  if (config.deploymentMode === "local_trusted") {
    startupDebug("startServer: ensuring local trusted board principal");
    await ensureLocalTrustedBoardPrincipal(db as any);
    startupDebug("startServer: local trusted board principal ready");
  }
  if (config.deploymentMode === "authenticated") {
    startupDebug("startServer: initializing authenticated mode");
    const {
      createBetterAuthHandler,
      createBetterAuthInstance,
      deriveAuthTrustedOrigins,
      resolveBetterAuthSession,
      resolveBetterAuthSessionFromHeaders,
    } = await import("./auth/better-auth.js");
    const derivedTrustedOrigins = deriveAuthTrustedOrigins(config, { listenPort });
    const envTrustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const effectiveTrustedOrigins = Array.from(new Set([...derivedTrustedOrigins, ...envTrustedOrigins]));
    logger.info(
      {
        authBaseUrlMode: config.authBaseUrlMode,
        authPublicBaseUrl: config.authPublicBaseUrl ?? null,
        trustedOrigins: effectiveTrustedOrigins,
        trustedOriginsSource: {
          derived: derivedTrustedOrigins.length,
          env: envTrustedOrigins.length,
        },
      },
      "Authenticated mode auth origin configuration",
    );
    const auth = createBetterAuthInstance(db as any, config, effectiveTrustedOrigins);
    betterAuthHandler = createBetterAuthHandler(auth);
    resolveSession = (req) => resolveBetterAuthSession(auth, req);
    resolveSessionFromHeaders = (headers) => resolveBetterAuthSessionFromHeaders(auth, headers);
    await initializeBoardClaimChallenge(db as any, { deploymentMode: config.deploymentMode });
    authReady = true;
    startupDebug("startServer: authenticated mode ready");
  }

  if (resolvedEmbeddedPostgresPort !== null && resolvedEmbeddedPostgresPort !== config.embeddedPostgresPort) {
    config.embeddedPostgresPort = resolvedEmbeddedPostgresPort;
  }
  maybePersistWorktreeRuntimePorts({
    serverPort: listenPort,
    databasePort: resolvedEmbeddedPostgresPort,
  });
  const uiMode = config.uiDevMiddleware ? "vite-dev" : config.serveUi ? "static" : "none";
  const storageService = createStorageServiceFromConfig(config);
  startupDebug("startServer: storage service created");
  const feedback = feedbackService(db as any, {
    shareClient: createFeedbackTraceShareClientFromConfig(config),
  });
  startupDebug("startServer: feedback service created");
  const backupSettingsSvc = instanceSettingsService(db);
  let databaseBackupInFlight = false;
  const runServerDatabaseBackup = async (
    trigger: InstanceDatabaseBackupTrigger,
  ): Promise<InstanceDatabaseBackupRunResult | null> => {
    if (databaseBackupInFlight) {
      const message = "Database backup already in progress";
      if (trigger === "scheduled") {
        logger.warn("Skipping scheduled database backup because a previous backup is still running");
        return null;
      }
      throw conflict(message);
    }

    databaseBackupInFlight = true;
    const startedAt = new Date();
    const startedAtMs = Date.now();
    const label = trigger === "scheduled" ? "Automatic" : "Manual";
    try {
      logger.info({ backupDir: config.databaseBackupDir, trigger }, `${label} database backup starting`);
      // Read retention from Instance Settings (DB) so changes take effect without restart.
      const generalSettings = await backupSettingsSvc.getGeneral();
      const retention = generalSettings.backupRetention;

      const result = await runDatabaseBackup({
        connectionString: activeDatabaseConnectionString,
        backupDir: config.databaseBackupDir,
        retention,
        filenamePrefix: "paperclip",
      });
      const finishedAt = new Date();
      const response: InstanceDatabaseBackupRunResult = {
        ...result,
        trigger,
        backupDir: config.databaseBackupDir,
        retention,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: Date.now() - startedAtMs,
      };
      logger.info(
        {
          backupFile: result.backupFile,
          sizeBytes: result.sizeBytes,
          prunedCount: result.prunedCount,
          backupDir: config.databaseBackupDir,
          retention,
          trigger,
          durationMs: response.durationMs,
        },
        `${label} database backup complete: ${formatDatabaseBackupResult(result)}`,
      );
      return response;
    } catch (err) {
      logger.error({ err, backupDir: config.databaseBackupDir, trigger }, `${label} database backup failed`);
      throw err;
    } finally {
      databaseBackupInFlight = false;
    }
  };
  const pluginWorkerManager = createPluginWorkerManager();
  const shutdownController = new AbortController();
  startupDebug("startServer: plugin worker manager created");
  logger.info({ uiMode }, "Creating Paperclip app");
  startupDebug("startServer: creating app");
  const app = await createApp(db as any, {
    uiMode,
    serverPort: listenPort,
    storageService,
    databaseProbe: async () => {
      await checkPostgresConnection(activeDatabaseConnectionString);
    },
    feedbackExportService: feedback,
    databaseBackupService: {
      runManualBackup: async () => {
        if (!isPrimaryControlPlaneProcess) {
          throw conflict("Database backups can only run from the primary Paperclip server process");
        }
        const result = await runServerDatabaseBackup("manual");
        if (!result) {
          throw conflict("Database backup already in progress");
        }
        return result;
      },
    },
    deploymentMode: config.deploymentMode,
    deploymentExposure: config.deploymentExposure,
    allowedHostnames: config.allowedHostnames,
    bindHost: config.host,
    authReady,
    companyDeletionEnabled: config.companyDeletionEnabled,
    pluginMigrationDb: pluginMigrationDb as any,
    betterAuthHandler,
    resolveSession,
    pluginWorkerManager,
    shutdownSignal: shutdownController.signal,
  });
  logger.info("Paperclip app created");
  startupDebug("startServer: app created");
  const server = createServer(app as unknown as Parameters<typeof createServer>[0]);
  startupDebug("startServer: http server created");
  server.on("error", (err) => {
    logger.error({ err }, "Paperclip HTTP server emitted an unexpected runtime error");
  });

  // Increase keep-alive timeouts to safely outlive default idle timeouts
  // of common reverse proxies and load balancers (like AWS ALB, Nginx, or Traefik).
  // This prevents intermittent 502/ECONNRESET errors caused by Node's 5s default.
  server.keepAliveTimeout = 185000;
  server.headersTimeout = 186000;
  
  if (listenPort !== requestedListenPort) {
    logger.warn(`Requested port is busy; using next free port (requestedPort=${requestedListenPort}, selectedPort=${listenPort})`);
  }
  
  const runtimeListenHost = config.host;
  const runtimeApiUrl = choosePrimaryRuntimeApiUrl({
    authPublicBaseUrl: config.authPublicBaseUrl ?? null,
    allowedHostnames: config.allowedHostnames,
    bindHost: runtimeListenHost,
    port: listenPort,
  });
  const configuredApiUrl = process.env.PAPERCLIP_API_URL?.trim() || runtimeApiUrl;
  const runtimeApiCandidates = buildRuntimeApiCandidateUrls({
    preferredApiUrl: configuredApiUrl,
    authPublicBaseUrl: config.authPublicBaseUrl ?? null,
    allowedHostnames: config.allowedHostnames,
    bindHost: runtimeListenHost,
    port: listenPort,
  });
  process.env.PAPERCLIP_LISTEN_HOST = runtimeListenHost;
  process.env.PAPERCLIP_LISTEN_PORT = String(listenPort);
  process.env.PAPERCLIP_RUNTIME_API_URL = runtimeApiUrl;
  process.env.PAPERCLIP_RUNTIME_API_CANDIDATES_JSON = JSON.stringify(runtimeApiCandidates);
  process.env.PAPERCLIP_API_URL = configuredApiUrl;
  
  setupLiveEventsWebSocketServer(server, db as any, {
    deploymentMode: config.deploymentMode,
    resolveSessionFromHeaders,
  });
  startupDebug("startServer: websocket server configured");

  void reconcilePersistedRuntimeServicesOnStartup(db as any)
    .then((result) => {
      if (result.reconciled > 0) {
        logger.warn(
          { reconciled: result.reconciled },
          "reconciled persisted runtime services from a previous server process",
        );
      }
    })
    .catch((err) => {
      logger.error({ err }, "startup reconciliation of persisted runtime services failed");
    });
  
  if (config.heartbeatSchedulerEnabled && isPrimaryControlPlaneProcess) {
    const heartbeat = heartbeatService(db as any, { pluginWorkerManager });
    const routines = routineService(db as any, { pluginWorkerManager });
    const issueThreadInteractions = issueThreadInteractionService(db as any);
    const memoryMaintenance = memoryMaintenanceRoutineService(db as any);
    const executionWorkspaces = executionWorkspaceService(db as any);
    type ProductivityReviewReconcileResult = Awaited<ReturnType<typeof heartbeat.reconcileProductivityReviews>>;
    let productivityReviewReconcileInFlight: Promise<ProductivityReviewReconcileResult> | null = null;
    let periodicHeartbeatRecoveryInFlight = false;
    let lastMemoryMaintenanceRoutineReconcileAt = 0;
    const reconcileMeetings = async (source: "startup" | "periodic") => {
      const companyIds = await instanceSettingsService(db).listCompanyIds();
      let created = 0;
      for (const companyId of companyIds) {
        const result = await issueThreadInteractions.reconcileMeetingWorkflow(companyId);
        created += result.created;
        for (const meeting of result.meetings) {
          const agentIdsToWake = [
            ...meeting.participantAgentIds,
            ...(meeting.participantAgentIds.length === 0 && meeting.chairAgentId ? [meeting.chairAgentId] : []),
          ].filter((agentId, index, list): agentId is string => Boolean(agentId) && list.indexOf(agentId) === index);
          for (const agentId of agentIdsToWake) {
            try {
              await heartbeat.wakeup(agentId, {
                source: "automation",
                triggerDetail: "system",
                reason: "agent_meeting_requested",
                payload: {
                  issueId: meeting.issueId,
                  meetingId: meeting.id,
                  interactionId: meeting.id,
                  mutation: "meeting_workflow",
                  chairAgentId: meeting.chairAgentId,
                },
                requestedByActorType: "system",
                requestedByActorId: "meeting_workflow",
                contextSnapshot: {
                  issueId: meeting.issueId,
                  taskId: meeting.issueId,
                  meetingId: meeting.id,
                  interactionId: meeting.id,
                  interactionKind: "agent_meeting",
                  wakeReason: "agent_meeting_requested",
                  source: `meeting_workflow.${source}`,
                },
              });
            } catch (err) {
              logger.warn(
                { err, companyId, meetingId: meeting.id, issueId: meeting.issueId, agentId },
                "meeting workflow failed to wake participant",
              );
            }
          }
        }
      }
      return { companies: companyIds.length, created };
    };
    const reconcileMemoryMaintenanceRoutines = async (source: "startup" | "periodic") => {
      const now = Date.now();
      if (source === "periodic" && now - lastMemoryMaintenanceRoutineReconcileAt < 15 * 60 * 1000) {
        return { companies: 0, created: 0, updated: 0, unchanged: 0, skipped: true };
      }
      lastMemoryMaintenanceRoutineReconcileAt = now;
      const companyIds = await instanceSettingsService(db).listCompanyIds();
      const result = await memoryMaintenance.ensureForCompanies(companyIds);
      return { ...result, skipped: false };
    };
    const reconcileStaleSharedExecutionWorkspaces = async () => {
      return executionWorkspaces.reconcileStaleSharedWorkspaces();
    };
    const reconcileProductivityReviews = async (): Promise<ProductivityReviewReconcileResult & { coalesced?: boolean }> => {
      if (productivityReviewReconcileInFlight) {
        return {
          scanned: 0,
          created: 0,
          updated: 0,
          existing: 0,
          snoozed: 0,
          creationCapped: 0,
          skipped: 0,
          failed: 0,
          reassigned: 0,
          reviewIssueIds: [],
          failedIssueIds: [],
          reassignedReviewIssueIds: [],
          coalesced: true,
        };
      }

      const task = heartbeat.reconcileProductivityReviews();
      productivityReviewReconcileInFlight = task;
      try {
        return await task;
      } finally {
        if (productivityReviewReconcileInFlight === task) {
          productivityReviewReconcileInFlight = null;
        }
      }
    };
  
    // Reap orphaned running runs at startup while in-memory execution state is empty,
    // then resume any persisted queued runs that were waiting on the previous process.
    void heartbeat
      .reconcilePersistedHeartbeatRuntimeState()
      .then(async () => {
        const refreshed = await heartbeat.refreshStockInstructionsForManagerAgents();
        if (refreshed.updated > 0 || refreshed.failed.length > 0) {
          logger.warn({ ...refreshed }, "startup manager instruction bundle sweep completed");
        }
      })
      .then(() => heartbeat.reapOrphanedRuns())
      .then(() => heartbeat.promoteDueScheduledRetries())
      .then(async (promotion) => {
        await heartbeat.resumeQueuedRuns();
        const reconciled = await heartbeat.reconcileStrandedAssignedIssues();
        if (
          promotion.promoted > 0 ||
          reconciled.assignmentDispatched > 0 ||
          reconciled.dispatchRequeued > 0 ||
          reconciled.continuationRequeued > 0 ||
          reconciled.successfulRunHandoffEscalated > 0 ||
          reconciled.escalated > 0
        ) {
          logger.warn(
            { promotedScheduledRetries: promotion.promoted, promotedScheduledRetryRunIds: promotion.runIds, ...reconciled },
            "startup heartbeat recovery changed assigned issue state",
          );
        }
      })
      .then(async () => {
        const reconciled = await heartbeat.reconcileIssueGraphLiveness();
        if (reconciled.escalationsCreated > 0) {
          logger.warn({ ...reconciled }, "startup issue-graph liveness reconciliation created escalations");
        }
      })
      .then(async () => {
        const scanned = await heartbeat.scanSilentActiveRuns();
        if (scanned.created > 0 || scanned.escalated > 0) {
          logger.warn({ ...scanned }, "startup active-run output watchdog created review work");
        }
      })
      .then(async () => {
        const reviewed = await reconcileProductivityReviews();
        if (reviewed.created > 0 || reviewed.updated > 0 || reviewed.failed > 0) {
          logger.warn({ ...reviewed }, "startup productivity reconciliation created or updated review work");
        }
      })
      .then(async () => {
        const meetings = await reconcileMeetings("startup");
        if (meetings.created > 0) {
          logger.warn({ ...meetings }, "startup meeting workflow reconciliation created meetings");
        }
      })
      .then(async () => {
        const memoryRoutines = await reconcileMemoryMaintenanceRoutines("startup");
        if (memoryRoutines.created > 0 || memoryRoutines.updated > 0) {
          logger.warn({ ...memoryRoutines }, "startup memory maintenance routine reconciliation changed routines");
        }
      })
      .then(async () => {
        const staleWorkspaces = await reconcileStaleSharedExecutionWorkspaces();
        if (staleWorkspaces.archived > 0 || staleWorkspaces.detachedIssues > 0) {
          logger.warn({ ...staleWorkspaces }, "startup stale shared execution workspace reconciliation archived workspaces");
        }
      })
      .catch((err) => {
        logger.error({ err }, "startup heartbeat recovery failed");
      });
    registerShutdownInterval(() => {
      void heartbeat
        .tickTimers(new Date())
        .then((result) => {
          if (result.enqueued > 0) {
            logger.info({ ...result }, "heartbeat timer tick enqueued runs");
          }
        })
        .catch((err) => {
          logger.error({ err }, "heartbeat timer tick failed");
        });

      void routines
        .tickScheduledTriggers(new Date())
        .then((result) => {
          if (result.triggered > 0) {
            logger.info({ ...result }, "routine scheduler tick enqueued runs");
          }
        })
        .catch((err) => {
          logger.error({ err }, "routine scheduler tick failed");
        });

      void reconcileMeetings("periodic")
        .then((result) => {
          if (result.created > 0) {
            logger.info({ ...result }, "meeting workflow tick created meetings");
          }
        })
        .catch((err) => {
          logger.error({ err }, "meeting workflow tick failed");
        });

      void reconcileMemoryMaintenanceRoutines("periodic")
        .then((result) => {
          if (!result.skipped && (result.created > 0 || result.updated > 0)) {
            logger.info({ ...result }, "memory maintenance routine tick changed routines");
          }
        })
        .catch((err) => {
          logger.error({ err }, "memory maintenance routine tick failed");
        });

      void reconcileStaleSharedExecutionWorkspaces()
        .then((result) => {
          if (result.archived > 0 || result.detachedIssues > 0) {
            logger.info({ ...result }, "stale shared execution workspace tick archived workspaces");
          }
        })
        .catch((err) => {
          logger.error({ err }, "stale shared execution workspace tick failed");
        });
  
      // Periodically reap orphaned runs (5-min staleness threshold) and make sure
      // persisted queued work is still being driven forward.
      //
      // Guard against overlapping passes: this chain runs ~8 reconciliation
      // queries and on a busy instance can take longer than the scheduler
      // interval. Without this guard, ticks pile up and contend on the DB
      // connection pool, which itself triggers Postgres timeouts and a recovery
      // feedback loop. Skip a tick whenever the previous pass is still running.
      if (periodicHeartbeatRecoveryInFlight) {
        logger.warn("periodic heartbeat recovery still running; skipping this tick");
      } else {
        periodicHeartbeatRecoveryInFlight = true;
        void heartbeat
          .reconcilePersistedHeartbeatRuntimeState()
          .then(() => heartbeat.reapOrphanedRuns({ staleThresholdMs: 5 * 60 * 1000 }))
          .then(() => heartbeat.promoteDueScheduledRetries())
          .then(async (promotion) => {
            await heartbeat.resumeQueuedRuns();
            const reconciled = await heartbeat.reconcileStrandedAssignedIssues();
            if (
              promotion.promoted > 0 ||
              reconciled.assignmentDispatched > 0 ||
              reconciled.dispatchRequeued > 0 ||
              reconciled.continuationRequeued > 0 ||
              reconciled.successfulRunHandoffEscalated > 0 ||
              reconciled.escalated > 0
            ) {
              logger.warn(
                { promotedScheduledRetries: promotion.promoted, promotedScheduledRetryRunIds: promotion.runIds, ...reconciled },
                "periodic heartbeat recovery changed assigned issue state",
              );
            }
          })
          .then(async () => {
            const reconciled = await heartbeat.reconcileIssueGraphLiveness();
            if (reconciled.escalationsCreated > 0) {
              logger.warn({ ...reconciled }, "periodic issue-graph liveness reconciliation created escalations");
            }
          })
          .then(async () => {
            const scanned = await heartbeat.scanSilentActiveRuns();
            if (scanned.created > 0 || scanned.escalated > 0) {
              logger.warn({ ...scanned }, "periodic active-run output watchdog created review work");
            }
          })
          .then(async () => {
            const reviewed = await reconcileProductivityReviews();
            if (reviewed.created > 0 || reviewed.updated > 0 || reviewed.failed > 0) {
              logger.warn({ ...reviewed }, "periodic productivity reconciliation created or updated review work");
            }
          })
          .catch((err) => {
            logger.error({ err }, "periodic heartbeat recovery failed");
          })
          .finally(() => {
            periodicHeartbeatRecoveryInFlight = false;
          });
      }
    }, config.heartbeatSchedulerIntervalMs);
  } else if (config.heartbeatSchedulerEnabled) {
    logger.warn(
      { requestedPort: requestedListenPort, listenPort },
      "Heartbeat scheduler disabled because this server is not the primary Paperclip control-plane process",
    );
  }
  
  if (config.databaseBackupEnabled && isPrimaryControlPlaneProcess) {
    const backupIntervalMs = config.databaseBackupIntervalMinutes * 60 * 1000;

    logger.info(
      {
        intervalMinutes: config.databaseBackupIntervalMinutes,
        retentionSource: "instance-settings-db",
        backupDir: config.databaseBackupDir,
      },
      "Automatic database backups enabled",
    );
    registerShutdownInterval(() => {
      void runServerDatabaseBackup("scheduled").catch(() => {
        // runServerDatabaseBackup already logs the failure with context.
      });
    }, backupIntervalMs);
  } else if (config.databaseBackupEnabled) {
    logger.warn(
      { requestedPort: requestedListenPort, listenPort, backupDir: config.databaseBackupDir },
      "Automatic database backups disabled because this server is not the primary Paperclip control-plane process",
    );
  }
  
  // Wait for external adapters to finish loading before accepting requests.
  // Without this, adapter type validation (assertKnownAdapterType) would
  // reject valid external adapter types during the startup loading window.
  const { waitForExternalAdapters } = await import("./adapters/registry.js");
  startupDebug("startServer: waiting for external adapters");
  const externalAdapterStartupWaitMs = readExternalAdapterStartupWaitMs();
  const externalAdapterStartupState = await waitForExternalAdaptersWithTimeout(
    waitForExternalAdapters,
    externalAdapterStartupWaitMs,
  );
  if (externalAdapterStartupState === "timed_out") {
    logger.warn(
      { timeoutMs: externalAdapterStartupWaitMs },
      "External adapter loading exceeded startup wait budget; continuing startup while adapters finish in background",
    );
    void waitForExternalAdapters()
      .then(() => {
        logger.info("External adapters finished loading after startup timeout");
      })
      .catch((err) => {
        logger.error({ err }, "External adapter loading failed after startup timeout");
      });
  } else {
    startupDebug("startServer: external adapters ready");
  }

  startupDebug("startServer: calling server.listen");
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (err: Error) => {
      server.off("error", onError);
      rejectListen(err);
    };

    server.once("error", onError);
    server.listen(listenPort, config.host, () => {
      server.off("error", onError);
      logger.info(`Server listening on ${config.host}:${listenPort}`);
      if (process.env.PAPERCLIP_OPEN_ON_LISTEN === "true") {
        const openHost = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
        const url = `http://${openHost}:${listenPort}`;
        void import("open")
          .then((mod) => mod.default(url))
          .then(() => {
            logger.info(`Opened browser at ${url}`);
          })
          .catch((err) => {
            logger.warn({ err, url }, "Failed to open browser on startup");
          });
      }
        printStartupBanner({
          bind: config.bind,
          host: config.host,
          deploymentMode: config.deploymentMode,
        deploymentExposure: config.deploymentExposure,
        authReady,
        requestedPort: requestedListenPort,
        listenPort,
        uiMode,
        db: startupDbInfo,
        migrationSummary,
        heartbeatSchedulerEnabled: config.heartbeatSchedulerEnabled,
        heartbeatSchedulerIntervalMs: config.heartbeatSchedulerIntervalMs,
        databaseBackupEnabled: config.databaseBackupEnabled,
        databaseBackupIntervalMinutes: config.databaseBackupIntervalMinutes,
        databaseBackupRetentionDays: config.databaseBackupRetentionDays,
        databaseBackupDir: config.databaseBackupDir,
      });

      const boardClaimUrl = getBoardClaimWarningUrl(config.host, listenPort);
      if (boardClaimUrl) {
        const red = "\x1b[41m\x1b[30m";
        const yellow = "\x1b[33m";
        const reset = "\x1b[0m";
        console.log(
          [
            `${red}  BOARD CLAIM REQUIRED  ${reset}`,
            `${yellow}This instance was previously local_trusted and still has local-board as the only admin.${reset}`,
            `${yellow}Sign in with a real user and open this one-time URL to claim ownership:${reset}`,
            `${yellow}${boardClaimUrl}${reset}`,
            `${yellow}If you are connecting over Tailscale, replace the host in this URL with your Tailscale IP/MagicDNS name.${reset}`,
          ].join("\n"),
        );
      }

      resolveListen();
    });
  });
  
  {
    const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
      clearShutdownIntervals();
      shutdownController.abort();

      const telemetryClient = getTelemetryClient();
      if (telemetryClient) {
        telemetryClient.stop();
        await telemetryClient.flush();
      }

      await controlPlaneSchedulerLease?.release();

      if (embeddedPostgres && embeddedPostgresStartedByThisProcess) {
        logger.info({ signal }, "Stopping embedded PostgreSQL");
        try {
          await embeddedPostgres?.stop();
        } catch (err) {
          logger.error({ err }, "Failed to stop embedded PostgreSQL cleanly");
        }
      }

      process.exit(0);
    };

    process.once("SIGINT", () => {
      void shutdown("SIGINT");
    });
    process.once("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
  }

    await startupLease.release();

    return {
      server,
      host: config.host,
      listenPort,
      apiUrl: configuredApiUrl,
      databaseUrl: activeDatabaseConnectionString,
    };
  } catch (error) {
    clearShutdownIntervals();
    await startupLease.release();
    throw error;
  }
}

function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(resolve(entry)).href === metaUrl;
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url)) {
  void startServer().catch((err) => {
    logger.error({ err }, "Paperclip server failed to start");
    process.exit(1);
  });
}
