import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { resolveMigrationConnection } from "./migration-runtime.js";

const FILES = [
  { name: "0054_draft_routines.sql", when: 0 },
  { name: "0071_default_hire_approval_off.sql", when: 0 },
];

const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));
const JOURNAL = fileURLToPath(new URL("./migrations/meta/_journal.json", import.meta.url));

async function main() {
  const journal = JSON.parse(await readFile(JOURNAL, "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  for (const f of FILES) {
    const j = journal.entries.find((e) => `${e.tag}.sql` === f.name);
    if (j) f.when = j.when;
  }

  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    for (const f of FILES) {
      const content = await readFile(`${MIGRATIONS_FOLDER}/${f.name}`, "utf8");
      const hash = createHash("sha256").update(content).digest("hex");
      const existing = await sql`
        SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = ${hash} LIMIT 1`;
      if (existing.length > 0) {
        console.log(`  already recorded: ${f.name}`);
        continue;
      }
      await sql`
        INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
        VALUES (${hash}, ${f.when})`;
      console.log(`  + ${f.name}`);
    }
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
