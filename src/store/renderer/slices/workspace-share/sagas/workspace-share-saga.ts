/**
 * Workspace Share Saga
 *
 * Drives the owner-side sharing RPCs (PROTOCOL §5.1 membership) for the Share
 * dialog: reads `workspace.members.list` + `workspace.invite.list` when the
 * dialog opens, after every local mutation, and on a `workspace:updated`
 * membership delta from any client (`takeLatest` so a retarget cancels the
 * stale read); settles `workspace.invite.create` / `.revoke` /
 * `workspace.members.remove` into slice actions.
 *
 * Every owner-only RPC is gated on `selectShareCanManage` BEFORE it is issued
 * (a collaborator connection never calls `workspace.invite.*` or
 * `workspace.members.remove`), and a daemon `-32003` refusal withholds the
 * dialog the same way. Every settlement carries the `WorkspaceShareTarget` it
 * was issued for so the reducer can drop a reply that outlived its dialog.
 *
 * Secrets: the one-time invite url never enters an action, the store, or a
 * log line — it is parked in `invite-link-vault` and only its handle rides
 * `shareInviteCreated`. Failures are logged as bounded codes only.
 */

import { all, call, put, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import { clearInviteLinks, storeInviteLink } from '$features/workspace-sharing/invite-link-vault';
import {
  workspaceSharingClient,
  type ShareFailure,
} from '$features/workspace-sharing/workspace-sharing.client';
import type { WorkspaceInvite, WorkspaceMember } from '$features/workspace-sharing/types';
import { isForbiddenErrorResponse } from '$lib/client/live/backend-transport-types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  selectShareCanManage,
  selectShareCreateRequest,
  selectShareTarget,
} from '../workspace-share-selectors';
import {
  closeShareDialog,
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
  type WorkspaceShareTarget,
} from '../workspace-share-slice';

const logger = createLogger('WorkspaceShareSaga');

async function readShareData(
  workspaceId: string,
): Promise<{ members: WorkspaceMember[]; invites: WorkspaceInvite[] }> {
  const [members, invites] = await Promise.all([
    workspaceSharingClient.listMembers(workspaceId),
    workspaceSharingClient.listInvites(workspaceId),
  ]);
  return { members, invites };
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
 * must not park its url in the vault or trigger a re-read for the new target).
 */
function* stillTargets(target: WorkspaceShareTarget): SagaGenerator<boolean> {
  const current = yield* selectShareTarget.effect();
  return (
    current !== null &&
    current.workspaceId === target.workspaceId &&
    current.session === target.session
  );
}

function logFailure(what: string, target: WorkspaceShareTarget, failure: ShareFailure): void {
  logger.warn(`${what} failed`, {
    workspaceId: target.workspaceId,
    code: failure.code,
    rpcCode: failure.rpcCode,
  });
}

function* loadShareData(): SagaGenerator<void> {
  const target = yield* manageableTarget();
  if (!target) return;
  try {
    const { members, invites } = yield* call(readShareData, target.workspaceId);
    yield* put(shareDataLoaded({ target, members, invites }));
  } catch (error) {
    if (!(yield* stillTargets(target))) return;
    if (isForbiddenErrorResponse(error)) {
      yield* put(shareAccessWithheld({ target }));
      return;
    }
    logger.warn('Loading sharing details failed', { workspaceId: target.workspaceId });
    yield* put(shareDataFailed({ target, error: m.workspace_share_loadFailed_error() }));
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
    logFailure('Creating an invite', target, outcome);
    yield* put(
      shareInviteCreateFailed({
        target,
        request,
        error:
          outcome.code === 'invite-pin-unknown'
            ? m.workspace_share_pinUnknown_error({ login: `@${requestedPin}` })
            : m.workspace_share_createFailed_error(),
      }),
    );
    return;
  }
  const linkHandle = yield* call(storeInviteLink, outcome.result.url);
  yield* put(
    shareInviteCreated({
      target,
      request,
      link: {
        inviteId: outcome.result.invite.id,
        linkHandle,
        pinLogin: outcome.result.invite.pinLogin,
      },
    }),
  );
  yield* put(shareDataRequested());
}

function* revokeInvite(action: ReturnType<typeof shareInviteRevokeRequested>): SagaGenerator<void> {
  const target = yield* manageableTarget();
  if (!target) return;
  const [inviteId] = action.payload;
  const result = yield* call(workspaceSharingClient.revokeInvite, target.workspaceId, inviteId);
  if (!(yield* stillTargets(target))) return;
  if (!result.success) {
    if (result.code === 'forbidden') {
      yield* put(shareAccessWithheld({ target }));
      return;
    }
    logFailure('Revoking an invite', target, result);
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
  const result = yield* call(workspaceSharingClient.removeMember, target.workspaceId, principalId);
  if (!(yield* stillTargets(target))) return;
  if (!result.success) {
    if (result.code === 'forbidden') {
      yield* put(shareAccessWithheld({ target }));
      return;
    }
    logFailure('Removing a member', target, result);
    yield* put(shareActionSettled({ target, error: m.workspace_share_removeMemberFailed_error() }));
    return;
  }
  yield* put(shareActionSettled({ target, error: null }));
  yield* put(shareDataRequested());
}

function* requestDataOnOpen(): SagaGenerator<void> {
  yield* call(clearInviteLinks);
  yield* put(shareDataRequested());
}

function* clearLinksOnClose(): SagaGenerator<void> {
  yield* call(clearInviteLinks);
}

/** Another client changed the roster/invites of the dialog's workspace: re-read. */
function* refreshOnMembershipChange(
  action: ReturnType<typeof shareMembershipChanged>,
): SagaGenerator<void> {
  const target = yield* selectShareTarget.effect();
  const [{ workspaceId }] = action.payload;
  if (!target || target.workspaceId !== workspaceId) return;
  yield* put(shareDataRequested());
}

export function* workspaceShareSaga(): SagaGenerator<void> {
  yield* all([
    takeEvery(openShareDialog, requestDataOnOpen),
    takeEvery(closeShareDialog, clearLinksOnClose),
    takeEvery(shareMembershipChanged, refreshOnMembershipChange),
    takeLatest(shareDataRequested, loadShareData),
    takeLatest(shareInviteCreateRequested, createInvite),
    takeLatest(shareInviteRevokeRequested, revokeInvite),
    takeLatest(shareMemberRemoveRequested, removeMember),
  ]);
}
