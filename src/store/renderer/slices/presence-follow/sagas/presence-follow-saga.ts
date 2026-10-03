import { eventChannel, buffers, type Task } from 'redux-saga';
import {
  call,
  cancel,
  fork,
  join,
  put,
  race,
  take,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { goto } from '$app/navigation';
import { openWorkspaceTab } from '../../tab-state/tab-state-slice';
import { isViewSelection, workspaceSelectionTypes } from './presence-follow-navigation';
import { isHudWindowRenderer } from '$lib/utils/navigation.client';
import {
  createPresenceFocusChannel,
  type FocusFrame,
  type FocusSubscription,
} from '$features/presence/presence-focus-channel';
import { store } from '../../../store';
import { selectCurrentConnectionId } from '../../connections/connections-selectors';
import { selectPresenceContext } from '../../presence/presence-selectors';
import { hydrateWorkspaceLayout } from '../../panel-layout/sagas/panel-layout-saga';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import { openWorkspaceNote } from '../../workspace-navigation/workspace-navigation-slice';
import {
  PRESENCE_FOLLOW_VISIBLE_LIMIT,
  selectPresenceFollowScope,
  selectPresenceFollowTargets,
} from '../presence-follow-selectors';
import {
  followPresencePersonRequested,
  presenceFollowFrameReceived,
  presenceFollowNavigationFinished,
  presenceFollowRouteStarted,
  presenceFollowScopeChanged,
} from '../presence-follow-slice';

function sameTarget(a: FocusFrame, b: FocusFrame): boolean {
  return (
    !!a.target &&
    !!b.target &&
    a.target.workspaceId === b.target.workspaceId &&
    a.target.agentId === b.target.agentId &&
    a.target.noteId === b.target.noteId
  );
}

function* observePerson(
  scope: string,
  context: string,
  source: string,
  principalId: string,
  sessions: Map<string, FocusSubscription>,
  replaceGroup: string,
): SagaGenerator<void> {
  const backendId = selectCurrentConnectionId.select(store.state);
  let subscription!: FocusSubscription;
  const events = eventChannel<{ frame: FocusFrame | null }>((emit) => {
    subscription = createPresenceFocusChannel(
      source,
      principalId,
      replaceGroup,
      (frame) => emit({ frame }),
      () =>
        selectPresenceContext.select(store.state) === context &&
        selectPresenceFollowScope.select(store.state) === scope,
      () => selectCurrentConnectionId.select(store.state) === backendId,
    );
    return () => subscription.close();
  }, buffers.sliding(32));
  sessions.set(principalId, subscription);
  try {
    yield* fork(function* () {
      yield* call(subscription.refresh);
    });
    while (true) {
      const { frame } = yield* take(events);
      yield* put(presenceFollowFrameReceived(scope, principalId, frame));
    }
  } finally {
    sessions.delete(principalId);
    events.close();
  }
}

/** Fresh snapshots fence every asynchronous stage; a move is an abort, not a
 * redirect to an unexpected third workspace. Subscription choice itself is the
 * daemon's source-first, then workspace/kind/resource ordering, never recency. */
function* followPerson(
  scope: string,
  source: string,
  sessions: Map<string, FocusSubscription>,
  action: ReturnType<typeof followPresencePersonRequested>,
): SagaGenerator<void> {
  const [requestedScope, principalId, generation, seq, requestId, sourcePanelId, adjacent] =
    action.payload;
  try {
    if (requestedScope !== scope || isHudWindowRenderer()) return;
    const session = sessions.get(principalId);
    const expected = selectPresenceFollowTargets.select(store.state, source)[principalId];
    if (!session || !expected || expected.generation !== generation || expected.seq !== seq) return;
    const current = (frame: FocusFrame) => {
      const now = selectPresenceFollowTargets.select(store.state, source)[principalId];
      return (
        store.state.presenceFollow.navigation?.requestId === requestId &&
        !!now &&
        now.generation === frame.generation &&
        now.seq === frame.seq &&
        sameTarget(now, frame)
      );
    };
    const changed = (event: { type: string; payload?: unknown }) =>
      event.type === presenceFollowFrameReceived.type &&
      Array.isArray(event.payload) &&
      event.payload[0] === scope &&
      event.payload[1] === principalId;
    let routing = false;
    let committing = false;
    const superseded = (event: { type: string; payload?: unknown }) => {
      if (committing) return false;
      if (store.state.presenceFollow.navigation?.requestId !== requestId) return true;
      if (workspaceSelectionTypes.has(event.type)) {
        // Only goto's expected route projection may retain the source. A later
        // selection (including away-and-back or reselecting a view) cancels.
        return !(
          routing &&
          event.type === openWorkspaceTab.type &&
          Array.isArray(event.payload) &&
          event.payload[0] === expected.target!.workspaceId
        );
      }
      return isViewSelection(event, source, expected.target!.workspaceId);
    };
    // Arm before any request/load/route can synchronously dispatch navigation.
    // Cancellation is permanent for this click, even if the viewer returns.
    yield* race({
      superseded: take(superseded),
      followed: call(function* (): SagaGenerator<void> {
        const fresh = yield* call(session.refresh);
        if (!fresh || !sameTarget(expected, fresh) || !current(fresh)) return;
        let frame = fresh;
        const target = frame.target;
        if (!target) return;
        if (target.agentId || target.noteId) {
          const loaded = yield* race({
            loaded: call(hydrateWorkspaceLayout, target.workspaceId),
            changed: take(changed),
          });
          if (!('loaded' in loaded) || !current(frame)) return;
        }
        if (store.state.tabState.currentTabId !== target.workspaceId) {
          yield* put(presenceFollowRouteStarted(requestId, target.workspaceId));
          routing = true;
          const navigated = yield* race({
            navigated: call(goto, `/workspace/${encodeURIComponent(target.workspaceId)}`),
            changed: take(changed),
          });
          routing = false;
          if (!('navigated' in navigated) || !current(frame)) return;
        }
        // One final fresh authorization after layout/route awaits; no retry loop.
        const afterLoad = yield* call(session.refresh);
        if (!afterLoad || !sameTarget(frame, afterLoad) || !current(afterLoad)) return;
        frame = afterLoad;
        if (!current(frame)) return;
        committing = true;
        const panel = target.workspaceId === source ? sourcePanelId : undefined;
        if (target.agentId)
          yield* put(
            openAgentTabRequested(target.workspaceId, {
              agentId: target.agentId,
              sourcePanelId: panel,
              openInAdjacentPanel: adjacent ?? false,
            }),
          );
        else if (target.noteId)
          yield* put(
            openWorkspaceNote(target.workspaceId, target.noteId, {
              sourcePanelId: panel,
              openInAdjacentPanel: adjacent ?? false,
            }),
          );
      }),
    });
  } catch {
    // A failed/revoked read is inert. Presence updates never toast.
  } finally {
    yield* put(presenceFollowNavigationFinished(requestId));
  }
}

function* runScope(
  groups: string[],
  { payload: scope }: SelectorChannelPayload<string | null>,
): SagaGenerator<void> {
  const [context, source, principals] = scope
    ? (JSON.parse(scope) as [string, string, string[]])
    : [null, null, []];
  yield* put(presenceFollowScopeChanged(scope, context, source));
  if (!scope || !context || !source) return;
  const sessions = new Map<string, FocusSubscription>();
  const tasks: Task[] = [];
  try {
    for (const [slot, principal] of principals.entries())
      tasks.push(
        yield* fork(observePerson, scope, context, source, principal, sessions, groups[slot]),
      );
    tasks.push(
      yield* takeLatest(followPresencePersonRequested, followPerson, scope, source, sessions),
    );
    yield* join(tasks);
  } finally {
    yield* cancel(tasks);
    yield* put(presenceFollowScopeChanged(null, null, null));
  }
}
export function* presenceFollowSaga(): SagaGenerator<void> {
  // Stable renderer slots bound replacement groups even across backend switches.
  const groups = Array.from(
    { length: PRESENCE_FOLLOW_VISIBLE_LIMIT },
    () => `presence-follow:${crypto.randomUUID()}`,
  );
  yield* takeLatestFromSelector(selectPresenceFollowScope, function* (event) {
    yield* call(runScope, groups, event);
  });
}
