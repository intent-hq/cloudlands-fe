import { all, call, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  markAgentSeenAtBoundary,
  markAgentSeenOnTurnFinish,
  markAgentSeenOnUserSend,
  newestPersistedMessageId,
} from '$features/agent/mark-agent-seen';
import {
  selectAgentMessages,
  selectAgentSessionHasStreamingTailMessage,
} from '../../agent-session/agent-session-selectors';
import { sendMessage } from '../../chat-state/chat-state-slice';
import {
  agentStreamUpdateReceived,
  type AgentStreamUpdatePayload,
} from '../../workspace-agents/workspace-agents-stream-slice';
import {
  applyPreset,
  clearPanelLayout,
  closeActiveTab,
  closeAllOthersEverywhere,
  closeAllTabs,
  closeOtherTabs,
  closePanel,
  closeTab,
  closeTabsByAgentId,
  closeTabsByType,
  closeTabsToRight,
  createGridLayout,
  goBack,
  goForward,
  initializeLayout,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  openTab,
  openTabInAdjacentOrSplit,
  reconcileStaleAgentTabs,
  reopenClosedTab,
  resetLayout,
} from '../../panel-layout/panel-layout-slice';
import {
  closeAll as closeAllSidebar,
  closeHoverCards,
  closePanel as closeSidebarPanel,
  hydrateSidebarNav,
  openPanel as openSidebarPanel,
  setExpandedItem,
  setHoveredItem,
  togglePanel as toggleSidebarPanel,
} from '../../sidebar-nav/sidebar-nav-slice';
import { clearActiveWorkspace, setActiveWorkspaceId } from '../../workspace/workspace-slice';
import {
  selectDividerBoundarySnapshot,
  type DividerBoundarySnapshot,
} from '../unread-tracking-selectors';
import { endDividerSession, recordWatchedStreamingTail } from '../unread-tracking-slice';

export type DividerSessionBoundary =
  | { kind: 'tab-close'; agentIds: string[] }
  | { kind: 'chief-card-close'; agentIds: string[] }
  | {
      kind: 'workspace-switch';
      agentIds: string[];
      previousWorkspaceId: string | null;
      nextWorkspaceId: string | null;
    };

const TAB_REMOVAL_ACTION_TYPES = new Set([
  initializeLayout.type,
  applyPreset.type,
  createGridLayout.type,
  closeTab.type,
  closeActiveTab.type,
  closeTabsByType.type,
  closeTabsByAgentId.type,
  moveTabToPanel.type,
  moveTabToSplit.type,
  moveTabToSplitLevel.type,
  closeOtherTabs.type,
  closeTabsToRight.type,
  closeAllTabs.type,
  closeAllOthersEverywhere.type,
  closePanel.type,
  resetLayout.type,
  goBack.type,
  goForward.type,
  reconcileStaleAgentTabs.type,
  clearPanelLayout.type,
]);

const BOUNDARY_STATE_ACTIONS = [
  ...TAB_REMOVAL_ACTION_TYPES,
  openTab,
  openTabInAdjacentOrSplit,
  reopenClosedTab,
  setActiveWorkspaceId,
  clearActiveWorkspace,
  setHoveredItem,
  setExpandedItem,
  closeHoverCards,
  openSidebarPanel,
  closeSidebarPanel,
  toggleSidebarPanel,
  closeAllSidebar,
  hydrateSidebarNav,
];

export function detectDividerSessionBoundary(
  previous: DividerBoundarySnapshot,
  current: DividerBoundarySnapshot,
  actionType: string,
): DividerSessionBoundary | null {
  if (actionType === setActiveWorkspaceId.type || actionType === clearActiveWorkspace.type) {
    if (previous.activeWorkspaceId === current.activeWorkspaceId) return null;
    const chiefIds = new Set(current.chiefSessionAgentIds);
    const agentIds = current.dividerSessionAgentIds.filter((id) => !chiefIds.has(id));
    return agentIds.length > 0
      ? {
          kind: 'workspace-switch',
          agentIds,
          previousWorkspaceId: previous.activeWorkspaceId,
          nextWorkspaceId: current.activeWorkspaceId,
        }
      : null;
  }
  if (actionType.startsWith('sidebarNav/')) {
    return previous.chiefCardVisible &&
      !current.chiefCardVisible &&
      current.chiefSessionAgentIds.length > 0
      ? { kind: 'chief-card-close', agentIds: current.chiefSessionAgentIds }
      : null;
  }
  if (!TAB_REMOVAL_ACTION_TYPES.has(actionType)) return null;
  const previouslyOpen = new Set(previous.openAgentTabIds);
  const currentlyOpen = new Set(current.openAgentTabIds);
  const agentIds = current.dividerSessionAgentIds.filter(
    (id) => previouslyOpen.has(id) && !currentlyOpen.has(id),
  );
  return agentIds.length > 0 ? { kind: 'tab-close', agentIds } : null;
}

function* watchDividerBoundaries(): SagaGenerator<void> {
  let previous = yield* selectDividerBoundarySnapshot.effect();
  while (true) {
    const action: { type: string } = yield* take(BOUNDARY_STATE_ACTIONS);
    const current = yield* selectDividerBoundarySnapshot.effect();
    const boundary = detectDividerSessionBoundary(previous, current, action.type);
    if (boundary) {
      yield* call(markAgentSeenAtBoundary, boundary.agentIds);
      for (const agentId of boundary.agentIds) {
        const hasStreamingTailMessage =
          yield* selectAgentSessionHasStreamingTailMessage.effect(agentId);
        if (hasStreamingTailMessage) {
          const messages = yield* selectAgentMessages.effect(agentId);
          const messageId = newestPersistedMessageId(messages);
          if (messageId) yield* put(recordWatchedStreamingTail(agentId, messageId));
        }
        yield* put(endDividerSession(agentId));
      }
      previous = yield* selectDividerBoundarySnapshot.effect();
    } else {
      previous = current;
    }
  }
}

function* handleSend(action: ReturnType<typeof sendMessage>): SagaGenerator<void> {
  if (action.payload.agentId) yield* call(markAgentSeenOnUserSend, action.payload.agentId);
}

function* handleStreamUpdate(
  action: ReturnType<typeof agentStreamUpdateReceived>,
): SagaGenerator<void> {
  const [update] = action.payload as [AgentStreamUpdatePayload];
  if (
    update.eventType === 'complete' ||
    update.eventType === 'error' ||
    update.eventType === 'timeout'
  ) {
    yield* call(markAgentSeenOnTurnFinish, update.agentId);
  }
}

export function* unreadTrackingSaga(): SagaGenerator<void> {
  yield* all([
    call(watchDividerBoundaries),
    takeEvery(sendMessage, handleSend),
    takeEvery(agentStreamUpdateReceived, handleStreamUpdate),
  ]);
}
