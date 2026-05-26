function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function isMeetingWorkflowWakeContext(contextSnapshot: Record<string, unknown> | null | undefined) {
  if (!contextSnapshot) return false;
  const wakeReason = readString(contextSnapshot.wakeReason);
  const meetingId = readString(contextSnapshot.meetingId);
  if (wakeReason !== "agent_meeting_requested" || !meetingId) return false;

  const source = readString(contextSnapshot.source);
  if (source?.startsWith("meeting_workflow.")) return true;

  return readString(contextSnapshot.interactionKind) === "agent_meeting";
}
