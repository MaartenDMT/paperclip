"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Writable } = require("node:stream");
const pretty = require("pino-pretty");

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_FILES = 30;

function coercePositiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function localDateKey(date = new Date()) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fileDateKey(filePath) {
  try {
    return localDateKey(fs.statSync(filePath).mtime);
  } catch {
    return localDateKey();
  }
}

function nextArchivePath(activePath, dateKey) {
  const dir = path.dirname(activePath);
  const ext = path.extname(activePath) || ".log";
  const base = path.basename(activePath, ext);
  for (let i = 1; i < 10_000; i += 1) {
    const candidate = path.join(dir, `${base}-${dateKey}-${String(i).padStart(4, "0")}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base}-${dateKey}-${Date.now()}${ext}`);
}

function rotateActiveLog(activePath, reasonDateKey = fileDateKey(activePath)) {
  if (!fs.existsSync(activePath)) return null;
  const archive = nextArchivePath(activePath, reasonDateKey);
  fs.renameSync(activePath, archive);
  return archive;
}

function pruneArchives(activePath, maxFiles) {
  if (maxFiles <= 0) return;
  const dir = path.dirname(activePath);
  const ext = path.extname(activePath) || ".log";
  const base = path.basename(activePath, ext);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const archives = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${base}-`) && entry.name.endsWith(ext))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(fullPath).mtimeMs;
      } catch {
        mtimeMs = Number.POSITIVE_INFINITY;
      }
      return { fullPath, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const archive of archives.slice(maxFiles)) {
    try {
      fs.rmSync(archive.fullPath, { force: true });
    } catch {
      // Best-effort retention cleanup must never break logging.
    }
  }
}

class RotatingLogFileStream extends Writable {
  constructor(options) {
    super();
    this.destination = path.resolve(options.destination);
    this.maxBytes = coercePositiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
    this.maxFiles = coercePositiveInteger(options.maxFiles, DEFAULT_MAX_FILES);
    this.currentDateKey = localDateKey();
    this.currentBytes = 0;
    this.stream = null;
    fs.mkdirSync(path.dirname(this.destination), { recursive: true });
    this.open();
  }

  open() {
    if (fs.existsSync(this.destination)) {
      let stats = null;
      try {
        stats = fs.statSync(this.destination);
      } catch {
        stats = null;
      }
      const existingDateKey = stats ? localDateKey(stats.mtime) : this.currentDateKey;
      if (existingDateKey !== this.currentDateKey || (stats && stats.size >= this.maxBytes)) {
        rotateActiveLog(this.destination, existingDateKey);
      }
    }
    try {
      this.currentBytes = fs.existsSync(this.destination) ? fs.statSync(this.destination).size : 0;
    } catch {
      this.currentBytes = 0;
    }
    this.stream = fs.createWriteStream(this.destination, { flags: "a" });
    pruneArchives(this.destination, this.maxFiles);
  }

  rotate(dateKey) {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    if (fs.existsSync(this.destination)) {
      rotateActiveLog(this.destination, dateKey);
    }
    this.currentBytes = 0;
    this.currentDateKey = localDateKey();
    this.stream = fs.createWriteStream(this.destination, { flags: "a" });
    pruneArchives(this.destination, this.maxFiles);
  }

  _write(chunk, encoding, callback) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    const today = localDateKey();
    if (today !== this.currentDateKey) {
      this.rotate(this.currentDateKey);
    } else if (this.currentBytes > 0 && this.currentBytes + buffer.length > this.maxBytes) {
      this.rotate(today);
    }
    this.currentBytes += buffer.length;
    this.stream.write(buffer, callback);
  }

  _final(callback) {
    if (!this.stream) {
      callback();
      return;
    }
    this.stream.end(callback);
  }
}

module.exports = function buildRotatingPrettyTransport(options = {}) {
  const {
    destination,
    maxBytes = DEFAULT_MAX_BYTES,
    maxFiles = DEFAULT_MAX_FILES,
    ...prettyOptions
  } = options;
  if (typeof destination !== "string" || destination.trim().length === 0) {
    throw new Error("rotating-log-transport requires a destination path");
  }
  return pretty({
    ...prettyOptions,
    destination: new RotatingLogFileStream({ destination, maxBytes, maxFiles }),
  });
};

module.exports._test = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILES,
  localDateKey,
  nextArchivePath,
  rotateActiveLog,
  pruneArchives,
  RotatingLogFileStream,
};
