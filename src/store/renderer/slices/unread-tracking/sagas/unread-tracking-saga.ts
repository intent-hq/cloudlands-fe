import { all, call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

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

const TAB_REMOVAL_ACTIONS = [
  initializeLayout,
  applyPreset,
  createGridLayout,
  closeTab,
  closeActiveTab,
  closeTabsByType,
  closeTabsByAgentId,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  closeOtherTabs,
  closeTabsToRight,
  closeAllTabs,
  closeAllOthersEverywhere,
  closePanel,
  resetLayout,
  goBack,
  goForward,
  reconcileStaleAgentTabs,
  clearPanelLayout,
];
const TAB_BOUNDARY_ACTIONS = [
  ...TAB_REMOVAL_ACTIONS,
  openTab,
  openTabInAdjacentOrSplit,
  reopenClosedTab,
];
const WORKSPACE_BOUNDARY_ACTIONS = [setActiveWorkspaceId, clearActiveWorkspace];
const CHIEF_BOUNDARY_ACTIONS = [
  setHoveredItem,
  setExpandedItem,
  closeHoverCards,
  openSidebarPanel,
  closeSidebarPanel,
  toggleSidebarPanel,
  closeAllSidebar,
  hydrateSidebarNav,
];
const TAB_REMOVAL_ACTION_TYPES = new Set(TAB_REMOVAL_ACTIONS.map((action) => action.type));

type BoundarySnapshotTracker = { previous: DividerBoundarySnapshot };

function detectWorkspaceBoundary(
  previous: DividerBoundarySnapshot,
  current: DividerBoundarySnapshot,
): DividerSessionBoundary | null {
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

function detectChiefCardBoundary(
  previous: DividerBoundarySnapshot,
  current: DividerBoundarySnapshot,
): DividerSessionBoundary | null {
  return previous.chiefCardVisible &&
    !current.chiefCardVisible &&
    current.chiefSessionAgentIds.length > 0
    ? { kind: 'chief-card-close', agentIds: current.chiefSessionAgentIds }
    : null;
}

function detectTabBoundary(
  previous: DividerBoundarySnapshot,
  current: DividerBoundarySnapshot,
): DividerSessionBoundary | null {
  const previouslyOpen = new Set(previous.openAgentTabIds);
  const currentlyOpen = new Set(current.openAgentTabIds);
  const agentIds = current.dividerSessionAgentIds.filter(
    (id) => previouslyOpen.has(id) && !currentlyOpen.has(id),
  );
  return agentIds.length > 0 ? { kind: 'tab-close', agentIds } : null;
}

export function detectDividerSessionBoundary(
  previous: DividerBoundarySnapshot,
  current: DividerBoundarySnapshot,
  actionType: string,
): DividerSessionBoundary | null {
  if (actionType === setActiveWorkspaceId.type || actionType === clearActiveWorkspace.type) {
    return detectWorkspaceBoundary(previous, current);
  }
  if (actionType.startsWith('sidebarNav/')) {
    return detectChiefCardBoundary(previous, current);
  }
  if (!TAB_REMOVAL_ACTION_TYPES.has(actionType)) return null;
  return detectTabBoundary(previous, current);
}

function* finishBoundary(boundary: DividerSessionBoundary): SagaGenerator<void> {
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
}

function* handleTabBoundary(tracker: BoundarySnapshotTracker): SagaGenerator<void> {
  const current = yield* selectDividerBoundarySnapshot.effect();
  const boundary = detectTabBoundary(tracker.previous, current);
  tracker.previous = current;
  if (boundary) {
    yield* call(finishBoundary, boundary);
    tracker.previous = yield* selectDividerBoundarySnapshot.effect();
  }
}

function* handleWorkspaceBoundary(tracker: BoundarySnapshotTracker): SagaGenerator<void> {
  const current = yield* selectDividerBoundarySnapshot.effect();
  const boundary = detectWorkspaceBoundary(tracker.previous, current);
  tracker.previous = current;
  if (boundary) {
    yield* call(finishBoundary, boundary);
    tracker.previous = yield* selectDividerBoundarySnapshot.effect();
  }
}

function* handleChiefBoundary(tracker: BoundarySnapshotTracker): SagaGenerator<void> {
  const current = yield* selectDividerBoundarySnapshot.effect();
  const boundary = detectChiefCardBoundary(tracker.previous, current);
  tracker.previous = current;
  if (boundary) {
    yield* call(finishBoundary, boundary);
    tracker.previous = yield* selectDividerBoundarySnapshot.effect();
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
  const tracker: BoundarySnapshotTracker = {
    previous: yield* selectDividerBoundarySnapshot.effect(),
  };
  yield* all([
    takeEvery(TAB_BOUNDARY_ACTIONS, handleTabBoundary, tracker),
    takeEvery(WORKSPACE_BOUNDARY_ACTIONS, handleWorkspaceBoundary, tracker),
    takeEvery(CHIEF_BOUNDARY_ACTIONS, handleChiefBoundary, tracker),
    takeEvery(sendMessage, handleSend),
    takeEvery(agentStreamUpdateReceived, handleStreamUpdate),
  ]);
}
