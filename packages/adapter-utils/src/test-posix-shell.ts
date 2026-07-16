import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type PosixShell = "bash" | "sh";

const windowsShellCandidates: Record<PosixShell, string[]> = {
  bash: [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "D:\\msys64\\usr\\bin\\bash.exe",
    "C:\\msys64\\usr\\bin\\bash.exe",
  ],
  sh: [
    "C:\\Program Files\\Git\\usr\\bin\\sh.exe",
    "D:\\msys64\\usr\\bin\\sh.exe",
    "C:\\msys64\\usr\\bin\\sh.exe",
  ],
};

export function resolveTestPosixShell(shell: PosixShell): string {
  if (process.platform !== "win32") return shell === "bash" ? "/bin/bash" : "/bin/sh";
  return windowsShellCandidates[shell].find((candidate) => existsSync(candidate)) ?? shell;
}

export function resolveTestCommand(command: string): string {
  if (command === "bash" || command === "sh") return resolveTestPosixShell(command);
  return command;
}

export function resolveTestProcessCommand(command: string, args: string[] = []): { command: string; args: string[] } {
  if (
    process.platform === "win32" &&
    args.length === 0 &&
    /[\s;&|<>()$`"'\n]/.test(command) &&
    !existsSync(command)
  ) {
    return {
      command: resolveTestPosixShell("sh"),
      args: translateTestPosixShellArgs(["-lc", command]),
    };
  }

  return {
    command: translateTestPosixPathToWindows(resolveTestCommand(command)),
    args: translateTestPosixShellArgs(args),
  };
}

export async function prepareTestProcessCommand(
  command: string,
  args: string[] = [],
): Promise<{ command: string; args: string[]; cleanup: () => Promise<void> }> {
  const resolved = resolveTestProcessCommand(command, args);
  const script = resolved.args[1];
  if (
    process.platform === "win32" &&
    (resolved.args[0] === "-c" || resolved.args[0] === "-lc") &&
    typeof script === "string" &&
    script.length > 6000
  ) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "paperclip-test-shell-"));
    const scriptPath = path.join(dir, "script.sh");
    await writeFile(scriptPath, script, "utf8");
    return {
      command: resolved.command,
      args: [scriptPath, ...resolved.args.slice(2)],
      cleanup: async () => {
        await rm(dir, { recursive: true, force: true });
      },
    };
  }

  return {
    ...resolved,
    cleanup: async () => {},
  };
}

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function withTestPosixShellPath(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const cleanEnv = definedEnv(env);
  const shell = resolveTestPosixShell("sh");
  if (!path.isAbsolute(shell)) return cleanEnv;
  return {
    ...cleanEnv,
    PATH: `${path.dirname(shell)}${path.delimiter}${cleanEnv.PATH ?? ""}`,
  };
}

export function translateWindowsPathsForTestPosixShell(script: string): string {
  if (process.platform !== "win32") return script;
  return script.replace(/\b([A-Za-z]):[\\/][^'"`\s]*/g, (match, drive: string) => {
    const withoutDrive = match.slice(2).replace(/\\/g, "/").replace(/^\/+/, "");
    return `/${drive.toLowerCase()}/${withoutDrive}`;
  });
}

export function translateTestPosixShellArgs(args: string[]): string[] {
  if (args.length < 2 || (args[0] !== "-c" && args[0] !== "-lc")) return args;
  return [args[0], translateWindowsPathsForTestPosixShell(args[1] ?? ""), ...args.slice(2)];
}

export function translateTestPosixPathToWindows(value: string): string {
  if (process.platform !== "win32") return value;
  const drivePath = value.match(/^\/([a-zA-Z])\/(.+)$/);
  if (drivePath) {
    return `${drivePath[1]!.toUpperCase()}:\\${drivePath[2]!.replace(/\//g, "\\")}`;
  }
  if (value === "/tmp") return os.tmpdir();
  if (value.startsWith("/tmp/")) {
    return path.join(os.tmpdir(), ...value.slice("/tmp/".length).split("/"));
  }
  return value;
}
