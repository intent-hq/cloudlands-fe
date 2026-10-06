/**
 * Sidebar Nav Selectors
 */

import { store } from '../../store';
import type { StoreState } from '../../types';
import type { AgentMessage, AgentSession } from '$shared/types';
import { CHIEF_WORKSPACE_ID, type ChiefThreadSummary } from './sidebar-nav-types';
import { getChiefThreadTitle } from './chief-thread-title';
import { CHIEF_PROMPT_VERSION, CHIEF_SPECIALIST_ID } from '$shared/chief-agent-config';

function getMessageTimestamp(message: AgentMessage | undefined): number {
  const value = message?.timestamp;
  if (!value) return 0;
  return new Date(value).getTime() || 0;
}

function getSessionTimestamp(session: AgentSession): number {
  const value = session.lastActivity ?? session.updatedAt ?? session.createdAt;
  const timestamp = new Date(value).getTime() || 0;
  const latestMessage = session.messages.at(-1);
  return Math.max(timestamp, getMessageTimestamp(latestMessage));
}

function getChiefSessions(state: StoreState): AgentSession[] {
  // When workspaceAgents has tracked agents for the Chief workspace, treat that as
  // the source of truth (soft-deletes remove from workspaceAgents but not from
  // agentSessions, so we must intersect to hide pending-deletion threads).
  const workspaceAgentState = state.workspaceAgents?.byWorkspaceId?.[CHIEF_WORKSPACE_ID];
  const trackedIds = workspaceAgentState?.agentIds;
  const trackedIdSet =
    trackedIds && trackedIds.length > 0 ? new Set(trackedIds.map((id) => String(id))) : null;

  const indexedIds = state.agentSessions?.agentIdsByWorkspace?.[CHIEF_WORKSPACE_ID] ?? [];
  const candidates: AgentSession[] =
    indexedIds.length > 0
      ? indexedIds
          .map((id) => state.agentSessions?.byAgentId?.[id])
          .filter((session): session is AgentSession => Boolean(session))
      : Object.values(state.agentSessions?.byAgentId ?? {}).filter(
          (session): session is AgentSession => session.workspaceId === CHIEF_WORKSPACE_ID,
        );

  if (!trackedIdSet) return candidates;
  return candidates.filter((session) => trackedIdSet.has(String(session.id)));
}

function hasCurrentChiefIdentity(session: AgentSession): boolean {
  return (
    session.metadata?.specialist === CHIEF_SPECIALIST_ID &&
    session.metadata?.chiefPromptVersion === CHIEF_PROMPT_VERSION
  );
}

function getChiefSessionMessageCount(session: AgentSession): number {
  return Math.max(session.messages.length, session.messageCount ?? 0);
}

function toChiefThreadSummary(session: AgentSession): ChiefThreadSummary {
  return {
    agentId: session.id,
    title: getChiefThreadTitle(session),
    isActive:
      session.isStreaming === true ||
      session.isProcessing === true ||
      session.isResponding === true,
    messageCount: getChiefSessionMessageCount(session),
  };
}

// ── Direct state selectors ──
export const selectPanelItem = store.createSelector((state) => state.sidebarNav.panelItem);

export const selectOnboardingActive = store.createSelector(
  (state) => state.sidebarNav.onboardingActive,
);

export const selectShowCreateModal = store.createSelector(
  (state) => state.sidebarNav.showCreateModal,
);

export const selectPinnedWorkspaceIds = store.createSelector(
  (state) => state.sidebarNav.pinnedWorkspaceIds,
);

export const selectMultiSelectSidebarSelectedTabIds = store.createSelector(
  (state, workspaceId: string): string[] =>
    state.sidebarNav.multiSelectSelectedTabIdsByWorkspaceId[workspaceId] ?? ['overview'],
);

export const selectWorkspaceNoteOrder = store.createSelector(
  (state, workspaceId: string): string[] =>
    state.sidebarNav.noteOrderByWorkspaceId[workspaceId] ?? [],
);

export const selectWorkspaceCollapsedNoteIds = store.createSelector(
  (state, workspaceId: string): string[] =>
    state.sidebarNav.collapsedNoteIdsByWorkspaceId[workspaceId] ?? [],
);

export const selectChiefActiveAgentId = store.createSelector(
  (state): string | null => state.sidebarNav.chiefActiveAgentId,
);

export const selectStatsOverlayOpen = store.createSelector(
  (state): boolean => state.sidebarNav.statsOverlayOpen,
);

// ── Derived selectors ──

/** Chief thread history sorted by latest activity. */
export const selectChiefThreads = store.createSelector((state): ChiefThreadSummary[] =>
  getChiefSessions(state)
    .slice()
    .sort((a, b) => getSessionTimestamp(b) - getSessionTimestamp(a))
    .map(toChiefThreadSummary),
);

/** Latest Chief thread created with the current runtime identity contract. */
export const selectCurrentChiefThread = store.createSelector((state): ChiefThreadSummary | null => {
  const current = getChiefSessions(state)
    .filter(hasCurrentChiefIdentity)
    .sort((a, b) => getSessionTimestamp(b) - getSessionTimestamp(a))[0];

  return current ? toChiefThreadSummary(current) : null;
});

/** Latest blank Chief thread created with the current prompt identity contract. */
export const selectReusableChiefThread = store.createSelector(
  (state): ChiefThreadSummary | null => {
    const reusable = getChiefSessions(state)
      .filter(
        (session) =>
          getChiefSessionMessageCount(session) === 0 &&
          !session.lastMessageId &&
          hasCurrentChiefIdentity(session),
      )
      .sort((a, b) => getSessionTimestamp(b) - getSessionTimestamp(a))[0];

    return reusable ? toChiefThreadSummary(reusable) : null;
  },
);
