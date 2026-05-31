import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ORIGINAL_PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL;
const ORIGINAL_PAPERCLIP_RUNTIME_API_URL = process.env.PAPERCLIP_RUNTIME_API_URL;
const ORIGINAL_PAPERCLIP_RUNTIME_API_CANDIDATES_JSON = process.env.PAPERCLIP_RUNTIME_API_CANDIDATES_JSON;
const ORIGINAL_PAPERCLIP_LISTEN_HOST = process.env.PAPERCLIP_LISTEN_HOST;
const ORIGINAL_PAPERCLIP_LISTEN_PORT = process.env.PAPERCLIP_LISTEN_PORT;
const ORIGINAL_PAPERCLIP_HOME = process.env.PAPERCLIP_HOME;

const {
  createAppMock,
  createBetterAuthInstanceMock,
  createDbMock,
  detectPortMock,
  deriveAuthTrustedOriginsMock,
  feedbackExportServiceMock,
  feedbackServiceFactoryMock,
  fakeServer,
  heartbeatServiceInstanceMock,
  loadConfigMock,
} = vi.hoisted(() => {
  const createAppMock = vi.fn(async () => ((_: unknown, __: unknown) => {}) as never);
  const createBetterAuthInstanceMock = vi.fn(() => ({}));
  const createDbMock = vi.fn(() => ({}) as never);
  const detectPortMock = vi.fn(async (port: number) => port);
  const deriveAuthTrustedOriginsMock = vi.fn(() => []);
  const feedbackExportServiceMock = {
    flushPendingFeedbackTraces: vi.fn(async () => ({ attempted: 0, sent: 0, failed: 0 })),
  };
  const feedbackServiceFactoryMock = vi.fn(() => feedbackExportServiceMock);
  const heartbeatServiceInstanceMock = {
    reapOrphanedRuns: vi.fn(async () => undefined),
    promoteDueScheduledRetries: vi.fn(async () => ({ promoted: 0, runIds: [] })),
    resumeQueuedRuns: vi.fn(async () => undefined),
    reconcileStrandedAssignedIssues: vi.fn(async () => ({
      assignmentDispatched: 0,
      dispatchRequeued: 0,
      continuationRequeued: 0,
      successfulRunHandoffEscalated: 0,
      escalated: 0,
      skipped: 0,
      issueIds: [],
    })),
    tickTimers: vi.fn(async () => ({ enqueued: 0 })),
    reconcilePersistedHeartbeatRuntimeState: vi.fn(async () => undefined),
    refreshStockInstructionsForManagerAgents: vi.fn(async () => ({ updated: 0, failed: [] })),
    reconcileIssueGraphLiveness: vi.fn(async () => ({ escalationsCreated: 0 })),
    scanSilentActiveRuns: vi.fn(async () => ({ created: 0, escalated: 0 })),
    reconcileProductivityReviews: vi.fn(async () => ({ created: 0, updated: 0, failed: 0 })),
    wakeup: vi.fn(async () => undefined),
  };
  const fakeServer = {
    on: vi.fn().mockReturnThis(),
    once: vi.fn().mockReturnThis(),
    off: vi.fn().mockReturnThis(),
    listen: vi.fn((_port: number, _host: string, callback?: () => void) => {
      callback?.();
      return fakeServer;
    }),
    close: vi.fn(),
  };
  const loadConfigMock = vi.fn();

  return {
    createAppMock,
    createBetterAuthInstanceMock,
    createDbMock,
    detectPortMock,
    deriveAuthTrustedOriginsMock,
    feedbackExportServiceMock,
    feedbackServiceFactoryMock,
    fakeServer,
    heartbeatServiceInstanceMock,
    loadConfigMock,
  };
});

function buildTestConfig(overrides: Record<string, unknown> = {}) {
  return {
    deploymentMode: "authenticated",
    deploymentExposure: "private",
    bind: "loopback",
    customBindHost: undefined,
    host: "127.0.0.1",
    port: 3210,
    allowedHostnames: [],
    authBaseUrlMode: "auto",
    authPublicBaseUrl: undefined,
    authDisableSignUp: false,
    databaseMode: "postgres",
    databaseUrl: "postgres://paperclip:paperclip@127.0.0.1:5432/paperclip",
    embeddedPostgresDataDir: "/tmp/paperclip-test-db",
    embeddedPostgresPort: 54329,
    databaseBackupEnabled: false,
    databaseBackupIntervalMinutes: 60,
    databaseBackupRetentionDays: 30,
    databaseBackupDir: "/tmp/paperclip-test-backups",
    serveUi: false,
    uiDevMiddleware: false,
    secretsProvider: "local_encrypted",
    secretsStrictMode: false,
    secretsMasterKeyFilePath: "/tmp/paperclip-master.key",
    storageProvider: "local_disk",
    storageLocalDiskBaseDir: "/tmp/paperclip-storage",
    storageS3Bucket: "paperclip-test",
    storageS3Region: "us-east-1",
    storageS3Endpoint: undefined,
    storageS3Prefix: "",
    storageS3ForcePathStyle: false,
    feedbackExportBackendUrl: "https://telemetry.example.com",
    feedbackExportBackendToken: "telemetry-token",
    heartbeatSchedulerEnabled: false,
    heartbeatSchedulerIntervalMs: 30000,
    companyDeletionEnabled: false,
    ...overrides,
  };
}

vi.mock("node:http", () => ({
  createServer: vi.fn(() => fakeServer),
}));

vi.mock("detect-port", () => ({
  default: detectPortMock,
}));

vi.mock("@paperclipai/db", () => ({
  createDb: createDbMock,
  ensurePostgresDatabase: vi.fn(),
  getPostgresDataDirectory: vi.fn(),
  inspectMigrations: vi.fn(async () => ({ status: "upToDate" })),
  applyPendingMigrations: vi.fn(),
  reconcilePendingMigrationHistory: vi.fn(async () => ({ repairedMigrations: [] })),
  formatDatabaseBackupResult: vi.fn(() => "ok"),
  runDatabaseBackup: vi.fn(),
  startEmbeddedPostgresWithRecovery: vi.fn(),
  waitForEmbeddedPostgresReady: vi.fn(async () => true),
  readEmbeddedPostgresPostmasterPid: vi.fn(() => null),
  readEmbeddedPostgresPostmasterPort: vi.fn(() => null),
  createEmbeddedPostgresLogBuffer: vi.fn(() => ({
    append: vi.fn(),
    getRecentLogs: vi.fn(() => []),
  })),
  authUsers: {},
  companies: {},
  companyMemberships: {},
  instanceUserRoles: {},
}));

vi.mock("../app.js", () => ({
  createApp: createAppMock,
}));

vi.mock("../config.js", () => ({
  loadConfig: loadConfigMock,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: vi.fn(function child() {
      return this;
    }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../realtime/live-events-ws.js", () => ({
  setupLiveEventsWebSocketServer: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  feedbackService: feedbackServiceFactoryMock,
  heartbeatService: vi.fn(() => heartbeatServiceInstanceMock),
  instanceSettingsService: vi.fn(() => ({
    getGeneral: vi.fn(async () => ({
      backupRetention: {
        dailyDays: 7,
        weeklyWeeks: 4,
        monthlyMonths: 1,
      },
    })),
    listCompanyIds: vi.fn(async () => []),
  })),
  memoryMaintenanceRoutineService: vi.fn(() => ({
    ensureForCompanies: vi.fn(async () => ({ companies: 0, created: 0, updated: 0, unchanged: 0 })),
  })),
  executionWorkspaceService: vi.fn(() => ({
    reconcileStaleSharedWorkspaces: vi.fn(async () => ({ archived: 0, detachedIssues: 0 })),
  })),
  issueThreadInteractionService: vi.fn(() => ({
    reconcileMeetingWorkflow: vi.fn(async () => ({ created: 0, meetings: [] })),
  })),
  reconcilePersistedRuntimeServicesOnStartup: vi.fn(async () => ({ reconciled: 0 })),
  routineService: vi.fn(() => ({
    tickScheduledTriggers: vi.fn(async () => ({ triggered: 0 })),
  })),
}));

vi.mock("../storage/index.js", () => ({
  createStorageServiceFromConfig: vi.fn(() => ({ id: "storage-service" })),
}));

vi.mock("../services/feedback-share-client.js", () => ({
  createFeedbackTraceShareClientFromConfig: vi.fn(() => ({ id: "feedback-share-client" })),
}));

vi.mock("../startup-banner.js", () => ({
  printStartupBanner: vi.fn(),
}));

vi.mock("../board-claim.js", () => ({
  getBoardClaimWarningUrl: vi.fn(() => null),
  initializeBoardClaimChallenge: vi.fn(async () => undefined),
}));

vi.mock("../auth/better-auth.js", () => ({
  createBetterAuthHandler: vi.fn(() => undefined),
  createBetterAuthInstance: createBetterAuthInstanceMock,
  deriveAuthTrustedOrigins: deriveAuthTrustedOriginsMock,
  resolveBetterAuthSession: vi.fn(async () => null),
  resolveBetterAuthSessionFromHeaders: vi.fn(async () => null),
}));

const waitForExternalAdaptersMock = vi.fn(async () => undefined);

vi.mock("../adapters/registry.js", () => ({
  waitForExternalAdapters: waitForExternalAdaptersMock,
}));

import { startServer } from "../index.ts";
import { logger } from "../middleware/logger.js";
import { heartbeatService } from "../services/index.js";

const INITIAL_SIGINT_LISTENERS = new Set(process.rawListeners("SIGINT"));
const INITIAL_SIGTERM_LISTENERS = new Set(process.rawListeners("SIGTERM"));

beforeEach(async () => {
  process.env.PAPERCLIP_HOME = await mkdtemp(path.join(os.tmpdir(), "paperclip-startup-test-"));
});

afterEach(() => {
  for (const listener of process.rawListeners("SIGINT")) {
    if (!INITIAL_SIGINT_LISTENERS.has(listener)) {
      process.removeListener("SIGINT", listener);
    }
  }
  for (const listener of process.rawListeners("SIGTERM")) {
    if (!INITIAL_SIGTERM_LISTENERS.has(listener)) {
      process.removeListener("SIGTERM", listener);
    }
  }
});

describe("startServer feedback export wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockReturnValue(buildTestConfig());
    createBetterAuthInstanceMock.mockReturnValue({});
    deriveAuthTrustedOriginsMock.mockReturnValue([]);
    waitForExternalAdaptersMock.mockResolvedValue(undefined);
    process.env.BETTER_AUTH_SECRET = "test-secret";
    delete process.env.PAPERCLIP_EXTERNAL_ADAPTER_STARTUP_WAIT_MS;
  });

  it("passes the feedback export service into createApp so pending traces flush in runtime", async () => {
    const started = await startServer();

    expect(started.server).toBe(fakeServer);
    expect(feedbackServiceFactoryMock).toHaveBeenCalledTimes(1);
    expect(createAppMock).toHaveBeenCalledTimes(1);
    expect(createAppMock.mock.calls[0]?.[1]).toMatchObject({
      feedbackExportService: feedbackExportServiceMock,
      storageService: { id: "storage-service" },
      serverPort: 3210,
    });
  });
});

describe("startServer external adapter gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockReturnValue(buildTestConfig());
    createBetterAuthInstanceMock.mockReturnValue({});
    deriveAuthTrustedOriginsMock.mockReturnValue([]);
    waitForExternalAdaptersMock.mockResolvedValue(undefined);
    process.env.BETTER_AUTH_SECRET = "test-secret";
    delete process.env.PAPERCLIP_EXTERNAL_ADAPTER_STARTUP_WAIT_MS;
  });

  it("continues startup when external adapters exceed the startup wait budget", async () => {
    waitForExternalAdaptersMock.mockImplementation(() => new Promise<void>(() => {}));
    process.env.PAPERCLIP_EXTERNAL_ADAPTER_STARTUP_WAIT_MS = "1";

    const started = await startServer();

    expect(started.server).toBe(fakeServer);
    expect(fakeServer.listen).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 1 }),
      expect.stringContaining("External adapter loading exceeded startup wait budget"),
    );
  });

  it("attaches a permanent runtime error handler to the HTTP server", async () => {
    await startServer();

    const runtimeErrorHandler = fakeServer.on.mock.calls.find((call) => call[0] === "error")?.[1] as
      | ((err: Error) => void)
      | undefined;

    expect(typeof runtimeErrorHandler).toBe("function");

    runtimeErrorHandler?.(new Error("socket meltdown"));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: "socket meltdown" }),
      }),
      "Paperclip HTTP server emitted an unexpected runtime error",
    );
  });
});

describe("startServer authenticated auth origin setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockReturnValue(buildTestConfig());
    createBetterAuthInstanceMock.mockReturnValue({});
    deriveAuthTrustedOriginsMock.mockReturnValue([]);
    process.env.BETTER_AUTH_SECRET = "test-secret";
  });

  it("derives trusted origins from the detected listen port before auth initializes", async () => {
    loadConfigMock.mockReturnValue(buildTestConfig({
      port: 3210,
      allowedHostnames: ["board.example.test"],
      authBaseUrlMode: "explicit",
      authPublicBaseUrl: "http://127.0.0.1:3210",
    }));
    detectPortMock.mockResolvedValueOnce(3211);
    deriveAuthTrustedOriginsMock.mockImplementation(
      (_config: { port: number; authPublicBaseUrl?: string }, opts?: { listenPort?: number }) => [
        `http://board.example.test:${opts?.listenPort ?? 0}`,
      ],
    );

    await startServer();

    expect(deriveAuthTrustedOriginsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 3210,
        authPublicBaseUrl: "http://127.0.0.1:3211/",
      }),
      { listenPort: 3211 },
    );
    expect(createBetterAuthInstanceMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        port: 3210,
        authPublicBaseUrl: "http://127.0.0.1:3211/",
      }),
      ["http://board.example.test:3211"],
    );
    expect(createAppMock.mock.calls[0]?.[1]).toMatchObject({
      serverPort: 3211,
    });
  });
});

describe("startServer PAPERCLIP_API_URL handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockReturnValue(buildTestConfig());
    process.env.BETTER_AUTH_SECRET = "test-secret";
    delete process.env.PAPERCLIP_API_URL;
  });

  afterEach(() => {
    if (ORIGINAL_PAPERCLIP_API_URL === undefined) delete process.env.PAPERCLIP_API_URL;
    else process.env.PAPERCLIP_API_URL = ORIGINAL_PAPERCLIP_API_URL;

    if (ORIGINAL_PAPERCLIP_RUNTIME_API_URL === undefined) delete process.env.PAPERCLIP_RUNTIME_API_URL;
    else process.env.PAPERCLIP_RUNTIME_API_URL = ORIGINAL_PAPERCLIP_RUNTIME_API_URL;

    if (ORIGINAL_PAPERCLIP_RUNTIME_API_CANDIDATES_JSON === undefined) {
      delete process.env.PAPERCLIP_RUNTIME_API_CANDIDATES_JSON;
    } else {
      process.env.PAPERCLIP_RUNTIME_API_CANDIDATES_JSON = ORIGINAL_PAPERCLIP_RUNTIME_API_CANDIDATES_JSON;
    }

    if (ORIGINAL_PAPERCLIP_LISTEN_HOST === undefined) delete process.env.PAPERCLIP_LISTEN_HOST;
    else process.env.PAPERCLIP_LISTEN_HOST = ORIGINAL_PAPERCLIP_LISTEN_HOST;

    if (ORIGINAL_PAPERCLIP_LISTEN_PORT === undefined) delete process.env.PAPERCLIP_LISTEN_PORT;
    else process.env.PAPERCLIP_LISTEN_PORT = ORIGINAL_PAPERCLIP_LISTEN_PORT;

    if (ORIGINAL_PAPERCLIP_HOME === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = ORIGINAL_PAPERCLIP_HOME;
  });

  it("uses the externally set PAPERCLIP_API_URL when provided", async () => {
    process.env.PAPERCLIP_API_URL = "http://custom-api:3100";

    const started = await startServer();

    expect(started.apiUrl).toBe("http://custom-api:3100");
    expect(process.env.PAPERCLIP_API_URL).toBe("http://custom-api:3100");
    expect(JSON.parse(process.env.PAPERCLIP_RUNTIME_API_CANDIDATES_JSON ?? "[]")).toEqual(
      expect.arrayContaining(["http://custom-api:3100"]),
    );
    expect(JSON.parse(process.env.PAPERCLIP_RUNTIME_API_CANDIDATES_JSON ?? "[]")[0]).toBe("http://custom-api:3100");
  });

  it("falls back to host-based URL when PAPERCLIP_API_URL is not set", async () => {
    const started = await startServer();

    expect(started.apiUrl).toBe("http://127.0.0.1:3210");
    expect(process.env.PAPERCLIP_API_URL).toBe("http://127.0.0.1:3210");
  });

  it("rewrites explicit-port auth public URLs when detect-port selects a new port", async () => {
    loadConfigMock.mockReturnValueOnce(buildTestConfig({
      port: 3100,
      authBaseUrlMode: "explicit",
      authPublicBaseUrl: "http://my-host.ts.net:3100",
    }));
    detectPortMock.mockResolvedValueOnce(3110);

    const started = await startServer();

    expect(started.listenPort).toBe(3110);
    expect(started.apiUrl).toBe("http://my-host.ts.net:3110");
    expect(process.env.PAPERCLIP_RUNTIME_API_URL).toBe("http://my-host.ts.net:3110");
  });

  it("keeps no-port auth public URLs stable when detect-port selects a new port", async () => {
    loadConfigMock.mockReturnValueOnce(buildTestConfig({
      port: 3100,
      authBaseUrlMode: "explicit",
      authPublicBaseUrl: "https://paperclip.example",
    }));
    detectPortMock.mockResolvedValueOnce(3110);

    const started = await startServer();

    expect(started.listenPort).toBe(3110);
    expect(started.apiUrl).toBe("https://paperclip.example");
    expect(process.env.PAPERCLIP_RUNTIME_API_URL).toBe("https://paperclip.example");
  });

  it("does not start heartbeat scheduling from an auto-shifted secondary port", async () => {
    loadConfigMock.mockReturnValueOnce(buildTestConfig({
      port: 3100,
      heartbeatSchedulerEnabled: true,
    }));
    detectPortMock.mockResolvedValueOnce(3110);

    await startServer();

    expect(heartbeatService).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { requestedPort: 3100, listenPort: 3110 },
      "Heartbeat scheduler disabled because this server is not the primary Paperclip control-plane process",
    );
  });

  it("clears heartbeat scheduler intervals during shutdown before they can keep querying the database", async () => {
    vi.useFakeTimers();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const existingSigtermListeners = new Set(process.rawListeners("SIGTERM"));
    loadConfigMock.mockReturnValueOnce(buildTestConfig({
      port: 3100,
      heartbeatSchedulerEnabled: true,
      heartbeatSchedulerIntervalMs: 1000,
    }));

    try {
      await startServer();

      heartbeatServiceInstanceMock.tickTimers.mockClear();
      await vi.advanceTimersByTimeAsync(1000);
      expect(heartbeatServiceInstanceMock.tickTimers).toHaveBeenCalledTimes(1);

      const shutdownListener = process
        .rawListeners("SIGTERM")
        .find((listener) => !existingSigtermListeners.has(listener)) as (() => void) | undefined;
      expect(shutdownListener).toBeDefined();

      shutdownListener?.();
      await vi.waitFor(() => {
        expect(exitSpy).toHaveBeenCalledWith(0);
      });
      heartbeatServiceInstanceMock.tickTimers.mockClear();
      await vi.advanceTimersByTimeAsync(3000);

      expect(heartbeatServiceInstanceMock.tickTimers).not.toHaveBeenCalled();
    } finally {
      for (const listener of process.rawListeners("SIGTERM")) {
        if (!existingSigtermListeners.has(listener)) {
          process.removeListener("SIGTERM", listener);
        }
      }
      exitSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not start heartbeat scheduling when another process owns the scheduler lease", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "paperclip-scheduler-owner-"));
    process.env.PAPERCLIP_HOME = home;
    const instanceRoot = path.join(home, "instances", "default");
    await mkdir(instanceRoot, { recursive: true });
    await writeFile(
      path.join(instanceRoot, "control-plane-scheduler.lock"),
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        requestedPort: 3100,
        listenPort: 3100,
      }),
      "utf8",
    );
    loadConfigMock.mockReturnValueOnce(buildTestConfig({
      port: 3100,
      heartbeatSchedulerEnabled: true,
    }));

    await startServer();

    expect(heartbeatService).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedPort: 3100,
        listenPort: 3100,
        lockPath: expect.stringContaining("control-plane-scheduler.lock"),
      }),
      "Control-plane scheduler disabled because another Paperclip server owns the scheduler lease",
    );
  });

  it("fails fast when another startup already owns the instance startup lease", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "paperclip-startup-owner-"));
    process.env.PAPERCLIP_HOME = home;
    const instanceRoot = path.join(home, "instances", "default");
    await mkdir(instanceRoot, { recursive: true });
    await writeFile(
      path.join(instanceRoot, "server-startup.lock"),
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        requestedPort: 3210,
        listenPort: 3210,
      }),
      "utf8",
    );

    await expect(startServer()).rejects.toThrow(
      /Another Paperclip server startup is already in progress/,
    );
    expect(createAppMock).not.toHaveBeenCalled();
    expect(fakeServer.listen).not.toHaveBeenCalled();
  });

  it("reclaims a stale startup lease even when the recorded owner pid is still alive", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "paperclip-startup-stale-"));
    process.env.PAPERCLIP_HOME = home;
    const instanceRoot = path.join(home, "instances", "default");
    await mkdir(instanceRoot, { recursive: true });
    await writeFile(
      path.join(instanceRoot, "server-startup.lock"),
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
        updatedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
        requestedPort: 3210,
        listenPort: 3210,
      }),
      "utf8",
    );

    await expect(startServer()).resolves.toBeDefined();
    expect(createAppMock).toHaveBeenCalled();
    expect(fakeServer.listen).toHaveBeenCalled();
  });
});
