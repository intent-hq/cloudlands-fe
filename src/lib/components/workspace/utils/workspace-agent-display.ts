import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';

/** Agent display info shared by the home page table rows and sidebar workspace cards. */
export interface WorkspaceAgentDisplayInfo {
  id: string;
  state: AvatarState;
  specialist: 'spec-writer' | 'implementor' | 'verifier' | null;
  isUnread: boolean;
}

/**
 * Snapshot of one agent's live state, resolved by the caller from the canonical
 * Redux selectors (`selectAgentSession`, `selectAgentIsWaiting`,
 * `selectAgentIsResponding`) plus a streaming fallback for unloaded sessions.
 * Keeping the resolution in the caller keeps this utility dependency-light.
 */
export interface WorkspaceAgentStateSnapshot {
  /** Whether the agent session is loaded in the store. */
  hasLoadedSession: boolean;
  /** Canonical waiting state; only meaningful when the session is loaded. */
  isWaiting: boolean;
  /** Canonical responding state; only meaningful when the session is loaded. */
  isResponding: boolean;
  /** Streaming fallback (activeStreamsTracker / streamingAgentIds) used when the session is not loaded. */
  isStreamingFallback: boolean;
  /** Loaded session status (e.g. 'error', 'failed'). */
  sessionStatus?: string;
  specialist?: WorkspaceAgentDisplayInfo['specialist'];
}

export interface WorkspaceAgentDisplayOptions {
  /** Member agent IDs from `workspace.agentSummary.agentIds`. */
  memberAgentIds: string[];
  /** Unread agent IDs for this workspace. */
  unreadAgentIds: Iterable<string>;
  /** `workspace.activity` — 'idle' is authoritative and suppresses running/waiting. */
  workspaceActivity?: 'idle' | 'agent_running';
  /** Resolves the live state snapshot for one agent. */
  getAgentSnapshot: (agentId: string) => WorkspaceAgentStateSnapshot;
}

/**
 * Derive the avatar state for one agent from its snapshot.
 *
 * Failed sessions always surface as 'failed'. Otherwise
 * `workspace.activity === 'idle'` is authoritative — no running/waiting when
 * the daemon says idle, even if stale Redux/tracker data remains.
 */
export function deriveWorkspaceAgentState(
  snapshot: WorkspaceAgentStateSnapshot,
  workspaceActivity?: 'idle' | 'agent_running',
): AvatarState {
  if (snapshot.sessionStatus === 'error' || snapshot.sessionStatus === 'failed') {
    return 'failed';
  }
  if (workspaceActivity === 'idle') {
    return 'idle';
  }

  const isWaiting = snapshot.hasLoadedSession ? snapshot.isWaiting : false;
  const isResponding = snapshot.hasLoadedSession
    ? snapshot.isResponding
    : snapshot.isStreamingFallback;

  if (isWaiting) return 'waiting';
  if (isResponding) return 'running';
  return 'idle';
}

/**
 * Shared filtering/state-derivation for workspace agent icons: returns display
 * infos for agents whose derived state is not idle OR that have unread
 * messages, so the home page rows and sidebar cards render the same agents.
 */
export function getWorkspaceAgentDisplayInfos(
  options: WorkspaceAgentDisplayOptions,
): WorkspaceAgentDisplayInfo[] {
  const { memberAgentIds, unreadAgentIds, workspaceActivity, getAgentSnapshot } = options;

  if (memberAgentIds.length === 0) {
    return [];
  }

  const unreadSet = new Set(unreadAgentIds);

  return memberAgentIds
    .map((agentId) => {
      const snapshot = getAgentSnapshot(agentId);
      return {
        id: agentId,
        state: deriveWorkspaceAgentState(snapshot, workspaceActivity),
        specialist: snapshot.specialist ?? null,
        isUnread: unreadSet.has(agentId),
      };
    })
    .filter((agent) => agent.state !== 'idle' || agent.isUnread);
}
