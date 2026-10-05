import {
  agentDelegationParentOf,
  isBackgroundAgentSession,
  type AgentScopeInputs,
  type AgentScopeMetadata,
} from './agent-scope';

export interface AgentSessionMetadataLike extends AgentScopeInputs {
  metadata?: (AgentScopeMetadata & { taskNoteId?: unknown }) | null;
}

/**
 * A delegated (parented, per the shared `agent-scope` classifier) background
 * session that carries a linked task note.
 */
export function isDelegatedBackgroundTaskSession(
  session?: AgentSessionMetadataLike | null,
): boolean {
  if (!session) return false;
  return (
    isBackgroundAgentSession(session) &&
    agentDelegationParentOf(session) !== null &&
    typeof session.metadata?.taskNoteId === 'string'
  );
}
