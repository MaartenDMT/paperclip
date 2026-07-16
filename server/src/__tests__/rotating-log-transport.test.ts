import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const transport = require("../middleware/rotating-log-transport.cjs")._test as {
  nextArchivePath: (activePath: string, dateKey: string) => string;
  rotateActiveLog: (activePath: string, dateKey?: string) => string | null;
  pruneArchives: (activePath: string, maxFiles: number) => void;
};

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-log-"));
  tmpRoots.push(root);
  return root;
}

describe("rotating log transport helpers", () => {
  it("archives active server.log with date and sequence suffixes", () => {
    const root = makeRoot();
    const active = path.join(root, "server.log");
    fs.writeFileSync(active, "first");

    const first = transport.rotateActiveLog(active, "2026-05-17");
    expect(first).toBe(path.join(root, "server-2026-05-17-0001.log"));
    expect(fs.readFileSync(first!, "utf8")).toBe("first");

    fs.writeFileSync(active, "second");
    const second = transport.rotateActiveLog(active, "2026-05-17");
    expect(second).toBe(path.join(root, "server-2026-05-17-0002.log"));
    expect(fs.readFileSync(second!, "utf8")).toBe("second");
  });

  it("prunes oldest rotated archives by mtime", () => {
    const root = makeRoot();
    const active = path.join(root, "server.log");
    for (let i = 1; i <= 4; i += 1) {
      const file = path.join(root, `server-2026-05-17-000${i}.log`);
      fs.writeFileSync(file, String(i));
      const t = new Date(2026, 4, 17, 0, i, 0);
      fs.utimesSync(file, t, t);
    }

    transport.pruneArchives(active, 2);

    expect(fs.existsSync(path.join(root, "server-2026-05-17-0001.log"))).toBe(false);
    expect(fs.existsSync(path.join(root, "server-2026-05-17-0002.log"))).toBe(false);
    expect(fs.existsSync(path.join(root, "server-2026-05-17-0003.log"))).toBe(true);
    expect(fs.existsSync(path.join(root, "server-2026-05-17-0004.log"))).toBe(true);
  });

  it("chooses the next archive name without overwriting existing archives", () => {
    const root = makeRoot();
    const active = path.join(root, "server.log");
    fs.writeFileSync(path.join(root, "server-2026-05-17-0001.log"), "old");

    expect(transport.nextArchivePath(active, "2026-05-17")).toBe(
      path.join(root, "server-2026-05-17-0002.log"),
    );
  });
});
