export interface AgentSessionMetadataLike {
  isBackground?: boolean | null;
  metadata?: Record<string, unknown> | null;
}

export function isDelegatedBackgroundTaskSession(
  session?: AgentSessionMetadataLike | null,
): boolean {
  const metadata = session?.metadata ?? {};
  return (
    (session?.isBackground === true || metadata.isBackground === true) &&
    typeof metadata.createdByAgentId === 'string' &&
    typeof metadata.taskNoteId === 'string'
  );
}
