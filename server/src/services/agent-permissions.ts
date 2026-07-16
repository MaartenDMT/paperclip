export type NormalizedAgentPermissions = Record<string, unknown> & {
  canCreateAgents: boolean;
  canCreateSkills: boolean;
  canRepairControlPlane: boolean;
};

export function defaultPermissionsForRole(role: string): NormalizedAgentPermissions {
  const isCeo = role.trim().toLowerCase() === "ceo";
  return {
    canCreateAgents: isCeo,
    canCreateSkills: true,
    canRepairControlPlane: isCeo,
  };
}

export function agentRoleCanAssignTasks(role: string | null | undefined): boolean {
  return role === "ceo" || role === "cto" || role === "cmo" || role === "cfo" || role === "pm";
}

export function normalizeAgentPermissions(
  permissions: unknown,
  role: string,
): NormalizedAgentPermissions {
  const defaults = defaultPermissionsForRole(role);
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    return defaults;
  }

  const record = permissions as Record<string, unknown>;
  const preserved = { ...record };
  return {
    ...preserved,
    canCreateAgents:
      typeof record.canCreateAgents === "boolean"
        ? record.canCreateAgents
        : defaults.canCreateAgents,
    canCreateSkills:
      typeof record.canCreateSkills === "boolean"
        ? record.canCreateSkills
        : defaults.canCreateSkills,
    canRepairControlPlane:
      typeof record.canRepairControlPlane === "boolean"
        ? record.canRepairControlPlane
        : defaults.canRepairControlPlane,
  };
}
