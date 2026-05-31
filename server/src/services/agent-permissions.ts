export type NormalizedAgentPermissions = Record<string, unknown> & {
  canCreateAgents: boolean;
  canRepairControlPlane: boolean;
};

export function defaultPermissionsForRole(role: string): NormalizedAgentPermissions {
  return {
    canCreateAgents: role === "ceo",
    canRepairControlPlane: role === "ceo",
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
  return {
    canCreateAgents:
      typeof record.canCreateAgents === "boolean"
        ? record.canCreateAgents
        : defaults.canCreateAgents,
    canRepairControlPlane:
      typeof record.canRepairControlPlane === "boolean"
        ? record.canRepairControlPlane
        : defaults.canRepairControlPlane,
  };
}
