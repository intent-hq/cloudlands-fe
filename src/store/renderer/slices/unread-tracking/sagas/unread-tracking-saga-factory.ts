import { takeEveryFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { all, call, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

import {
  newestPersistedMessageId,
  type createMarkAgentSeen,
} from '../../../../../features/agent/mark-agent-seen-factory';
import type { AgentMessage } from '$shared/types';
import type { StoreSelectorEffect } from '@themislib/themis/types';
import type { SelectorChannelSelector } from '@themislib/themis/saga';
import type {
  DividerBoundarySnapshot,
  DividerBoundaryStateSnapshot,
} from '../unread-tracking-types';
import { replaceMessages } from '../../agent-session/agent-session-slice';
import { sendMessage, chatTranscriptSnapshotApplied } from '../../chat-state/chat-state-slice';
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
  closePanel as closeSidebarPanel,
  hydrateSidebarNav,
  openPanel as openSidebarPanel,
} from '../../sidebar-nav/sidebar-nav-slice';
import {
  clearCurrentlyViewedAgent,
  endDividerSession,
  markAgentAsViewed,
  recordWatchedStreamingTail,
} from '../unread-tracking-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';

import {
  detectTabBoundary,
  detectWorkspaceBoundary,
  detectChiefCardBoundary,
  type DividerSessionBoundary,
} from '../unread-tracking-boundaries';
const TAB_BOUNDARY_ACTIONS = [
  ...TAB_REMOVAL_ACTIONS,
  openTab,
  openTabInAdjacentOrSplit,
  reopenClosedPanelColumn,
  reopenClosedTab,
];
const CHIEF_BOUNDARY_ACTIONS = [openSidebarPanel, closeSidebarPanel, hydrateSidebarNav];
type BoundarySnapshotTracker = {
  previous: DividerBoundarySnapshot;
  hasWorkspaceContext: boolean;
};

type EffectSelector<Result, Args extends unknown[] = []> = {
  effect: StoreSelectorEffect<Result, Args>;
};
export type UnreadTrackingDependencies<State> = {
  selectCurrentWorkspaceTabId: SelectorChannelSelector<string | null, [], State> &
    EffectSelector<string | null>;
  selectCurrentlyViewedAgentId: EffectSelector<string | null>;
  selectDividerBoundaryStateSnapshot: EffectSelector<DividerBoundaryStateSnapshot>;
  selectAgentMessages: EffectSelector<AgentMessage[], [agentId: string]>;
  selectAgentSessionHasStreamingTailMessage: EffectSelector<boolean, [agentId: string]>;
  marker: Pick<
    ReturnType<typeof createMarkAgentSeen>,
    | 'markAgentSeenAtBoundary'
    | 'markAgentSeenOnTranscriptHydrated'
    | 'markAgentSeenOnTurnFinish'
    | 'markAgentSeenOnUserSend'
    | 'markAgentSeenOnView'
    | 'releaseViewAwaitingTranscript'
  >;
  clearCachedChatScroll: (agentIds: readonly string[]) => void;
  /** Optional lifetime cleanup; source facade retains its existing default lifetime. */
  dispose?: () => void;
};

export function createUnreadTrackingSaga<State>({
  selectCurrentWorkspaceTabId,
  selectCurrentlyViewedAgentId,
  selectDividerBoundaryStateSnapshot,
  selectAgentMessages,
  selectAgentSessionHasStreamingTailMessage,
  clearCachedChatScroll,
  dispose,
  marker: {
    markAgentSeenAtBoundary,
    markAgentSeenOnTranscriptHydrated,
    markAgentSeenOnTurnFinish,
    markAgentSeenOnUserSend,
    markAgentSeenOnView,
    releaseViewAwaitingTranscript,
  },
}: UnreadTrackingDependencies<State>) {
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
      tracker.previous = yield* call(
        readDividerBoundarySnapshot,
        tracker.previous.activeWorkspaceId,
      );
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
      tracker.previous = yield* call(
        readDividerBoundarySnapshot,
        tracker.previous.activeWorkspaceId,
      );
    }
  }

  function* handleChiefUnmount(
    tracker: BoundarySnapshotTracker,
    { payload: [workspaceId] }: ReturnType<typeof workspaceUnmounted>,
  ): SagaGenerator<void> {
    if (workspaceId !== CHIEF_WORKSPACE_ID) return;
    const current = yield* call(readDividerBoundarySnapshot, tracker.previous.activeWorkspaceId);
    if (current.chiefSessionAgentIds.length === 0) return;
    const boundary: DividerSessionBoundary = {
      kind: 'chief-card-close',
      agentIds: current.chiefSessionAgentIds,
    };
    yield* call(finishBoundary, boundary);
    tracker.previous = yield* call(readDividerBoundarySnapshot, tracker.previous.activeWorkspaceId);
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

  /**
   * The viewing session ended with nothing on screen (drawer closed / tab
   * switched away): release the late-transcript re-arm so a starved view fire
   * cannot linger. A scoped clear that the reducer ignored (another agent is
   * viewed by now) leaves the new view's re-arm alone.
   */
  function* handleViewCleared(): SagaGenerator<void> {
    const viewedAgentId = yield* selectCurrentlyViewedAgentId.effect();
    if (viewedAgentId === null) yield* call(releaseViewAwaitingTranscript);
  }

  /**
   * Late-transcript re-arm: the seq-0 snapshot lands in `agentSessions` through
   * `replaceMessages` after `markAgentAsViewed`, and on a remote daemon after
   * the view debounce too — so a view fire that found no transcript would
   * otherwise never retry. Only the agent still on screen is re-fired; the
   * trigger itself no-ops unless a view fire was starved. (The hydration settle
   * signal is owned by the switch-timing saga and is not watched here.)
   */
  function* handleTranscriptHydrated(
    action: ReturnType<typeof replaceMessages> | ReturnType<typeof chatTranscriptSnapshotApplied>,
  ): SagaGenerator<void> {
    const [agentId] = action.payload;
    const viewedAgentId = yield* selectCurrentlyViewedAgentId.effect();
    if (agentId && agentId === viewedAgentId)
      yield* call(markAgentSeenOnTranscriptHydrated, agentId);
  }

  return function* unreadTrackingSaga(): SagaGenerator<void> {
    const initialWorkspaceId = yield* selectCurrentWorkspaceTabId.effect();
    const tracker: BoundarySnapshotTracker = {
      previous: yield* call(readDividerBoundarySnapshot, initialWorkspaceId),
      hasWorkspaceContext: initialWorkspaceId !== null,
    };
    try {
      yield* all([
        takeEvery(TAB_BOUNDARY_ACTIONS, handleTabBoundary, tracker),
        call(watchWorkspaceBoundaries, tracker),
        takeEvery(CHIEF_BOUNDARY_ACTIONS, handleChiefBoundary, tracker),
        takeEvery(workspaceUnmounted, handleChiefUnmount, tracker),
        takeEvery(sendMessage, handleSend),
        takeEvery(agentStreamUpdateReceived, handleStreamUpdate),
        takeEvery(markAgentAsViewed, handleViewed),
        takeEvery(clearCurrentlyViewedAgent, handleViewCleared),
        takeEvery([replaceMessages, chatTranscriptSnapshotApplied], handleTranscriptHydrated),
      ]);
      if (dispose) yield* take([]);
    } finally {
      if (dispose) yield* call(dispose);
    }
  };
}
