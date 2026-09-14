/**
 * Workspace Share Saga
 *
 * Drives the owner-side sharing RPCs (PROTOCOL §5.1 membership) for the Share
 * dialog: reads `workspace.members.list` + `workspace.invite.list` when the
 * dialog opens (and again after every mutation, `takeLatest` so a retarget
 * cancels the stale read), and settles `workspace.invite.create` /
 * `workspace.invite.revoke` / `workspace.members.remove` into slice actions.
 * Error copy is localized here so the dialog renders strings verbatim.
 */

import { all, call, put, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import { workspaceSharingClient } from '$features/workspace-sharing/workspace-sharing.client';
import type { WorkspaceInvite, WorkspaceMember } from '$features/workspace-sharing/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { selectShareWorkspaceId } from '../workspace-share-selectors';
import {
  openShareDialog,
  shareActionSettled,
  shareDataFailed,
  shareDataLoaded,
  shareDataRequested,
  shareInviteCreated,
  shareInviteCreateFailed,
  shareInviteCreateRequested,
  shareInviteRevokeRequested,
  shareMemberRemoveRequested,
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

function* loadShareData(): SagaGenerator<void> {
  const workspaceId = yield* selectShareWorkspaceId.effect();
  if (!workspaceId) return;
  try {
    const { members, invites } = yield* call(readShareData, workspaceId);
    yield* put(shareDataLoaded({ workspaceId, members, invites }));
  } catch (error) {
    logger.error('Failed to load workspace sharing details', { workspaceId, error });
    yield* put(shareDataFailed({ workspaceId, error: m.workspace_share_loadFailed_error() }));
  }
}

function* createInvite(action: ReturnType<typeof shareInviteCreateRequested>): SagaGenerator<void> {
  const workspaceId = yield* selectShareWorkspaceId.effect();
  if (!workspaceId) return;
  const [{ pinLogin }] = action.payload;
  const requestedPin = pinLogin.trim();
  const outcome = yield* call(workspaceSharingClient.createInvite, workspaceId, {
    pinLogin: requestedPin,
  });
  if (!outcome.success) {
    yield* put(
      shareInviteCreateFailed(
        outcome.code === 'invite-pin-unknown'
          ? m.workspace_share_pinUnknown_error({ login: `@${requestedPin}` })
          : outcome.error || m.workspace_share_createFailed_error(),
      ),
    );
    return;
  }
  yield* put(
    shareInviteCreated({ url: outcome.result.url, pinLogin: outcome.result.invite.pinLogin }),
  );
  yield* put(shareDataRequested());
}

function* revokeInvite(action: ReturnType<typeof shareInviteRevokeRequested>): SagaGenerator<void> {
  const workspaceId = yield* selectShareWorkspaceId.effect();
  if (!workspaceId) return;
  const [inviteId] = action.payload;
  const result = yield* call(workspaceSharingClient.revokeInvite, workspaceId, inviteId);
  if (!result.success) {
    yield* put(shareActionSettled(result.error || m.workspace_share_revokeFailed_error()));
    return;
  }
  yield* put(shareActionSettled(null));
  yield* put(shareDataRequested());
}

function* removeMember(action: ReturnType<typeof shareMemberRemoveRequested>): SagaGenerator<void> {
  const workspaceId = yield* selectShareWorkspaceId.effect();
  if (!workspaceId) return;
  const [principalId] = action.payload;
  const result = yield* call(workspaceSharingClient.removeMember, workspaceId, principalId);
  if (!result.success) {
    yield* put(shareActionSettled(result.error || m.workspace_share_removeMemberFailed_error()));
    return;
  }
  yield* put(shareActionSettled(null));
  yield* put(shareDataRequested());
}

function* requestDataOnOpen(): SagaGenerator<void> {
  yield* put(shareDataRequested());
}

export function* workspaceShareSaga(): SagaGenerator<void> {
  yield* all([
    takeEvery(openShareDialog, requestDataOnOpen),
    takeLatest(shareDataRequested, loadShareData),
    takeLatest(shareInviteCreateRequested, createInvite),
    takeLatest(shareInviteRevokeRequested, revokeInvite),
    takeLatest(shareMemberRemoveRequested, removeMember),
  ]);
}
