/**
 * Guest Sessions Saga (multiplayer w4)
 *
 * Owns the guest side of workspace sharing in the renderer:
 * - hydrates the token-free guest session list from main and mirrors every
 *   `guest-sessions:changed` push into the slice;
 * - runs *Leave host* through the main-owned `guest-sessions:leave` IPC;
 * - reads the owner-side roster of a hosted workspace (`workspace.members.list`)
 *   and runs *Remove* (`workspace.members.remove`), refetching a loaded roster
 *   when the daemon's `memberCount` for that workspace changes.
 */

import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import {
  all,
  call,
  cancelled,
  fork,
  join,
  put,
  take,
  takeEvery,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';
import { takeEveryFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';

import { backendRequest } from '$lib/client/live/backend-transport';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { GUEST_SESSIONS_CHANGED_EVENT } from '$shared/types/guest-sessions';
import type {
  GuestSessionsListResult,
  LeaveGuestSessionParams,
  LeaveGuestSessionResult,
} from '$shared/types/guest-sessions';
import type {
  WorkspaceMemberRemoveResult,
  WorkspaceMembersListResult,
} from '../guest-sessions-types';
import {
  guestSessionsListReceived,
  hostedRosterFailed,
  hostedRosterLoading,
  hostedRosterReceived,
  leaveGuestSessionRequested,
  leaveOperationSettled,
  leaveOperationStarted,
  loadGuestSessionsRequested,
  loadHostedRosterRequested,
  removeHostedMemberRequested,
  removeMemberOperationSettled,
  removeMemberOperationStarted,
} from '../guest-sessions-slice';
import { selectHostedRosterMemberCounts } from '../guest-sessions-selectors';

const GUEST_SESSIONS = IPC_CHANNELS.GUEST_SESSIONS;

function getApi(): Window['electronAPI'] | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createChangedChannel(): EventChannel<GuestSessionsListResult> {
  return eventChannel<GuestSessionsListResult>((emit) => {
    const api = getApi();
    if (!api?.on) return () => {};
    const listenerId = api.on(GUEST_SESSIONS_CHANGED_EVENT, (payload: GuestSessionsListResult) =>
      emit(payload),
    );
    return () => api.offById(GUEST_SESSIONS_CHANGED_EVENT, listenerId);
  }, buffers.expanding<GuestSessionsListResult>());
}

async function invokeList(): Promise<GuestSessionsListResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(GUEST_SESSIONS.LIST)) as GuestSessionsListResult;
}

async function invokeLeave(params: LeaveGuestSessionParams): Promise<LeaveGuestSessionResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(GUEST_SESSIONS.LEAVE, params)) as LeaveGuestSessionResult;
}

function* hydrate(action: ReturnType<typeof loadGuestSessionsRequested>): SagaGenerator<void> {
  let settled = false;
  try {
    const result = yield* call(invokeList);
    yield* put(guestSessionsListReceived(result));
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Guest sessions hydration was cancelled')));
  }
}

function* leave(action: ReturnType<typeof leaveGuestSessionRequested>): SagaGenerator<void> {
  const [id] = action.payload;
  let settled = false;
  yield* put(leaveOperationStarted(id));
  try {
    const result = yield* call(invokeLeave, { id });
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Leave host was cancelled')));
    yield* put(leaveOperationSettled(id));
  }
}

function* loadHostedRoster(
  action: ReturnType<typeof loadHostedRosterRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  let settled = false;
  yield* put(hostedRosterLoading(workspaceId));
  try {
    const result = yield* call(
      backendRequest<WorkspaceMembersListResult>,
      'workspace.members.list',
      { workspaceId },
    );
    yield* put(hostedRosterReceived(workspaceId, result.members));
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    yield* put(hostedRosterFailed(workspaceId));
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(hostedRosterFailed(workspaceId));
      yield* put(action.failure(new Error('Roster load was cancelled')));
    }
  }
}

function* removeHostedMember(
  action: ReturnType<typeof removeHostedMemberRequested>,
): SagaGenerator<void> {
  const [workspaceId, principalId] = action.payload;
  let settled = false;
  yield* put(removeMemberOperationStarted(workspaceId, principalId));
  try {
    const result = yield* call(
      backendRequest<WorkspaceMemberRemoveResult>,
      'workspace.members.remove',
      { workspaceId, principalId },
    );
    // The daemon's `workspace:updated` delta bumps `memberCount`, which
    // refetches the roster; a direct refetch keeps the list right even when
    // the count is unchanged (e.g. the member was already gone).
    yield* put(loadHostedRosterRequested(workspaceId));
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Member removal was cancelled')));
    yield* put(removeMemberOperationSettled(workspaceId, principalId));
  }
}

/**
 * Refetch a loaded roster when the daemon's `memberCount` for its workspace
 * moves (membership deltas arrive through the workspace list, not a
 * roster-specific event). Only a workspace already tracked with a different
 * count refetches: a roster's first read adds its entry and must not fetch
 * twice. `seen` (the saga's own last-handled entries) is advanced before any
 * `put`, so a re-entrant emission during the dispatch cannot double-fetch.
 */
function* refetchRostersOnMemberCountChange(
  seen: Map<string, string>,
  change: SelectorChannelPayload<string[]>,
): SagaGenerator<void> {
  const stale: string[] = [];
  const current = new Set<string>();
  for (const entry of change.payload) {
    const [workspaceId] = splitEntry(entry);
    current.add(workspaceId);
    const before = seen.get(workspaceId);
    seen.set(workspaceId, entry);
    if (before !== undefined && before !== entry) stale.push(workspaceId);
  }
  for (const workspaceId of [...seen.keys()]) {
    if (!current.has(workspaceId)) seen.delete(workspaceId);
  }
  for (const workspaceId of stale) {
    const request = loadHostedRosterRequested(workspaceId);
    request.promise.catch(() => {});
    yield* put(request);
  }
}

function splitEntry(entry: string): [workspaceId: string, count: string] {
  const at = entry.lastIndexOf(':');
  return [entry.slice(0, at), entry.slice(at + 1)];
}

function* consumeChangedEvents(
  channel: EventChannel<GuestSessionsListResult>,
): SagaGenerator<void> {
  try {
    while (true) {
      const event = yield* take(channel);
      if (event === (END as unknown as GuestSessionsListResult)) return;
      yield* put(guestSessionsListReceived(event));
    }
  } finally {
    channel.close();
  }
}

function* watchActions(): SagaGenerator<void> {
  yield* all([
    takeLeading(loadGuestSessionsRequested, hydrate),
    // takeEvery: each leave targets one host id and main serializes the work.
    takeEvery(leaveGuestSessionRequested, leave),
    takeEvery(loadHostedRosterRequested, loadHostedRoster),
    takeEvery(removeHostedMemberRequested, removeHostedMember),
  ]);
}

export function* guestSessionsSaga(): SagaGenerator<void> {
  if (!getApi()) return;

  const events = createChangedChannel();
  const eventTask = yield* fork(consumeChangedEvents, events);
  const actionsTask = yield* fork(watchActions);
  const seen = new Map<string, string>();
  const rosterTask = yield* takeEveryFromSelector(
    selectHostedRosterMemberCounts,
    function* (change) {
      yield* refetchRostersOnMemberCountChange(seen, change);
    },
  );
  const initial = loadGuestSessionsRequested();
  try {
    yield* call(hydrate, initial);
    yield* all([join(eventTask), join(actionsTask), join(rosterTask)]);
  } finally {
    events.close();
  }
}
