/**
 * Workspace Share Saga
 *
 * Drives the owner-side sharing RPCs (PROTOCOL §5.1 membership) for the Share
 * dialog: reads `workspace.members.list` + `workspace.invite.list` when the
 * dialog opens, after every local mutation, and on a `workspace:updated`
 * membership delta from any client; settles `workspace.invite.create` /
 * `.revoke` / `workspace.members.remove` into slice actions. The workspace
 * hover card's roster (`workspace.members.list` per hovered workspace, plus
 * its Remove) rides the same saga, keyed by workspace id.
 *
 * Reads are single-flight with a trailing coalesce (per dialog, per hovered
 * workspace): requests that arrive while a read is in flight collapse into
 * exactly one follow-up read once it settles — a burst of N membership events
 * costs at most 2 reads, never N+1. (`takeLatest` would cancel the generator
 * but not the RPC already on the wire.)
 *
 * Every owner-only RPC is gated on the owner role BEFORE it is issued (a
 * collaborator connection never calls `workspace.invite.*` or
 * `workspace.members.remove`), and a daemon `-32003` refusal withholds the
 * dialog / the hover controls the same way. Every dialog settlement carries
 * the `WorkspaceShareTarget` it was issued for and every roster settlement its
 * workspace id, so the reducer can drop a reply that outlived its surface.
 *
 * Invite links ride the store as ordinary state (`invite.url` on every open
 * row, `createdLink.url` for the panel); failures are logged as bounded codes
 * only, never the daemon message.
 */

import { all, call, put, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import {
  workspaceSharingClient,
  type ShareFailure,
} from '$features/workspace-sharing/workspace-sharing.client';
import type { WorkspaceInvite, WorkspaceMembersList } from '$features/workspace-sharing/types';
import { isForbiddenErrorResponse } from '$lib/client/live/backend-transport-types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  selectShareCanManage,
  selectShareCreateRequest,
  selectShareMutationGeneration,
  selectShareRemovingPrincipalId,
  selectShareRevokingInviteId,
  selectShareTarget,
  selectWorkspaceRosterCanManage,
  selectWorkspaceRosterRemovingPrincipalId,
  selectWorkspaceRosterTracked,
} from '../workspace-share-selectors';
import {
  openShareDialog,
  shareAccessWithheld,
  shareActionSettled,
  shareDataFailed,
  shareDataLoaded,
  shareDataRequested,
  shareInviteCreated,
  shareInviteCreateFailed,
  shareInviteCreateRequested,
  shareInviteRevokeRequested,
  shareMemberRemoveRequested,
  shareMembershipChanged,
  shareRosterActionSettled,
  shareRosterFailed,
  shareRosterLoaded,
  shareRosterMemberRemoveRequested,
  shareRosterRequested,
  shareRosterWithheld,
  type WorkspaceShareTarget,
} from '../workspace-share-slice';

const logger = createLogger('WorkspaceShareSaga');

/**
 * Single-flight per key with a trailing coalesce: the first request for a key
 * runs `worker(key)`; requests for the same key that arrive mid-flight mark it
 * dirty and return, and the running flight re-runs the worker once afterwards.
 * Pair with `takeEvery` so every request is observed.
 */
function coalescedByKey<A>(
  keyOf: (action: A) => string,
  worker: (key: string) => SagaGenerator<void>,
): (action: A) => SagaGenerator<void> {
  const flights = new Map<string, { again: boolean }>();
  return function* (action) {
    const key = keyOf(action);
    const flight = flights.get(key);
    if (flight) {
      flight.again = true;
      return;
    }
    const mine = { again: true };
    flights.set(key, mine);
    try {
      while (mine.again) {
        mine.again = false;
        yield* call(worker, key);
      }
    } finally {
      flights.delete(key);
    }
  };
}

/**
 * Both reads are issued together. `result` rejects the moment either read is
 * refused with `-32003` (a terminal denial must withhold immediately, not
 * once the sibling RPC times out) and otherwise settles once both have;
 * `settled` resolves only when both have, so the caller can keep the
 * `coalescedByKey` guard held and no second concurrent read starts while a
 * sibling RPC is still outstanding.
 */
function readShareData(workspaceId: string): {
  result: Promise<WorkspaceMembersList & { invites: WorkspaceInvite[] }>;
  settled: Promise<void>;
} {
  const reads = [
    workspaceSharingClient.listMembers(workspaceId),
    workspaceSharingClient.listInvites(workspaceId),
  ] as const;
  const outcomes = Promise.allSettled(reads);
  const result = new Promise<WorkspaceMembersList & { invites: WorkspaceInvite[] }>(
    (resolve, reject) => {
      for (const read of reads) {
        read.catch((error: unknown) => {
          if (isForbiddenErrorResponse(error)) reject(error);
        });
      }
      void outcomes.then(([members, invites]) => {
        if (members.status === 'fulfilled' && invites.status === 'fulfilled') {
          resolve({ ...members.value, invites: invites.value });
          return;
        }
        const reasons = [members, invites].flatMap((outcome) =>
          outcome.status === 'rejected' ? [outcome.reason as unknown] : [],
        );
        reject(reasons.find(isForbiddenErrorResponse) ?? reasons[0]);
      });
    },
  );
  return { result, settled: outcomes.then(() => undefined) };
}

/** The open dialog's target, or `null` (withheld) when the caller may not manage it. */
function* manageableTarget(): SagaGenerator<WorkspaceShareTarget | null> {
  const target = yield* selectShareTarget.effect();
  if (!target) return null;
  if (yield* selectShareCanManage.effect()) return target;
  yield* put(shareAccessWithheld({ target }));
  return null;
}

/**
 * False once the dialog closed or retargeted while an RPC was in flight: the
 * reply is dropped here (the reducer would drop it too, but a stale create
 * must not trigger a re-read for the new target).
 */
function* stillTargets(target: WorkspaceShareTarget): SagaGenerator<boolean> {
  const current = yield* selectShareTarget.effect();
  return (
    current !== null &&
    current.workspaceId === target.workspaceId &&
    current.session === target.session
  );
}

function logFailure(what: string, workspaceId: string, failure: ShareFailure): void {
  logger.warn(`${what} failed`, { workspaceId, code: failure.code, rpcCode: failure.rpcCode });
}

function* loadShareData(): SagaGenerator<void> {
  const target = yield* manageableTarget();
  if (!target) return;
  const generation = yield* selectShareMutationGeneration.effect();
  const read = readShareData(target.workspaceId);
  try {
    const { members, invites, guestCount, guestLimit } = yield* call(() => read.result);
    yield* put(shareDataLoaded({ target, generation, members, invites, guestCount, guestLimit }));
  } catch (error) {
    if (yield* stillTargets(target)) {
      if (isForbiddenErrorResponse(error)) {
        yield* put(shareAccessWithheld({ target }));
      } else {
        logger.warn('Loading sharing details failed', { workspaceId: target.workspaceId });
        yield* put(shareDataFailed({ target, error: m.workspace_share_loadFailed_error() }));
      }
    }
  }
  // Hold the flight until the sibling read settles too, so a burst still coalesces.
  yield* call(() => read.settled);
}

/**
 * Inline error for a failed `workspace.invite.create`: the pin failure names
 * the login; `listener-down` (Remote access off, so the daemon cannot serve
 * an invite) tells the owner what to turn on; `guest-limit` (the cap was
 * spent between the dialog's read and the create) names the cap; anything
 * else stays generic.
 */
function createInviteErrorMessage(code: ShareFailure['code'], requestedPin: string): string {
  switch (code) {
    case 'invite-pin-unknown':
      return m.workspace_share_pinUnknown_error({ login: `@${requestedPin}` });
    case 'listener-down':
      return m.workspace_share_listenerDown_error();
    case 'guest-limit':
      return m.workspace_share_guestLimit_error();
    default:
      return m.workspace_share_createFailed_error();
  }
}

function* createInvite(action: ReturnType<typeof shareInviteCreateRequested>): SagaGenerator<void> {
  const target = yield* manageableTarget();
  if (!target) return;
  const request = yield* selectShareCreateRequest.effect();
  const [{ pinLogin }] = action.payload;
  const requestedPin = pinLogin.trim();
  const outcome = yield* call(workspaceSharingClient.createInvite, target.workspaceId, {
    pinLogin: requestedPin,
  });
  if (!(yield* stillTargets(target))) return;
  if (!outcome.success) {
    if (outcome.code === 'forbidden') {
      yield* put(shareAccessWithheld({ target }));
      return;
    }
    logFailure('Creating an invite', target.workspaceId, outcome);
    yield* put(
      shareInviteCreateFailed({
        target,
        request,
        error: createInviteErrorMessage(outcome.code, requestedPin),
      }),
    );
    return;
  }
  yield* put(
    shareInviteCreated({
      target,
      request,
      link: {
        inviteId: outcome.result.invite.id,
        url: outcome.result.url,
        pinLogin: outcome.result.invite.pinLogin,
      },
    }),
  );
  yield* put(shareDataRequested());
}

/**
 * The reducer admits one dialog mutation at a time (`revokingInviteId` /
 * `removingPrincipalId`): a request it declined is never issued, so a rapid
 * or stale second click cannot reach the daemon with a target the UI never
 * showed as in flight.
 */
function* revokeInvite(action: ReturnType<typeof shareInviteRevokeRequested>): SagaGenerator<void> {
  const target = yield* manageableTarget();
  if (!target) return;
  const [inviteId] = action.payload;
  if ((yield* selectShareRevokingInviteId.effect()) !== inviteId) return;
  const result = yield* call(workspaceSharingClient.revokeInvite, target.workspaceId, inviteId);
  if (!(yield* stillTargets(target))) return;
  if (!result.success) {
    if (result.code === 'forbidden') {
      yield* put(shareAccessWithheld({ target }));
      return;
    }
    logFailure('Revoking an invite', target.workspaceId, result);
    yield* put(shareActionSettled({ target, error: m.workspace_share_revokeFailed_error() }));
    return;
  }
  yield* put(shareActionSettled({ target, error: null, revokedInviteId: inviteId }));
  yield* put(shareDataRequested());
}

function* removeMember(action: ReturnType<typeof shareMemberRemoveRequested>): SagaGenerator<void> {
  const target = yield* manageableTarget();
  if (!target) return;
  const [principalId] = action.payload;
  if ((yield* selectShareRemovingPrincipalId.effect()) !== principalId) return;
  const result = yield* call(workspaceSharingClient.removeMember, target.workspaceId, principalId);
  if (!(yield* stillTargets(target))) return;
  if (!result.success) {
    if (result.code === 'forbidden') {
      yield* put(shareAccessWithheld({ target }));
      return;
    }
    logFailure('Removing a member', target.workspaceId, result);
    yield* put(shareActionSettled({ target, error: m.workspace_share_removeMemberFailed_error() }));
    return;
  }
  yield* put(shareActionSettled({ target, error: null }));
  yield* put(shareDataRequested());
}

function* requestDataOnOpen(): SagaGenerator<void> {
  yield* put(shareDataRequested());
}

/** Hover card: `workspace.members.list` for one workspace (Member+ may read). */
function* loadRoster(workspaceId: string): SagaGenerator<void> {
  try {
    const { members } = yield* call(workspaceSharingClient.listMembers, workspaceId);
    yield* put(shareRosterLoaded({ workspaceId, members }));
  } catch (error) {
    if (isForbiddenErrorResponse(error)) {
      yield* put(shareRosterWithheld({ workspaceId }));
      return;
    }
    logger.warn('Loading the hover-card roster failed', { workspaceId });
    yield* put(shareRosterFailed({ workspaceId }));
  }
}

/** Hover card: remove a collaborator; the card already confirmed the intent. */
function* removeRosterMember(
  action: ReturnType<typeof shareRosterMemberRemoveRequested>,
): SagaGenerator<void> {
  const [{ workspaceId, principalId }] = action.payload;
  if (!(yield* selectWorkspaceRosterCanManage.effect(workspaceId))) {
    yield* put(shareRosterWithheld({ workspaceId }));
    return;
  }
  // The reducer admits one removal at a time; a request it declined is not issued.
  if ((yield* selectWorkspaceRosterRemovingPrincipalId.effect(workspaceId)) !== principalId) return;
  const result = yield* call(workspaceSharingClient.removeMember, workspaceId, principalId);
  if (!result.success) {
    if (result.code === 'forbidden') {
      yield* put(shareRosterWithheld({ workspaceId }));
      return;
    }
    logFailure('Removing a member', workspaceId, result);
    yield* put(
      shareRosterActionSettled({
        workspaceId,
        error: m.workspace_share_removeMemberFailed_error(),
      }),
    );
    return;
  }
  yield* put(shareRosterActionSettled({ workspaceId, error: null }));
  yield* put(shareRosterRequested({ workspaceId }));
}

/**
 * Another client changed the roster/invites of a workspace: re-read the
 * dialog when it targets that workspace, and the hover roster when tracked.
 */
function* refreshOnMembershipChange(
  action: ReturnType<typeof shareMembershipChanged>,
): SagaGenerator<void> {
  const [{ workspaceId }] = action.payload;
  const target = yield* selectShareTarget.effect();
  if (target && target.workspaceId === workspaceId) yield* put(shareDataRequested());
  if (yield* selectWorkspaceRosterTracked.effect(workspaceId)) {
    yield* put(shareRosterRequested({ workspaceId }));
  }
}

export function* workspaceShareSaga(): SagaGenerator<void> {
  yield* all([
    takeEvery(openShareDialog, requestDataOnOpen),
    takeEvery(shareMembershipChanged, refreshOnMembershipChange),
    takeEvery(
      shareDataRequested,
      coalescedByKey(() => 'dialog', loadShareData),
    ),
    takeEvery(
      shareRosterRequested,
      coalescedByKey(
        (action: ReturnType<typeof shareRosterRequested>) => action.payload[0].workspaceId,
        loadRoster,
      ),
    ),
    takeEvery(shareRosterMemberRemoveRequested, removeRosterMember),
    takeLatest(shareInviteCreateRequested, createInvite),
    // `takeEvery`: a declined second request must not cancel the admitted
    // worker mid-RPC (the reducer, not the watcher, serializes these).
    takeEvery(shareInviteRevokeRequested, revokeInvite),
    takeEvery(shareMemberRemoveRequested, removeMember),
  ]);
}
