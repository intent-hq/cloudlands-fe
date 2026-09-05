/**
 * Sidebar Nav Selectors
 */

import { store } from '../../store';
import type { StoreState } from '../../types';
import { extractAllContent, type AgentMessage, type AgentSession } from '$shared/types';
import { CHIEF_WORKSPACE_ID, type ChiefThreadPreview } from './sidebar-nav-types';
import { getChiefThreadTitle } from './chief-thread-title';
import { m } from '$shared/paraglide/messages.js';
import {
  CHIEF_PROMPT_V2_INTRODUCED_AT,
  CHIEF_PROMPT_VERSION,
  CHIEF_SPECIALIST_ID,
} from '$shared/chief-agent-config';

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

function getMessagePreview(message: AgentMessage | undefined): string {
  if (!message) return m.layout_sidebarNav_noMessages_label();
  const text = extractAllContent(message).trim();
  if (text) return text;
  if (message.role === 'assistant') return m.layout_sidebarNav_chiefWorking_label();
  return m.layout_sidebarNav_openChief_label();
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
  const createdAt = new Date(session.createdAt).getTime();
  const introducedAt = new Date(CHIEF_PROMPT_V2_INTRODUCED_AT).getTime();
  return (
    session.metadata?.specialist === CHIEF_SPECIALIST_ID &&
    (session.metadata?.chiefPromptVersion === CHIEF_PROMPT_VERSION ||
      (Number.isFinite(createdAt) && createdAt >= introducedAt))
  );
}

function getChiefSessionMessageCount(session: AgentSession): number {
  return Math.max(session.messages.length, session.messageCount ?? 0);
}

function toChiefThreadPreview(session: AgentSession): ChiefThreadPreview {
  const latestMessage = session.messages.at(-1);
  return {
    agentId: session.id,
    title: getChiefThreadTitle(session),
    preview: getMessagePreview(latestMessage),
    updatedAt: latestMessage?.timestamp
      ? new Date(latestMessage.timestamp).toISOString()
      : typeof session.updatedAt === 'string'
        ? session.updatedAt
        : session.updatedAt?.toISOString(),
    isActive:
      session.isStreaming === true ||
      session.isProcessing === true ||
      session.isResponding === true,
    messageCount: getChiefSessionMessageCount(session),
  };
}

// ── Direct state selectors ──
export const selectIsCardPinned = store.createSelector((state) => state.sidebarNav.isCardPinned);

export const selectPanelItem = store.createSelector((state) => state.sidebarNav.panelItem);

export const selectPanelWidth = store.createSelector((state) => state.sidebarNav.panelWidth);

export const selectCombinedPanelSplit = store.createSelector(
  (state) => state.sidebarNav.combinedPanelSplit,
);

export const selectOnboardingActive = store.createSelector(
  (state) => state.sidebarNav.onboardingActive,
);

export const selectDraftPrompt = store.createSelector((state) => state.sidebarNav.draftPrompt);

export const selectAllSpacesViewMode = store.createSelector(
  (state) => state.sidebarNav.allSpacesViewMode,
);

export const selectShowArchivedWorkspaces = store.createSelector(
  (state) => state.sidebarNav.showArchivedWorkspaces,
);

export const selectCollapsedStatusGroupIds = store.createSelector(
  (state) => state.sidebarNav.collapsedStatusGroupIds,
);

export const selectIsChiefCollapsed = store.createSelector(
  (state) => state.sidebarNav.isChiefCollapsed,
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

/** Latest Chief thread preview for the sidebar hover card. */
export const selectChiefThreadPreview = store.createSelector((state): ChiefThreadPreview | null => {
  const latest = getChiefSessions(state)
    .slice()
    .sort((a, b) => getSessionTimestamp(b) - getSessionTimestamp(a))[0];

  return latest ? toChiefThreadPreview(latest) : null;
});

/** Chief thread history sorted by latest activity. */
export const selectChiefThreads = store.createSelector((state): ChiefThreadPreview[] =>
  getChiefSessions(state)
    .slice()
    .sort((a, b) => getSessionTimestamp(b) - getSessionTimestamp(a))
    .map(toChiefThreadPreview),
);

/** Latest Chief thread created with the current runtime identity contract. */
export const selectCurrentChiefThread = store.createSelector((state): ChiefThreadPreview | null => {
  const current = getChiefSessions(state)
    .filter(hasCurrentChiefIdentity)
    .sort((a, b) => getSessionTimestamp(b) - getSessionTimestamp(a))[0];

  return current ? toChiefThreadPreview(current) : null;
});

/** Latest blank Chief thread created with the current prompt identity contract. */
export const selectReusableChiefThread = store.createSelector(
  (state): ChiefThreadPreview | null => {
    const reusable = getChiefSessions(state)
      .filter(
        (session) =>
          getChiefSessionMessageCount(session) === 0 &&
          !session.lastMessageId &&
          hasCurrentChiefIdentity(session),
      )
      .sort((a, b) => getSessionTimestamp(b) - getSessionTimestamp(a))[0];

    return reusable ? toChiefThreadPreview(reusable) : null;
  },
);
