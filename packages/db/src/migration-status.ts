import { inspectMigrations } from "./client.js";
import { resolveMigrationConnection } from "./migration-runtime.js";

const jsonMode = process.argv.includes("--json");
const keepEmbeddedPostgres = process.argv.includes("--keep-embedded-postgres");
const DEFAULT_EXTERNAL_POSTGRES_READY_TIMEOUT_MS = 5_000;

function isEmbeddedSource(source: string): boolean {
  return source.startsWith("embedded-postgres@");
}

function resolveExternalPostgresReadyTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.PAPERCLIP_EXTERNAL_POSTGRES_READY_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXTERNAL_POSTGRES_READY_TIMEOUT_MS;
}

function isPostgresUnavailableError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const haystack = message.toLowerCase();
  return (
    code === "ECONNREFUSED" ||
    code === "CONNECT_TIMEOUT" ||
    haystack.includes("connect econnrefused") ||
    haystack.includes("connect_timeout") ||
    haystack.includes("connection refused")
  );
}

function redactConnectionStringForMessage(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    url.username = "";
    url.password = "";
    return url.toString().replace("//@", "//");
  } catch {
    return "<configured postgres url>";
  }
}

function toError(error: unknown, context = "Migration status check failed"): Error {
  if (error instanceof Error) return error;
  if (error === undefined) return new Error(context);
  if (typeof error === "string") return new Error(`${context}: ${error}`);

  try {
    return new Error(`${context}: ${JSON.stringify(error)}`);
  } catch {
    return new Error(`${context}: ${String(error)}`);
  }
}

async function main(): Promise<void> {
  const connection = await resolveMigrationConnection({ stopStartedEmbeddedPostgres: !keepEmbeddedPostgres });

  try {
    const state = await inspectMigrations(connection.connectionString, {
      startupReadyTimeoutMs: isEmbeddedSource(connection.source)
        ? undefined
        : resolveExternalPostgresReadyTimeoutMs(),
    });
    const payload =
      state.status === "upToDate"
        ? {
            source: connection.source,
            status: "upToDate" as const,
            tableCount: state.tableCount,
            pendingMigrations: [] as string[],
          }
        : {
            source: connection.source,
            status: "needsMigrations" as const,
            tableCount: state.tableCount,
            pendingMigrations: state.pendingMigrations,
            reason: state.reason,
          };

    if (jsonMode) {
      console.log(JSON.stringify(payload));
      return;
    }

    if (payload.status === "upToDate") {
      console.log(`Database is up to date via ${payload.source}`);
      return;
    }

    console.log(
      `Pending migrations via ${payload.source}: ${payload.pendingMigrations.join(", ")}`,
    );
  } catch (error) {
    if (!isEmbeddedSource(connection.source) && isPostgresUnavailableError(error)) {
      throw new Error(
        `Configured external PostgreSQL is unreachable via ${connection.source} at ${redactConnectionStringForMessage(connection.connectionString)}. Start that database, update the configured connection string, or remove DATABASE_URL/config.database.connectionString to use embedded PostgreSQL. Original error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw error;
  } finally {
    await connection.stop();
  }
}

main().then(
  () => {
    process.exit(0);
  },
  (error) => {
    const err = toError(error, "Migration status check failed");
    process.stderr.write(`${err.stack ?? err.message}\n`);
    process.exit(1);
  },
);
