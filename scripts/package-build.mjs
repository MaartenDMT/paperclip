#!/usr/bin/env node

import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const [command, ...args] = process.argv.slice(2);

if (command === "clean") {
  if (args.length !== 1 || args[0] !== "dist") {
    throw new Error("clean accepts only the package-local dist directory");
  }
  const distRoot = resolve(process.cwd(), "dist");
  if (existsSync(distRoot) && lstatSync(distRoot).isSymbolicLink()) {
    throw new Error("clean refuses a symlinked dist directory");
  }
  rmSync(distRoot, { force: true, recursive: true });
} else if (command === "copy") {
  if (args.length < 2) throw new Error("copy requires at least one source and a destination");
  const destination = resolve(args.at(-1));
  const sources = args.slice(0, -1).map((source) => resolve(source));
  const singleDirectory = sources.length === 1 && statSync(sources[0]).isDirectory();
  const destinationIsDirectory = !singleDirectory && (sources.length > 1 || (existsSync(destination) && statSync(destination).isDirectory()));
  if (destinationIsDirectory) mkdirSync(destination, { recursive: true });
  for (const source of sources) {
    const target = destinationIsDirectory ? join(destination, basename(source)) : destination;
    cpSync(source, target, { force: true, recursive: true });
  }
} else if (command === "chmod") {
  if (args.length === 0) throw new Error("chmod requires at least one path");
  for (const target of args) {
    const file = resolve(target);
    chmodSync(file, (statSync(file).mode & 0o777) | 0o111);
  }
} else {
  throw new Error(`Unknown package build command: ${command ?? "(missing)"}`);
}
