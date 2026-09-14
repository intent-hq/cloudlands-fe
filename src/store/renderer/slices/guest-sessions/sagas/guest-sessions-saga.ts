/**
 * Guest Sessions Saga (multiplayer w4)
 *
 * Owns the guest side of workspace sharing in the renderer:
 * - hydrates the token-free guest session list from main and mirrors every
 *   `guest-sessions:changed` push into the slice;
 * - runs *Leave host* through the main-owned `guest-sessions:leave` IPC;
 * - reads the owner-side roster of a hosted workspace (`workspace.members.list`)
 *   and runs *Remove* (`workspace.members.remove`), refetching a loaded roster
 *   when the daemon's `memberCount` for that workspace changes;
 * - tears down every host workspace of a guest window whose credential the
 *   host rejected at the WebSocket upgrade (the guest session itself is kept
 *   for the revoked overlay's *Leave host*).
 */

import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import {
  all,
  call,
  cancel,
  cancelled,
  fork,
  join,
  put,
  race,
  select,
  take,
  takeEvery,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';
import { takeEveryFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';

import { closeWorkspaceTabAndNavigateAway } from '$features/workspace/navigate-away-if-viewing';
import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import {
  isDaemonErrorResponse,
  isForbiddenErrorResponse,
} from '$lib/client/live/backend-transport-types';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import { GUEST_SESSIONS_CHANGED_EVENT } from '$shared/types/guest-sessions';
import type {
  GuestSessionsListResult,
  LeaveGuestSessionParams,
  LeaveGuestSessionResult,
} from '$shared/types/guest-sessions';
import { selectCurrentConnectionId } from '../../connections/connections-selectors';
import { authRejectedReceived } from '../../connections/connections-slice';
import { selectAllTabs, selectHiddenTabs } from '../../panel-layout/panel-layout-selectors';
import { destroyOwnedTabsForWorkspace } from '../../panel-layout/panel-layout-slice';
import { selectActiveWorkspaceIds } from '../../tab-state/tab-state-selectors';
import { selectWorkspaceItems } from '../../workspace/workspace-selectors';
import { removeWorkspaceEntity, resetWorkspaceState } from '../../workspace/workspace-slice';
import { workspaceDeleted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  GuestSessionOperationError,
  HostedRosterOperationError,
  type WorkspaceMemberRemoveResult,
  type WorkspaceMembersListResult,
} from '../guest-sessions-types';
import {
  guestSessionsListReceived,
  hostedRosterFailed,
  hostedRosterLoading,
  hostedRosterReceived,
  hostedRosterWithheld,
  leaveGuestSessionRequested,
  leaveOperationSettled,
  leaveOperationStarted,
  loadGuestSessionsRequested,
  loadHostedRosterRequested,
  removeHostedMemberRequested,
  removeMemberOperationSettled,
  removeMemberOperationStarted,
} from '../guest-sessions-slice';
import {
  selectCanManageHostedWorkspace,
  selectGuestSessionsLoaded,
  selectHostedRosterMemberCounts,
  selectIsHostedWorkspaceListed,
  selectWindowGuestSession,
} from '../guest-sessions-selectors';

const logger = createLogger('GuestSessionsSaga');

const GUEST_SESSIONS = IPC_CHANNELS.GUEST_SESSIONS;

function getApi(): Window['electronAPI'] | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

/**
 * Fold a main IPC failure to its bounded code before it reaches a promise
 * consumer (main's rejection message may echo host material).
 */
function toGuestSessionFailure(error: unknown): GuestSessionOperationError {
  return error instanceof GuestSessionOperationError
    ? error
    : new GuestSessionOperationError('ipc');
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
    yield* put(action.failure(toGuestSessionFailure(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new GuestSessionOperationError('cancelled')));
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
    yield* put(action.failure(toGuestSessionFailure(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new GuestSessionOperationError('cancelled')));
    yield* put(leaveOperationSettled(id));
  }
}

/**
 * Fold a roster read / *Remove* failure to its bounded code before it reaches
 * Redux, a promise consumer or a log line (raw daemon/transport messages may
 * echo host material).
 */
function toHostedRosterFailure(error: unknown): HostedRosterOperationError {
  if (error instanceof HostedRosterOperationError) return error;
  if (isForbiddenErrorResponse(error)) return new HostedRosterOperationError('forbidden');
  if (isDaemonErrorResponse(error)) return new HostedRosterOperationError('daemon');
  return new HostedRosterOperationError('transport');
}

type RosterLoadAction = ReturnType<typeof loadHostedRosterRequested>;
type RosterPurgeAction =
  ReturnType<typeof workspaceDeleted> | ReturnType<typeof removeWorkspaceEntity>;
type RosterWatchAction = RosterLoadAction | RosterPurgeAction;

/**
 * The actions that purge a workspace's roster entry (the reducer drops it):
 * the workspace left this window, or the window's whole list was reset. An
 * owner operation in flight for that workspace is fenced on them — its late
 * settlement must neither refetch nor re-install a `withheld` entry.
 */
function isRosterPurge(workspaceId: string): (action: { type: string }) => boolean {
  return (action) =>
    action.type === resetWorkspaceState.type ||
    ((action.type === workspaceDeleted.type || action.type === removeWorkspaceEntity.type) &&
      (action as RosterPurgeAction).payload[0] === workspaceId);
}

/**
 * Withhold a workspace's roster (terminal). Only a workspace still in this
 * window's list gets the entry: a workspace already purged has nothing to
 * render into, and re-installing its entry would resurrect it.
 */
function* withholdRoster(workspaceId: string): SagaGenerator<void> {
  if (yield* select(selectIsHostedWorkspaceListed.select, workspaceId))
    yield* put(hostedRosterWithheld(workspaceId));
}

/**
 * Roster requests awaiting a read, per workspace: the leading request plus
 * every one that arrived while its read was in flight — all settled by the
 * ONE trailing read that follows.
 */
type CoalescedRosterRequests = Map<string, RosterLoadAction[]>;

type RosterOutcome =
  { result: WorkspaceMembersListResult } | { failure: HostedRosterOperationError };

function settleRosterRequests(
  requests: RosterLoadAction[],
  outcome: RosterOutcome,
): Array<ReturnType<RosterLoadAction['success']> | ReturnType<RosterLoadAction['failure']>> {
  return requests.map((request) =>
    'result' in outcome ? request.success(outcome.result) : request.failure(outcome.failure),
  );
}

/**
 * One `workspace.members.list` round trip for a workspace, settling every
 * request that shares it. Gated on the caller still managing the workspace —
 * before the RPC (a collaborator / a workspace gone from the list / a roster
 * already withheld never sends an owner RPC) AND after it (the result of a
 * read that outlived the caller's ownership, or that a concurrent *Remove*
 * denial withheld meanwhile, is stale and withheld, never rendered). The
 * daemon's `-32003 Forbidden` is the same terminal `withheld` answer.
 */
function* readHostedRosterOnce(
  workspaceId: string,
  requests: RosterLoadAction[],
): SagaGenerator<void> {
  if (!(yield* select(selectCanManageHostedWorkspace.select, workspaceId))) {
    yield* call(withholdRoster, workspaceId);
    for (const settled of settleRosterRequests(requests, {
      failure: new HostedRosterOperationError('forbidden'),
    }))
      yield* put(settled);
    return;
  }
  yield* put(hostedRosterLoading(workspaceId));
  let outcome: RosterOutcome;
  try {
    const result = yield* call(
      backendRequest<WorkspaceMembersListResult>,
      'workspace.members.list',
      { workspaceId },
    );
    if (yield* select(selectCanManageHostedWorkspace.select, workspaceId)) {
      yield* put(hostedRosterReceived(workspaceId, result.members));
      outcome = { result };
    } else {
      yield* call(withholdRoster, workspaceId);
      outcome = { failure: new HostedRosterOperationError('forbidden') };
    }
  } catch (error) {
    const failure = toHostedRosterFailure(error);
    if (failure.code === 'forbidden') yield* call(withholdRoster, workspaceId);
    else yield* put(hostedRosterFailed(workspaceId));
    outcome = { failure };
  }
  for (const settled of settleRosterRequests(requests, outcome)) yield* put(settled);
}

/**
 * Context of the single-flight roster watcher: a load request runs in its
 * workspace's context (queued for the next read of that workspace); a
 * workspace leaving this window (deleted, entity removed) cancels that
 * context so a late result cannot repopulate the purged entry (the reducer
 * drops the entry itself).
 */
function rosterContext(
  coalesced: CoalescedRosterRequests,
  action: RosterWatchAction,
): string | { context: string; cancel: true } {
  const [workspaceId] = action.payload;
  if (action.type !== loadHostedRosterRequested.type) return { context: workspaceId, cancel: true };
  const pending = coalesced.get(workspaceId) ?? [];
  pending.push(action as RosterLoadAction);
  coalesced.set(workspaceId, pending);
  return workspaceId;
}

/**
 * One turn of a workspace's roster loader: reads once for every request
 * queued so far. The watcher runs the leading request immediately and reruns
 * this at most ONCE for the requests that arrived mid-flight (N triggers → 1
 * follow-up RPC, not N). When the context is cancelled by a purge, the
 * in-flight and queued requests are failed `cancelled`.
 */
function* readCoalescedRoster(
  coalesced: CoalescedRosterRequests,
  action: RosterWatchAction,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  let batch = coalesced.get(workspaceId)?.splice(0) ?? [];
  try {
    if (batch.length > 0) yield* call(readHostedRosterOnce, workspaceId, batch);
    batch = [];
  } finally {
    if (yield* cancelled()) {
      const pending = [...batch, ...(coalesced.get(workspaceId)?.splice(0) ?? [])];
      for (const settled of settleRosterRequests(pending, {
        failure: new HostedRosterOperationError('cancelled'),
      }))
        yield* put(settled);
    }
    if (!coalesced.get(workspaceId)?.length) coalesced.delete(workspaceId);
  }
}

/**
 * Roster loads, single-flight with trailing coalesce per workspace. A reset
 * of the workspace list (the window's backend changed) restarts the watcher,
 * cancelling every in-flight read the same way a purge does.
 */
function* watchRosterLoads(): SagaGenerator<void> {
  const coalesced: CoalescedRosterRequests = new Map();
  while (true) {
    const watcher = yield* takeSingleFlightInContext(
      [loadHostedRosterRequested, workspaceDeleted, removeWorkspaceEntity],
      (action: RosterWatchAction) => rosterContext(coalesced, action),
      readCoalescedRoster,
      coalesced,
    );
    yield* take(resetWorkspaceState);
    yield* cancel(watcher);
  }
}

/**
 * One *Remove*. Gated like the read (a collaborator, a workspace gone from
 * the list or an already withheld roster never sends the owner RPC) and
 * fenced on the workspace's purge: a *Remove* whose workspace left this
 * window (or whose whole list was reset) mid-flight is failed `cancelled` —
 * its late success does not refetch, its late `-32003` does not withhold, so
 * a purged entry is never re-installed and a same-id workspace of the next
 * backend is never clobbered.
 */
function* removeHostedMember(
  action: ReturnType<typeof removeHostedMemberRequested>,
): SagaGenerator<void> {
  const [workspaceId, principalId] = action.payload;
  let settled = false;
  if (!(yield* select(selectCanManageHostedWorkspace.select, workspaceId))) {
    yield* call(withholdRoster, workspaceId);
    yield* put(action.failure(new HostedRosterOperationError('forbidden')));
    return;
  }
  yield* put(removeMemberOperationStarted(workspaceId, principalId));
  try {
    const { result } = yield* race({
      result: call(backendRequest<WorkspaceMemberRemoveResult>, 'workspace.members.remove', {
        workspaceId,
        principalId,
      }),
      purged: take(isRosterPurge(workspaceId)),
    });
    if (!result) {
      yield* put(action.failure(new HostedRosterOperationError('cancelled')));
      settled = true;
      return;
    }
    // The daemon's `workspace:updated` delta bumps `memberCount`, which
    // refetches the roster; a direct refetch keeps the list right even when
    // the count is unchanged (e.g. the member was already gone).
    const refetch = loadHostedRosterRequested(workspaceId);
    refetch.promise.catch(() => {});
    yield* put(refetch);
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    const failure = toHostedRosterFailure(error);
    if (failure.code === 'forbidden') yield* call(withholdRoster, workspaceId);
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new HostedRosterOperationError('cancelled')));
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

/** Agent ids indexed under a workspace — resolved BEFORE the purge drops them. */
function readWorkspaceAgentIds(
  state: { agentSessions?: { agentIdsByWorkspace: Record<string, string[]> } },
  workspaceId: string,
): string[] {
  return state.agentSessions?.agentIdsByWorkspace[workspaceId] ?? [];
}

/**
 * Owner agent ids of the agent-owned browser tabs (visible and hidden) in a
 * workspace layout — resolved BEFORE the purge drops the layout, so main's
 * CDP/ownership registrations can be cleared like the bridge's delete /
 * unshare paths do (monorepo#2857).
 */
function* readOwnedTabAgentIds(workspaceId: string): SagaGenerator<Set<string>> {
  const visible = yield* select(selectAllTabs.select, workspaceId);
  const hidden = yield* select(selectHiddenTabs.select, workspaceId);
  const ownerAgentIds = new Set<string>();
  for (const tab of [...visible, ...hidden]) {
    if (tab.type === 'browser' && typeof tab.ownerAgentId === 'string') {
      ownerAgentIds.add(tab.ownerAgentId);
    }
  }
  return ownerAgentIds;
}

/** Best-effort main-side cleanup; the failure log carries ids only. */
function* clearMainTabRegistrations(workspaceId: string, agentId: string): SagaGenerator<void> {
  try {
    yield* call(invoke, IPC_CHANNELS.BROWSER.CLEAR_AGENT_TABS, { agentId });
  } catch {
    logger.warn('Failed to clear main-process registrations for rejected host workspace tabs', {
      workspaceId,
      agentId,
    });
  }
}

/**
 * The host rejected this window's guest credential at the WebSocket upgrade
 * (`connections:auth-rejected`, live or replayed on boot through the
 * connections list): the guest has no access to anything on that host any
 * more, so every host workspace is torn down like a delete — Redux state,
 * agent-owned browser tabs, the workspace tab (on screen or in the
 * background) — leaving the empty state under the revoked overlay. The guest
 * session record is NOT touched: the overlay needs its metadata for *Leave
 * host*. A rejection for another backend (a paired device in an owner window)
 * or for a window whose backend is not a joined host is not ours.
 */
function* tearDownOnGuestAuthRejection(
  action: ReturnType<typeof authRejectedReceived>,
): SagaGenerator<void> {
  const [event] = action.payload;
  const windowBackendId = yield* select(selectCurrentConnectionId.select);
  if (event.id !== windowBackendId) return;
  // Boot replay can land before the guest list hydrates: decide on the
  // authoritative list, not its absence.
  if (!(yield* select(selectGuestSessionsLoaded.select))) yield* take(guestSessionsListReceived);
  const session = yield* select(selectWindowGuestSession.select);
  if (!session || session.id !== event.id) return;

  const workspaceIds = new Set<string>([
    ...(yield* select(selectWorkspaceItems.select)).map((ws) => ws.id as string),
    // Persisted tabs may outlive the list (the list read itself fails once
    // the upgrade is rejected).
    ...(yield* select(selectActiveWorkspaceIds.select)),
  ]);
  const cleanups: Array<[workspaceId: string, agentId: string]> = [];
  for (const workspaceId of workspaceIds) {
    const agentIds = yield* select(readWorkspaceAgentIds, workspaceId);
    for (const agentId of yield* readOwnedTabAgentIds(workspaceId)) {
      cleanups.push([workspaceId, agentId]);
    }
    yield* put(destroyOwnedTabsForWorkspace(workspaceId));
    yield* put(workspaceDeleted(workspaceId, [...agentIds]));
    try {
      yield* call(closeWorkspaceTabAndNavigateAway, workspaceId);
    } catch (error) {
      logger.warn(`Failed to close workspace tab ${workspaceId} after host rejected guest`, error);
    }
  }
  // Main's tombstone/ownership/CDP cleanup for every owner captured above,
  // after the renderer purge so a slow main never delays the teardown.
  yield* all(
    cleanups.map(([workspaceId, agentId]) => call(clearMainTabRegistrations, workspaceId, agentId)),
  );
}

function* watchActions(): SagaGenerator<void> {
  yield* all([
    takeLeading(loadGuestSessionsRequested, hydrate),
    // takeEvery: each leave targets one host id and main serializes the work.
    takeEvery(leaveGuestSessionRequested, leave),
    call(watchRosterLoads),
    takeEvery(removeHostedMemberRequested, removeHostedMember),
    takeEvery(authRejectedReceived, tearDownOnGuestAuthRejection),
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
