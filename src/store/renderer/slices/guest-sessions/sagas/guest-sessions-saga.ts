/**
 * Guest Sessions Saga (multiplayer w4)
 *
 * Owns the guest side of workspace sharing in the renderer:
 * - hydrates the token-free guest session list from main and mirrors every
 *   `guest-sessions:changed` push into the slice;
 * - runs *Leave host* through the main-owned `guest-sessions:leave` IPC and
 *   the per-workspace *Leave* through `guest-sessions:leave-workspace`;
 * - reads the owner-side roster of a hosted workspace (`workspace.members.list`)
 *   and runs *Remove* (`workspace.members.remove`) and *Remove all guests*
 *   (every collaborator removed, every open invite revoked, each step reported
 *   on its own), refetching a loaded roster when the daemon's `memberCount`
 *   for that workspace changes;
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
  LeaveGuestWorkspaceParams,
  LeaveGuestWorkspaceResult,
} from '$shared/types/guest-sessions';
import { selectCurrentConnectionId } from '../../connections/connections-selectors';
import { authRejectedReceived } from '../../connections/connections-slice';
import { selectAllTabs, selectHiddenTabs } from '../../panel-layout/panel-layout-selectors';
import { destroyOwnedTabsForWorkspace } from '../../panel-layout/panel-layout-slice';
import { selectActiveWorkspaceIds } from '../../tab-state/tab-state-selectors';
import { selectWorkspaceById, selectWorkspaceItems } from '../../workspace/workspace-selectors';
import { removeWorkspaceEntity, resetWorkspaceState } from '../../workspace/workspace-slice';
import { workspaceDeleted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  GuestSessionOperationError,
  HostedRosterOperationError,
  type HostedRosterFailureCode,
  type RemoveAllHostedGuestsResult,
  type WorkspaceInviteListResult,
  type WorkspaceInviteRevokeResult,
  type WorkspaceMemberRemoveResult,
  type WorkspaceMembersListResult,
} from '../guest-sessions-types';
import {
  guestSessionsListReceived,
  guestSessionsListUnavailable,
  hostedRosterFailed,
  hostedRosterLoading,
  hostedRosterReceived,
  hostedRosterWithheld,
  hostedSweepReportReceived,
  leaveGuestSessionRequested,
  leaveGuestWorkspaceRequested,
  leaveOperationSettled,
  leaveOperationStarted,
  leaveWorkspaceOperationSettled,
  leaveWorkspaceOperationStarted,
  loadGuestSessionsRequested,
  loadHostedRosterRequested,
  removeAllGuestsOperationSettled,
  removeAllGuestsOperationStarted,
  removeAllHostedGuestsRequested,
  removeHostedMemberRequested,
  removeMemberOperationSettled,
  removeMemberOperationStarted,
} from '../guest-sessions-slice';
import {
  selectCanManageHostedWorkspace,
  selectGuestSessionsLoaded,
  selectHostedRemovingPrincipalIds,
  selectHostedRosterMemberCounts,
  selectHostedRoster,
  selectHostedSweepReport,
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

async function invokeLeaveWorkspace(
  params: LeaveGuestWorkspaceParams,
): Promise<LeaveGuestWorkspaceResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(GUEST_SESSIONS.LEAVE_WORKSPACE, params)) as LeaveGuestWorkspaceResult;
}

function* hydrate(action: ReturnType<typeof loadGuestSessionsRequested>): SagaGenerator<void> {
  let settled = false;
  try {
    const result = yield* call(invokeList);
    yield* put(guestSessionsListReceived(result));
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    // Settle the window's identity on what is known rather than holding the
    // administrator surfaces closed until a list that may never come.
    yield* put(guestSessionsListUnavailable());
    yield* put(action.failure(toGuestSessionFailure(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new GuestSessionOperationError('cancelled')));
  }
}

function* leave(
  flights: Map<string, Array<ReturnType<typeof leaveGuestSessionRequested>>>,
  action: ReturnType<typeof leaveGuestSessionRequested>,
): SagaGenerator<void> {
  const [id] = action.payload;
  const joiners = flights.get(id);
  if (joiners) {
    joiners.push(action);
    return;
  }
  flights.set(id, []);
  let outcome:
    { result: LeaveGuestSessionResult } | { failure: GuestSessionOperationError } | null = null;
  yield* put(leaveOperationStarted(id));
  try {
    const result = yield* call(invokeLeave, { id });
    outcome = { result };
  } catch (error) {
    outcome = { failure: toGuestSessionFailure(error) };
  } finally {
    outcome ??= { failure: new GuestSessionOperationError('cancelled') };
    const joined = [action, ...(flights.get(id) ?? [])];
    flights.delete(id);
    yield* put(leaveOperationSettled(id));
    for (const request of joined) {
      yield* put(
        'result' in outcome ? request.success(outcome.result) : request.failure(outcome.failure),
      );
    }
  }
}

/**
 * Per-workspace *Leave*: main runs `workspace.members.leave` on the host and
 * drops the workspace from the local record; the list refresh arrives via
 * the `guest-sessions:changed` push. A rejected invoke (host unreachable or
 * refused) leaves the record as is for a retry.
 */
function* leaveWorkspace(
  flights: Map<string, Array<ReturnType<typeof leaveGuestWorkspaceRequested>>>,
  action: ReturnType<typeof leaveGuestWorkspaceRequested>,
): SagaGenerator<void> {
  const [id, workspaceId] = action.payload;
  const key = JSON.stringify([id, workspaceId]);
  const joiners = flights.get(key);
  if (joiners) {
    joiners.push(action);
    return;
  }
  flights.set(key, []);
  let outcome:
    { result: LeaveGuestWorkspaceResult } | { failure: GuestSessionOperationError } | null = null;
  yield* put(leaveWorkspaceOperationStarted(id, workspaceId));
  try {
    const result = yield* call(invokeLeaveWorkspace, { id, workspaceId });
    outcome = { result };
  } catch (error) {
    outcome = { failure: toGuestSessionFailure(error) };
  } finally {
    outcome ??= { failure: new GuestSessionOperationError('cancelled') };
    const joined = [action, ...(flights.get(key) ?? [])];
    flights.delete(key);
    yield* put(leaveWorkspaceOperationSettled(id, workspaceId));
    for (const request of joined) {
      yield* put(
        'result' in outcome ? request.success(outcome.result) : request.failure(outcome.failure),
      );
    }
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
 * backend is never clobbered. Single-flight per member: a second *Remove* of
 * a member whose removal is already in flight sends no RPC and is failed
 * `cancelled` (superseded by the in-flight one) without touching that
 * removal's marker, so the marker clears only when the real request settles.
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
  if ((yield* select(selectHostedRemovingPrincipalIds.select, workspaceId)).includes(principalId)) {
    yield* put(action.failure(new HostedRosterOperationError('cancelled')));
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
    yield* put(loadHostedRosterRequested(workspaceId));
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
 * The local owner gate, re-checked between the awaited steps of a sweep: a
 * caller that became a collaborator, a workspace gone from the list, or a
 * roster a concurrent read/remove already withheld (`-32003`) closes the
 * gate, and no further owner RPC may leave for that workspace — the same
 * `forbidden` a daemon denial would answer, so the sweep ends the same way.
 */
function* assertCanManageHostedWorkspace(workspaceId: string): SagaGenerator<void> {
  if (!(yield* select(selectCanManageHostedWorkspace.select, workspaceId)))
    throw new HostedRosterOperationError('forbidden');
}

/**
 * One step of a *Remove all guests* sweep: the failure code, or null on
 * success. Gated on the local owner gate first; a `forbidden` answer is
 * thrown — the caller lost ownership, so the sweep ends and the roster is
 * withheld — everything else is recorded per step and the sweep continues.
 */
function* sweepStep(
  workspaceId: string,
  method: string,
  params: Record<string, unknown>,
): SagaGenerator<HostedRosterFailureCode | null> {
  yield* call(assertCanManageHostedWorkspace, workspaceId);
  try {
    yield* call(
      backendRequest<WorkspaceMemberRemoveResult | WorkspaceInviteRevokeResult>,
      method,
      params,
    );
    return null;
  } catch (error) {
    const failure = toHostedRosterFailure(error);
    if (failure.code === 'forbidden') throw failure;
    return failure.code;
  }
}

/**
 * The sweep itself: a FRESH `workspace.members.list` (never the cached
 * roster, which may lag the daemon), every collaborator removed, then
 * `workspace.invite.list` and every open invite revoked. Each step's outcome
 * is recorded on the result; only a lost ownership aborts — answered by the
 * daemon, or seen locally between two steps (see
 * {@link assertCanManageHostedWorkspace}).
 */
function* sweepHostedGuests(workspaceId: string): SagaGenerator<RemoveAllHostedGuestsResult> {
  const result: RemoveAllHostedGuestsResult = {
    removedPrincipalIds: [],
    failedMembers: [],
    revokedInviteIds: [],
    failedInvites: [],
    invitesUnavailable: null,
  };
  const roster = yield* call(backendRequest<WorkspaceMembersListResult>, 'workspace.members.list', {
    workspaceId,
  });
  for (const member of roster.members) {
    if (member.role === 'owner') continue;
    const code = yield* sweepStep(workspaceId, 'workspace.members.remove', {
      workspaceId,
      principalId: member.principalId,
    });
    if (code === null) result.removedPrincipalIds.push(member.principalId);
    else result.failedMembers.push({ principalId: member.principalId, code });
  }
  yield* call(assertCanManageHostedWorkspace, workspaceId);
  let invites: WorkspaceInviteListResult;
  try {
    invites = yield* call(backendRequest<WorkspaceInviteListResult>, 'workspace.invite.list', {
      workspaceId,
    });
  } catch (error) {
    const failure = toHostedRosterFailure(error);
    if (failure.code === 'forbidden') throw failure;
    result.invitesUnavailable = failure.code;
    return result;
  }
  for (const invite of invites.invites) {
    const code = yield* sweepStep(workspaceId, 'workspace.invite.revoke', {
      workspaceId,
      inviteId: invite.id,
    });
    if (code === null) result.revokedInviteIds.push(invite.id);
    else
      result.failedInvites.push({ inviteId: invite.id, pinLogin: invite.pinLogin ?? null, code });
  }
  return result;
}

type RemoveAllAction = ReturnType<typeof removeAllHostedGuestsRequested>;

/**
 * Sweeps in flight, by workspace: the requests that JOINED the leader's
 * flight (the leader itself is not listed). Owned by the action watcher, so
 * a restart of the saga starts with no flights.
 */
type SweepsInFlight = Map<string, RemoveAllAction[]>;

type SweepOutcome =
  { result: RemoveAllHostedGuestsResult } | { failure: HostedRosterOperationError };

/**
 * *Remove all guests*, single-flight per workspace: while a sweep of a
 * workspace is in flight, a further request for the SAME workspace joins it
 * and settles with the same outcome — a sweep already removes everything, so
 * a second worker could only duplicate its removals/revocations and clear
 * the shared busy marker while the first still runs. Other workspaces are
 * independent. Gated and purge-fenced exactly like a single *Remove* (see
 * {@link removeHostedMember}); the sweep runs the steps one after the other
 * so a daemon never sees a burst, and the roster is refetched once at the
 * end regardless of how many steps failed. Every joined promise resolves
 * with the per-step report; they reject only when the sweep could not run
 * (ownership lost — the roster is withheld —, the fresh roster read failed,
 * or the workspace was purged mid-flight).
 */
function* removeAllHostedGuests(
  inFlight: SweepsInFlight,
  action: RemoveAllAction,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const joiners = inFlight.get(workspaceId);
  if (joiners) {
    joiners.push(action);
    return;
  }
  if (!(yield* select(selectCanManageHostedWorkspace.select, workspaceId))) {
    yield* call(withholdRoster, workspaceId);
    yield* put(action.failure(new HostedRosterOperationError('forbidden')));
    return;
  }
  inFlight.set(workspaceId, []);
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  const roster = yield* selectHostedRoster.effect(workspaceId);
  const previous = yield* selectHostedSweepReport.effect(workspaceId);
  const reportContext = {
    workspaceId,
    workspaceTitle: workspace?.title ?? previous?.workspaceTitle ?? '',
    memberLabels: {
      ...previous?.memberLabels,
      ...Object.fromEntries(
        roster.members.map((member) => [
          member.principalId,
          member.displayName ?? member.login ?? member.principalId,
        ]),
      ),
    },
  };
  let outcome: SweepOutcome | null = null;
  yield* put(removeAllGuestsOperationStarted(workspaceId));
  try {
    const { result } = yield* race({
      result: call(sweepHostedGuests, workspaceId),
      purged: take(isRosterPurge(workspaceId)),
    });
    if (!result) {
      outcome = { failure: new HostedRosterOperationError('cancelled') };
      return;
    }
    yield* put(loadHostedRosterRequested(workspaceId));
    outcome = { result };
  } catch (error) {
    const failure = toHostedRosterFailure(error);
    if (failure.code === 'forbidden') yield* call(withholdRoster, workspaceId);
    outcome = { failure };
  } finally {
    // Cancelled (saga teardown) is the only way out without an outcome.
    outcome ??= { failure: new HostedRosterOperationError('cancelled') };
    if ('result' in outcome) {
      const result = outcome.result;
      if (result.failedMembers.length || result.failedInvites.length || result.invitesUnavailable) {
        yield* put(
          hostedSweepReportReceived({
            ...reportContext,
            failedMemberIds: result.failedMembers.map((member) => member.principalId),
            failedInviteLabels: result.failedInvites.map((invite) => invite.pinLogin ?? ''),
            invitesUnavailable: result.invitesUnavailable !== null,
          }),
        );
      }
    } else if (outcome.failure.code !== 'cancelled' && outcome.failure.code !== 'forbidden') {
      yield* put(
        hostedSweepReportReceived({
          ...reportContext,
          failedMemberIds: [],
          failedInviteLabels: [],
          invitesUnavailable: false,
        }),
      );
    }
    const joined = [action, ...(inFlight.get(workspaceId) ?? [])];
    inFlight.delete(workspaceId);
    for (const request of joined) {
      yield* put(
        'result' in outcome ? request.success(outcome.result) : request.failure(outcome.failure),
      );
    }
    yield* put(removeAllGuestsOperationSettled(workspaceId));
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
    yield* put(loadHostedRosterRequested(workspaceId));
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
  const sweepsInFlight: SweepsInFlight = new Map();
  const leavesInFlight = new Map<string, Array<ReturnType<typeof leaveGuestSessionRequested>>>();
  const workspaceLeavesInFlight = new Map<
    string,
    Array<ReturnType<typeof leaveGuestWorkspaceRequested>>
  >();
  yield* all([
    takeLeading(loadGuestSessionsRequested, hydrate),
    // Repeated leaves join their existing flight; main orders conflicting host mutations.
    takeEvery(leaveGuestSessionRequested, leave, leavesInFlight),
    takeEvery(leaveGuestWorkspaceRequested, leaveWorkspace, workspaceLeavesInFlight),
    call(watchRosterLoads),
    takeEvery(removeHostedMemberRequested, removeHostedMember),
    // takeEvery, keyed single-flight inside: a same-workspace request joins
    // the in-flight sweep; different workspaces sweep concurrently.
    takeEvery(removeAllHostedGuestsRequested, removeAllHostedGuests, sweepsInFlight),
    takeEvery(authRejectedReceived, tearDownOnGuestAuthRejection),
  ]);
}

export function* guestSessionsSaga(): SagaGenerator<void> {
  if (!getApi()) {
    // Outside Electron there is no main to ask and nothing can be joined as a
    // guest: settle the window's identity (`selectWindowIdentitySettled`) as
    // owner instead of leaving it a boot-time unknown forever.
    yield* put(guestSessionsListUnavailable());
    return;
  }

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
  // A failed boot hydration is surfaced through `guestSessionsListUnavailable`.
  try {
    yield* call(hydrate, initial);
    yield* all([join(eventTask), join(actionsTask), join(rosterTask)]);
  } finally {
    events.close();
  }
}
