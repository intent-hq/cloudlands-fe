import { takeEveryFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { all, call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  markAgentSeenAtBoundary,
  markAgentSeenOnTurnFinish,
  markAgentSeenOnUserSend,
  markAgentSeenOnView,
  newestPersistedMessageId,
} from '$features/agent/mark-agent-seen';
import { clearCachedChatScroll } from '$lib/components/chat/chat-scroll-cache';
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
  openTab,
  openTabInAdjacentOrSplit,
  reopenClosedPanelColumn,
  reopenClosedTab,
} from '../../panel-layout/panel-layout-slice';
import { TAB_REMOVAL_ACTIONS } from '../../panel-layout/panel-layout-action-utils';
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
import {
  selectDividerBoundaryStateSnapshot,
  type DividerBoundarySnapshot,
} from '../unread-tracking-selectors';
import {
  endDividerSession,
  markAgentAsViewed,
  recordWatchedStreamingTail,
} from '../unread-tracking-slice';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';

export type DividerSessionBoundary =
  | { kind: 'tab-close'; agentIds: string[] }
  | { kind: 'chief-card-close'; agentIds: string[] }
  | {
      kind: 'workspace-switch';
      agentIds: string[];
      previousWorkspaceId: string | null;
      nextWorkspaceId: string | null;
    };

const TAB_BOUNDARY_ACTIONS = [
  ...TAB_REMOVAL_ACTIONS,
  openTab,
  openTabInAdjacentOrSplit,
  reopenClosedPanelColumn,
  reopenClosedTab,
];
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

type BoundarySnapshotTracker = {
  previous: DividerBoundarySnapshot;
  hasWorkspaceContext: boolean;
};

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
  if (previous.activeWorkspaceId !== current.activeWorkspaceId) {
    return detectWorkspaceBoundary(previous, current);
  }
  if (actionType.startsWith('sidebarNav/')) {
    return detectChiefCardBoundary(previous, current);
  }
  if (!TAB_REMOVAL_ACTION_TYPES.has(actionType)) return null;
  return detectTabBoundary(previous, current);
}

function* readDividerBoundarySnapshot(
  activeWorkspaceId: string | null,
): SagaGenerator<DividerBoundarySnapshot> {
  const stateSnapshot = yield* selectDividerBoundaryStateSnapshot.effect();
  return { ...stateSnapshot, activeWorkspaceId };
}

function* finishBoundary(boundary: DividerSessionBoundary): SagaGenerator<void> {
  yield* call(markAgentSeenAtBoundary, boundary.agentIds);
  // Leaving the agent (workspace switch / tab close) ends the reading
  // session: drop the cached transcript scroll so the next entry lands at
  // the bottom or the unread divider, never a stale clamped position.
  // Chief-card close keeps its cache — the hover card is not a workspace
  // surface remount. Ordering contract: markAgentSeenAtBoundary is
  // synchronous fire-and-forget, so this clear runs in the boundary
  // dispatch tick, BEFORE Svelte's microtask teardown flush destroys the
  // departing ChatPanel. That panel cannot repopulate the entries cleared
  // here because its destroy-time cache write is suppressed state-side:
  // endDividerSession (dispatched below, in this same tick) ends the
  // agent's divider session, and canRecordChatScroll refuses to record
  // once the session has ended.
  if (boundary.kind !== 'chief-card-close') {
    yield* call(clearCachedChatScroll, boundary.agentIds);
  }
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
  const current = yield* call(readDividerBoundarySnapshot, tracker.previous.activeWorkspaceId);
  const boundary = detectTabBoundary(tracker.previous, current);
  tracker.previous = current;
  if (boundary) {
    yield* call(finishBoundary, boundary);
    tracker.previous = yield* call(readDividerBoundarySnapshot, tracker.previous.activeWorkspaceId);
  }
}

function* handleWorkspaceBoundary(
  tracker: BoundarySnapshotTracker,
  { payload: activeWorkspaceId }: SelectorChannelPayload<string | null>,
): SagaGenerator<void> {
  const current = yield* call(readDividerBoundarySnapshot, activeWorkspaceId);
  if (!tracker.hasWorkspaceContext) {
    tracker.hasWorkspaceContext = true;
    tracker.previous = current;
    return;
  }
  const boundary = detectWorkspaceBoundary(tracker.previous, current);
  tracker.previous = current;
  if (boundary) {
    yield* call(finishBoundary, boundary);
    tracker.previous = yield* call(readDividerBoundarySnapshot, activeWorkspaceId);
  }
}

function* watchWorkspaceBoundaries(tracker: BoundarySnapshotTracker): SagaGenerator<void> {
  yield* takeEveryFromSelector(selectCurrentWorkspaceTabId, function* (change) {
    yield* handleWorkspaceBoundary(tracker, change);
  });
}

function* handleChiefBoundary(tracker: BoundarySnapshotTracker): SagaGenerator<void> {
  const current = yield* call(readDividerBoundarySnapshot, tracker.previous.activeWorkspaceId);
  const boundary = detectChiefCardBoundary(tracker.previous, current);
  tracker.previous = current;
  if (boundary) {
    yield* call(finishBoundary, boundary);
    tracker.previous = yield* call(readDividerBoundarySnapshot, tracker.previous.activeWorkspaceId);
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

/**
 * View trigger: opening an already-finished conversation must clear that
 * agent's unread — no terminal stream event will arrive for it. The trigger
 * gates itself (viewed + focused + assistant tail) at fire time.
 */
function* handleViewed(action: ReturnType<typeof markAgentAsViewed>): SagaGenerator<void> {
  const [agentId] = action.payload;
  if (agentId) yield* call(markAgentSeenOnView, agentId);
}

export function* unreadTrackingSaga(): SagaGenerator<void> {
  const initialWorkspaceId = yield* selectCurrentWorkspaceTabId.effect();
  const tracker: BoundarySnapshotTracker = {
    previous: yield* call(readDividerBoundarySnapshot, initialWorkspaceId),
    hasWorkspaceContext: initialWorkspaceId !== null,
  };
  yield* all([
    takeEvery(TAB_BOUNDARY_ACTIONS, handleTabBoundary, tracker),
    call(watchWorkspaceBoundaries, tracker),
    takeEvery(CHIEF_BOUNDARY_ACTIONS, handleChiefBoundary, tracker),
    takeEvery(sendMessage, handleSend),
    takeEvery(agentStreamUpdateReceived, handleStreamUpdate),
    takeEvery(markAgentAsViewed, handleViewed),
  ]);
}
