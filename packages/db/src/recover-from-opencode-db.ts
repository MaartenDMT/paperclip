import postgres from "postgres";
import { spawn } from "node:child_process";
import { resolveMigrationConnection } from "./migration-runtime.js";

const PYTHON = "A:/DevCache/uv/tools/graphifyy/Scripts/python.exe";
const OPENCODE_DB = "D:\\WindowsData\\opencode\\opencode.db";
const CUTOFF = "2026-05-11T18:50:00Z";

function querySqlite(sessionIds: string[]): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const py = `
import sqlite3, json, sys
ids = json.loads(sys.stdin.read())
con = sqlite3.connect(r'${OPENCODE_DB}')
cur = con.cursor()
out = {}
for sid in ids:
    row = cur.execute('SELECT model FROM session WHERE id = ?', (sid,)).fetchone()
    if row and row[0]:
        try:
            m = json.loads(row[0])
            if m.get('providerID') and m.get('id'):
                out[sid] = m['providerID'] + '/' + m['id']
        except Exception:
            pass
print(json.dumps(out))
`;
    const p = spawn(PYTHON, ["-c", py], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) => {
      if (code !== 0) reject(new Error(`python exit ${code}: ${stderr}`));
      else { try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); } }
    });
    p.stdin.end(JSON.stringify(sessionIds));
  });
}

async function main() {
  const r = await resolveMigrationConnection();
  const sql = postgres(r.connectionString, { max: 1 });
  try {
    const candidates = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM agents
      WHERE adapter_type = 'opencode_local'
        AND adapter_config -> 'model' #>> '{}' = 'github-copilot/gpt-5-mini'`;
    console.log(`Recovering ${candidates.length} agents via opencode.db sessions...\n`);

    // 1. For each agent, find its most recent sessionID before the cutoff
    const agentToSession = new Map<string, { name: string; sessionId: string }>();
    const allSessionIds: string[] = [];
    for (const a of candidates) {
      const row = await sql<{ sid: string | null }[]>`
        SELECT substring((result_json::jsonb ->> 'stdout') from '"sessionID":"([^"]+)"') AS sid
        FROM heartbeat_runs
        WHERE agent_id = ${a.id}
          AND created_at < ${CUTOFF}
          AND (result_json::jsonb ->> 'stdout') LIKE '%sessionID%'
        ORDER BY created_at DESC LIMIT 1`;
      const sid = row[0]?.sid;
      if (sid) {
        agentToSession.set(a.id, { name: a.name, sessionId: sid });
        allSessionIds.push(sid);
      }
    }
    console.log(`Found sessionIDs for ${allSessionIds.length}/${candidates.length} agents`);
    if (allSessionIds.length === 0) { console.log("Nothing to recover."); return; }

    // 2. Query opencode.db for each session's model
    const sessionToModel = await querySqlite(allSessionIds);
    console.log(`opencode.db returned models for ${Object.keys(sessionToModel).length} sessions\n`);

    // 3. Apply
    let applied = 0, missing = 0;
    for (const a of candidates) {
      const link = agentToSession.get(a.id);
      const model = link ? sessionToModel[link.sessionId] : undefined;
      if (!model) { console.log(`  MISS ${a.name}`); missing++; continue; }
      // opencode.db stores model as "provider/model" with dashes; matches our format directly
      await sql`
        UPDATE agents
        SET adapter_config = jsonb_set(adapter_config::jsonb, '{model}', to_jsonb(${model}::text)),
            updated_at = now()
        WHERE id = ${a.id}`;
      console.log(`  OK   ${a.name.padEnd(40)} -> ${model}`);
      applied++;
    }
    console.log(`\nApplied ${applied} reverts. ${missing} agents had no recoverable model (left at github-copilot/gpt-5-mini).`);
  } finally {
    await sql.end();
    await r.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
