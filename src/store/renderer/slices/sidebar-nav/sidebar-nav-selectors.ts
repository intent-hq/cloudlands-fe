/**
 * Sidebar Nav Selectors
 */

import { store } from "../../store";
import type { StoreState } from "../../types";
import { extractAllContent, type AgentMessage, type AgentSession } from "$shared/types";
import {
  CHIEF_WORKSPACE_ID,
  type ChiefThreadPreview,
  type SidebarNavItem,
} from "./sidebar-nav-types";

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
  if (!message) return "No messages yet.";
  const text = extractAllContent(message).trim();
  if (text) return text;
  if (message.role === "assistant") return "Chief is working on a response.";
  return "Open Chief to continue the conversation.";
}

function getThreadTitle(session: AgentSession): string {
  const firstUserMessage = session.messages.find((message) => message.role === "user");
  const firstMessage = firstUserMessage ?? session.messages[0];
  const text = firstMessage ? extractAllContent(firstMessage).trim() : "";
  return text || session.name || "Chief of Staff";
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

function toChiefThreadPreview(session: AgentSession): ChiefThreadPreview {
  const latestMessage = session.messages.at(-1);
  return {
    agentId: session.id,
    title: getThreadTitle(session),
    preview: getMessagePreview(latestMessage),
    updatedAt: latestMessage?.timestamp
      ? new Date(latestMessage.timestamp).toISOString()
      : typeof session.updatedAt === "string"
        ? session.updatedAt
        : session.updatedAt?.toISOString(),
    isActive:
      session.isStreaming === true ||
      session.isProcessing === true ||
      session.isResponding === true,
    messageCount: session.messages.length,
  };
}

// ── Direct state selectors ──
export const selectActiveStreamsVersion = store.createSelector(
  (state) => state.sidebarNav.activeStreamsVersion,
);

export const selectExpandedItem = store.createSelector(
  (state) => state.sidebarNav.expandedItem,
);

export const selectIsCardPinned = store.createSelector(
  (state) => state.sidebarNav.isCardPinned,
);

export const selectPanelItem = store.createSelector(
  (state) => state.sidebarNav.panelItem,
);

export const selectPanelWidth = store.createSelector(
  (state) => state.sidebarNav.panelWidth,
);

export const selectOnboardingActive = store.createSelector(
  (state) => state.sidebarNav.onboardingActive,
);

export const selectShowCreateModal = store.createSelector(
  (state) => state.sidebarNav.showCreateModal,
);

export const selectDraftPrompt = store.createSelector(
  (state) => state.sidebarNav.draftPrompt,
);

export const selectAllSpacesViewMode = store.createSelector(
  (state) => state.sidebarNav.allSpacesViewMode,
);

export const selectPinnedWorkspaceIds = store.createSelector(
  (state) => state.sidebarNav.pinnedWorkspaceIds,
);

export const selectMultiSelectSidebarTabOrder = store.createSelector(
  (state): string[] => state.sidebarNav.multiSelectTabOrder,
);

export const selectMultiSelectSidebarSelectedTabIds = store.createSelector(
  (state, workspaceId: string): string[] =>
    state.sidebarNav.multiSelectSelectedTabIdsByWorkspaceId[workspaceId] ?? ["overview"],
);

export const selectWorkspaceNoteOrder = store.createSelector(
  (state, workspaceId: string): string[] => state.sidebarNav.noteOrderByWorkspaceId[workspaceId] ?? [],
);

export const selectWorkspaceCollapsedNoteIds = store.createSelector(
  (state, workspaceId: string): string[] => state.sidebarNav.collapsedNoteIdsByWorkspaceId[workspaceId] ?? [],
);

export const selectChiefActiveAgentId = store.createSelector(
  (state): string | null => state.sidebarNav.chiefActiveAgentId,
);

// ── Derived selectors ──

/** The active visible card (either hovered or expanded) */
export const selectActiveCard = store.createSelector(
  (state): SidebarNavItem | null => {
    const { expandedItem, hoveredItem } = state.sidebarNav;
    return expandedItem ?? hoveredItem;
  },
);

/** Whether any context menu is open (prevents hover card auto-close) */
export const selectContextMenuOpen = store.createSelector(
  (state) => state.sidebarNav.contextMenuOpenCount > 0,
);

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

