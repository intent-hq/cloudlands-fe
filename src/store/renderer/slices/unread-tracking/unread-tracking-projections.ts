import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { AgentSessionState } from '../agent-session/agent-session-types';
import type { PanelLayoutSliceState } from '../panel-layout/panel-layout-types';
import type { SidebarNavState } from '../sidebar-nav/sidebar-nav-types';
import type {
  DividerBoundaryStateSnapshot,
  DividerSession,
  UnreadTrackingState,
} from './unread-tracking-types';

type UnreadState = { unreadTracking: UnreadTrackingState };
type BoundaryState = UnreadState & {
  panelLayout: PanelLayoutSliceState;
  agentSessions: Pick<AgentSessionState, 'agentIdsByWorkspace'>;
  sidebarNav: Pick<SidebarNavState, 'panelItem'>;
};

/** Non-null with a null anchor means this session must never display a divider. */
export const getDividerSession = (state: UnreadState, agentId: string): DividerSession | null =>
  state.unreadTracking.dividerSessionByAgentId[agentId] ?? null;
export const getCurrentlyViewedAgentId = (state: UnreadState): string | null =>
  state.unreadTracking.currentlyViewedAgentId;
export function getDividerBoundaryStateSnapshot(
  state: BoundaryState,
): DividerBoundaryStateSnapshot {
  const openAgentTabIds: string[] = [];
  for (const workspace of Object.values(state.panelLayout.byWorkspaceId)) {
    for (const panel of Object.values(workspace.panels)) {
      for (const tab of panel.tabs) {
        if (tab.type === 'agent' && tab.agentId) openAgentTabIds.push(tab.agentId);
      }
    }
  }
  const dividerSessionAgentIds = Object.keys(state.unreadTracking.dividerSessionByAgentId);
  const chiefAgentIds = new Set(state.agentSessions.agentIdsByWorkspace[CHIEF_WORKSPACE_ID] ?? []);
  const nav = state.sidebarNav;
  return {
    chiefCardVisible: nav.panelItem === 'chief',
    chiefSessionAgentIds: dividerSessionAgentIds.filter((id) => chiefAgentIds.has(id)),
    dividerSessionAgentIds,
    openAgentTabIds,
  };
}
