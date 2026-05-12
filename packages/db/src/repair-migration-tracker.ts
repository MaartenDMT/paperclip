import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));
const MIGRATIONS_JOURNAL_JSON = fileURLToPath(
  new URL("./migrations/meta/_journal.json", import.meta.url),
);

type JournalEntry = { fileName: string; folderMillis: number; order: number };

async function listJournalEntries(): Promise<JournalEntry[]> {
  const raw = await readFile(MIGRATIONS_JOURNAL_JSON, "utf8");
  const parsed = JSON.parse(raw) as {
    entries?: Array<{ idx?: number; tag?: string; when?: number }>;
  };
  if (!Array.isArray(parsed.entries)) return [];
  return parsed.entries
    .map((entry, i) => {
      if (typeof entry?.tag !== "string") return null;
      if (typeof entry?.when !== "number") return null;
      return {
        fileName: `${entry.tag}.sql`,
        folderMillis: entry.when,
        order: Number.isInteger(entry.idx) ? Number(entry.idx) : i,
      };
    })
    .filter((e): e is JournalEntry => e !== null)
    .sort((a, b) => a.order - b.order);
}

function splitStatements(sql: string): string[] {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  // Split on statement breakpoint markers or bare semicolons
  return cleaned
    .split(/-->\s*statement-breakpoint|;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function tableExists(sql: postgres.Sql, name: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = ${name}) AS exists`;
  return rows[0]?.exists ?? false;
}
async function columnExists(sql: postgres.Sql, table: string, column: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}) AS exists`;
  return rows[0]?.exists ?? false;
}
async function indexExists(sql: postgres.Sql, name: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_indexes
      WHERE schemaname = current_schema() AND indexname = ${name}) AS exists`;
  return rows[0]?.exists ?? false;
}
async function constraintExists(sql: postgres.Sql, name: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = current_schema() AND c.conname = ${name}) AS exists`;
  return rows[0]?.exists ?? false;
}
async function typeExists(sql: postgres.Sql, name: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = current_schema() AND t.typname = ${name}) AS exists`;
  return rows[0]?.exists ?? false;
}
async function extensionExists(sql: postgres.Sql, name: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = ${name}) AS exists`;
  return rows[0]?.exists ?? false;
}

type StatementCheck = "yes" | "no" | "unknown";

async function checkStatement(sql: postgres.Sql, stmt: string): Promise<StatementCheck> {
  const n = stmt.replace(/\s+/g, " ").trim();
  let m;
  if ((m = n.match(/^CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"([^"]+)"/i))) {
    return (await tableExists(sql, m[1])) ? "yes" : "no";
  }
  if ((m = n.match(/^ALTER TABLE\s+(?:IF EXISTS\s+)?"([^"]+)"\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"([^"]+)"/i))) {
    return (await columnExists(sql, m[1], m[2])) ? "yes" : "no";
  }
  if ((m = n.match(/^CREATE(?:\s+UNIQUE)?\s+INDEX(?:\s+IF NOT EXISTS)?\s+"([^"]+)"/i))) {
    return (await indexExists(sql, m[1])) ? "yes" : "no";
  }
  if ((m = n.match(/^ALTER TABLE\s+(?:IF EXISTS\s+)?"([^"]+)"\s+ADD CONSTRAINT\s+"([^"]+)"/i))) {
    return (await constraintExists(sql, m[2])) ? "yes" : "no";
  }
  if ((m = n.match(/^CREATE TYPE\s+"([^"]+)"/i))) {
    return (await typeExists(sql, m[1])) ? "yes" : "no";
  }
  if ((m = n.match(/^CREATE EXTENSION(?:\s+IF NOT EXISTS)?\s+"?([a-zA-Z0-9_]+)"?/i))) {
    return (await extensionExists(sql, m[1])) ? "yes" : "no";
  }
  // ALTER TABLE ... DROP / ALTER COLUMN / RENAME / INSERT / UPDATE / DO blocks — can't verify safely
  return "unknown";
}

type FileVerdict =
  | { kind: "applied" }
  | { kind: "pending"; reason: string }
  | { kind: "ambiguous"; unknownCount: number; verifiedCount: number };

async function classifyMigration(sql: postgres.Sql, content: string): Promise<FileVerdict> {
  const stmts = splitStatements(content);
  if (stmts.length === 0) return { kind: "pending", reason: "empty" };
  let verified = 0;
  let unknown = 0;
  for (const s of stmts) {
    const r = await checkStatement(sql, s);
    if (r === "no") return { kind: "pending", reason: `missing artifact: ${s.slice(0, 80)}` };
    if (r === "yes") verified++;
    else unknown++;
  }
  if (verified > 0) return { kind: "applied" };
  return { kind: "ambiguous", unknownCount: unknown, verifiedCount: 0 };
}

async function main() {
  const resolved = await resolveMigrationConnection();
  const sql = postgres(resolved.connectionString, { max: 1 });
  try {
    const entries = await listJournalEntries();
    console.log(`Total migration files: ${entries.length}`);

    const schemaRow = await sql<{ schema_name: string }[]>`
      SELECT n.nspname AS schema_name FROM pg_namespace n
      JOIN pg_class c ON c.relnamespace = n.oid
      WHERE c.relname = '__drizzle_migrations' LIMIT 1`;
    const trackerSchema = schemaRow[0]?.schema_name;
    if (!trackerSchema) {
      console.error("No __drizzle_migrations tracker table found.");
      process.exit(1);
    }
    console.log(`Tracker: "${trackerSchema}"."__drizzle_migrations"`);

    const colsRows = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${trackerSchema} AND table_name = '__drizzle_migrations'`;
    const cols = new Set(colsRows.map((r) => r.column_name));
    console.log(`Tracker columns: ${Array.from(cols).join(", ")}`);

    // Determine what's already recorded
    const recorded = new Set<string>();
    if (cols.has("name")) {
      const rows = await sql.unsafe<{ name: string }[]>(
        `SELECT name FROM "${trackerSchema}"."__drizzle_migrations"`,
      );
      for (const r of rows) if (r.name) recorded.add(r.name);
    }
    if (cols.has("hash")) {
      const rows = await sql.unsafe<{ hash: string }[]>(
        `SELECT hash FROM "${trackerSchema}"."__drizzle_migrations"`,
      );
      const recordedHashes = new Set(rows.map((r) => r.hash));
      for (const e of entries) {
        const content = await readFile(`${MIGRATIONS_FOLDER}/${e.fileName}`, "utf8");
        const h = createHash("sha256").update(content).digest("hex");
        if (recordedHashes.has(h)) recorded.add(e.fileName);
      }
    }
    console.log(`Already recorded: ${recorded.size}/${entries.length}`);

    let repaired = 0;
    let stillPending = 0;
    const ambiguous: string[] = [];

    for (const entry of entries) {
      if (recorded.has(entry.fileName)) continue;
      const content = await readFile(`${MIGRATIONS_FOLDER}/${entry.fileName}`, "utf8");
      const verdict = await classifyMigration(sql, content);

      if (verdict.kind === "applied") {
        const hash = createHash("sha256").update(content).digest("hex");
        const insertCols: string[] = [];
        const insertVals: string[] = [];
        if (cols.has("hash")) { insertCols.push("hash"); insertVals.push(`'${hash}'`); }
        if (cols.has("name")) { insertCols.push("name"); insertVals.push(`'${entry.fileName}'`); }
        if (cols.has("created_at")) { insertCols.push("created_at"); insertVals.push(String(entry.folderMillis)); }
        if (insertCols.length > 0) {
          await sql.unsafe(
            `INSERT INTO "${trackerSchema}"."__drizzle_migrations" (${insertCols.map((c) => `"${c}"`).join(", ")}) VALUES (${insertVals.join(", ")})`,
          );
          repaired++;
          console.log(`  + applied:    ${entry.fileName}`);
        }
      } else if (verdict.kind === "pending") {
        stillPending++;
        console.log(`  - pending:    ${entry.fileName} (${verdict.reason.slice(0, 60)})`);
      } else {
        ambiguous.push(entry.fileName);
        console.log(`  ? ambiguous:  ${entry.fileName} (verified=${verdict.verifiedCount}, unknown=${verdict.unknownCount})`);
      }
    }

    console.log("");
    console.log("Summary:");
    console.log(`  Back-filled as applied: ${repaired}`);
    console.log(`  Still genuinely pending: ${stillPending}`);
    console.log(`  Ambiguous (manual review): ${ambiguous.length}`);
  } finally {
    await sql.end({ timeout: 5 });
    await resolved.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
