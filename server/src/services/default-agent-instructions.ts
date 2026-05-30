import fs from "node:fs/promises";

const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  ceo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  manager: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
} as const;

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

const MANAGER_ROLES = new Set(["cto", "cmo", "cfo", "pm"]);
const MANAGER_TITLE_PATTERN = /\b(chief|cto|cmo|cfo|director|manager|lead|head|vp|vice president)\b/i;

type ResolveDefaultAgentInstructionsBundleRoleOptions = {
  title?: string | null;
  hasDirectReports?: boolean;
};

function resolveDefaultAgentBundleUrl(role: DefaultAgentBundleRole, fileName: string) {
  return new URL(`../onboarding-assets/${role}/${fileName}`, import.meta.url);
}

export async function loadDefaultAgentInstructionsBundle(role: DefaultAgentBundleRole): Promise<Record<string, string>> {
  const fileNames = DEFAULT_AGENT_BUNDLE_FILES[role];
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const content = await fs.readFile(resolveDefaultAgentBundleUrl(role, fileName), "utf8");
      return [fileName, content] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function isManagerLikeAgent(input: {
  role: string;
  title?: string | null;
  hasDirectReports?: boolean;
}) {
  const role = input.role.trim().toLowerCase();
  if (MANAGER_ROLES.has(role)) return true;
  if (input.hasDirectReports === true) return true;
  return MANAGER_TITLE_PATTERN.test(input.title ?? "");
}

export function resolveDefaultAgentInstructionsBundleRole(
  role: string,
  options: ResolveDefaultAgentInstructionsBundleRoleOptions = {},
): DefaultAgentBundleRole {
  const normalizedRole = role.trim().toLowerCase();
  if (normalizedRole === "ceo") return "ceo";
  if (isManagerLikeAgent({ role: normalizedRole, title: options.title, hasDirectReports: options.hasDirectReports })) return "manager";
  return "default";
}
