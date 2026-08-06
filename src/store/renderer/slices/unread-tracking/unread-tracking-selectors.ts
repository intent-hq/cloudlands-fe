/**
 * Selectors for the unread-tracking Redux slice.
 */

import { store } from '../../store';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { DividerSession } from './unread-tracking-types';

export type DividerBoundarySnapshot = {
  activeWorkspaceId: string | null;
  chiefCardVisible: boolean;
  chiefSessionAgentIds: string[];
  dividerSessionAgentIds: string[];
  openAgentTabIds: string[];
};

/**
 * The latched "New messages" divider viewing session for an agent, or `null`
 * when no viewing session has started yet. A non-null `{ anchorId: null }`
 * means the session started with no divider (none may appear this session).
 */
export const selectDividerSession = store.createSelector<[agentId: string], DividerSession | null>(
  (state, agentId) => {
    return state.unreadTracking.dividerSessionByAgentId[agentId] ?? null;
  },
);
/** Agent currently viewed by the chat area, or null when no chat is active. */
export const selectCurrentlyViewedAgentId = store.createSelector(
  (state): string | null => state.unreadTracking.currentlyViewedAgentId,
);

export const selectDividerBoundarySnapshot = store.createSelector(
  (state): DividerBoundarySnapshot => {
    const openAgentTabIds: string[] = [];
    for (const workspace of Object.values(state.panelLayout.byWorkspaceId)) {
      for (const panel of Object.values(workspace.panels)) {
        for (const tab of panel.tabs) {
          if (tab.type === 'agent' && tab.agentId) openAgentTabIds.push(tab.agentId);
        }
      }
    }
    const dividerSessionAgentIds = Object.keys(state.unreadTracking.dividerSessionByAgentId);
    const chiefAgentIds = new Set(
      state.agentSessions.agentIdsByWorkspace[CHIEF_WORKSPACE_ID] ?? [],
    );
    const nav = state.sidebarNav;
    return {
      activeWorkspaceId: state.workspace.activeWorkspaceId,
      chiefCardVisible:
        nav.panelItem === 'chief' || (nav.expandedItem ?? nav.hoveredItem) === 'chief',
      chiefSessionAgentIds: dividerSessionAgentIds.filter((id) => chiefAgentIds.has(id)),
      dividerSessionAgentIds,
      openAgentTabIds,
    };
  },
);
