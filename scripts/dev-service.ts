#!/usr/bin/env -S node --import tsx
import {
  isLocalServiceRecordAlive,
  pruneStaleLocalServiceRegistryRecords,
  removeLocalServiceRegistryRecord,
  terminateLocalService,
  type listLocalServiceRegistryRecords,
} from "../server/src/services/local-service-supervisor.ts";
import { repoRoot } from "./dev-service-profile.ts";

function toDisplayLines(records: Awaited<ReturnType<typeof listLocalServiceRegistryRecords>>) {
  return records.map((record) => {
    const childPid = typeof record.metadata?.childPid === "number" ? ` child=${record.metadata.childPid}` : "";
    const url = typeof record.metadata?.url === "string" ? ` url=${record.metadata.url}` : "";
    return `${record.serviceName} pid=${record.pid}${childPid} cwd=${record.cwd}${url}`;
  });
}

const command = process.argv[2] ?? "list";
const filter = {
  profileKind: "paperclip-dev",
  metadata: { repoRoot },
};
const { active: records, stale } = await pruneStaleLocalServiceRegistryRecords(filter);

for (const record of stale) {
  console.log(`Removed stale ${record.serviceName} (pid ${record.pid})`);
}

if (command === "list") {
  if (records.length === 0) {
    console.log("No Paperclip dev services registered for this repo.");
    process.exit(0);
  }
  for (const line of toDisplayLines(records)) {
    console.log(line);
  }
  process.exit(0);
}

if (command === "stop") {
  if (records.length === 0) {
    console.log("No Paperclip dev services registered for this repo.");
    process.exit(0);
  }
  let failedStops = 0;
  for (const record of records) {
    await terminateLocalService(record);
    if (isLocalServiceRecordAlive(record)) {
      const childPid = typeof record.metadata?.childPid === "number" ? `, child ${record.metadata.childPid}` : "";
      console.error(`Failed to stop ${record.serviceName} (pid ${record.pid}${childPid})`);
      failedStops += 1;
      continue;
    }
    await removeLocalServiceRegistryRecord(record.serviceKey);
    console.log(`Stopped ${record.serviceName} (pid ${record.pid})`);
  }
  process.exit(failedStops > 0 ? 1 : 0);
}

console.error(`Unknown dev-service command: ${command}`);
process.exit(1);
