/**
 * Workspace Share Slice
 *
 * State for the owner-side Share dialog (multiplayer w4). The dialog is
 * global — one host in the app layout serves every entry point (sidebar
 * header kebab, tab context menu) — so the target workspace, the member
 * roster, the open invites, and every in-flight mutation ride in the store.
 * The saga performs the sharing RPCs and settles the `*Loaded` / `*Failed`
 * actions; the dialog only renders this state and dispatches intent.
 */

import {
  createCollection,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { WorkspaceInvite, WorkspaceMember } from '$features/workspace-sharing/types';

export interface WorkspaceShareCreatedLink {
  url: string;
  pinLogin?: string;
}

export interface WorkspaceShareState {
  open: boolean;
  workspaceId: string | null;
  workspaceTitle: string;
  /** Roster in daemon order (owner first). */
  members: Collection<WorkspaceMember, 'principalId'>;
  /** Open invites in daemon order. */
  invites: Collection<WorkspaceInvite, 'id'>;
  loadStatus: 'idle' | 'loading' | 'loaded' | 'error';
  loadError: string | null;
  creating: boolean;
  createError: string | null;
  createdLink: WorkspaceShareCreatedLink | null;
  revokingInviteId: string | null;
  removingPrincipalId: string | null;
  actionError: string | null;
}

export const initialState: WorkspaceShareState = {
  open: false,
  workspaceId: null,
  workspaceTitle: '',
  members: createCollection<WorkspaceMember, 'principalId'>('principalId'),
  invites: createCollection<WorkspaceInvite, 'id'>('id'),
  loadStatus: 'idle',
  loadError: null,
  creating: false,
  createError: null,
  createdLink: null,
  revokingInviteId: null,
  removingPrincipalId: null,
  actionError: null,
};

/** Open the Share dialog for a workspace; the saga loads the roster + invites. */
export const openShareDialog = createAction<
  [payload: { workspaceId: string; workspaceTitle: string }]
>('workspaceShare/openDialog');

/** Close the Share dialog and drop every loaded row. */
export const closeShareDialog = createAction('workspaceShare/closeDialog');

/** Saga: re-read the roster + open invites for the dialog's workspace. */
export const shareDataRequested = createAction('workspaceShare/dataRequested');

/** Saga: roster + invites arrived for `workspaceId` (ignored if the dialog moved on). */
export const shareDataLoaded = createAction<
  [payload: { workspaceId: string; members: WorkspaceMember[]; invites: WorkspaceInvite[] }]
>('workspaceShare/dataLoaded');

/** Saga: the roster/invite read failed. */
export const shareDataFailed = createAction<[payload: { workspaceId: string; error: string }]>(
  'workspaceShare/dataFailed',
);

/** Mint an invite link; `pinLogin` (trimmed, may be empty) restricts redemption. */
export const shareInviteCreateRequested = createAction<[payload: { pinLogin: string }]>(
  'workspaceShare/inviteCreateRequested',
);

/** Saga: the invite was created; `url` is shown once. */
export const shareInviteCreated = createAction<[link: WorkspaceShareCreatedLink]>(
  'workspaceShare/inviteCreated',
);

/** Saga: invite creation failed (already localized). */
export const shareInviteCreateFailed = createAction<[error: string]>(
  'workspaceShare/inviteCreateFailed',
);

/** Revoke an open invite. */
export const shareInviteRevokeRequested = createAction<[inviteId: string]>(
  'workspaceShare/inviteRevokeRequested',
);

/** Remove a collaborator from the roster. */
export const shareMemberRemoveRequested = createAction<[principalId: string]>(
  'workspaceShare/memberRemoveRequested',
);

/** Saga: a revoke/remove settled (`error` null on success). */
export const shareActionSettled = createAction<[error: string | null]>(
  'workspaceShare/actionSettled',
);

export const workspaceShareReducer = createReducer<WorkspaceShareState>(initialState);
workspaceShareReducer.with(
  openShareDialog,
  (_state, { payload: [{ workspaceId, workspaceTitle }] }) => ({
    ...initialState,
    open: true,
    workspaceId,
    workspaceTitle,
  }),
);
workspaceShareReducer.with(closeShareDialog, () => initialState);
workspaceShareReducer.with(shareDataRequested, (state) => {
  if (!state.open) return state;
  return { ...state, loadStatus: 'loading', loadError: null };
});
workspaceShareReducer.with(
  shareDataLoaded,
  (state, { payload: [{ workspaceId, members, invites }] }) => {
    if (!state.open || state.workspaceId !== workspaceId) return state;
    return {
      ...state,
      members: createCollection('principalId', members),
      invites: createCollection('id', invites),
      loadStatus: 'loaded',
      loadError: null,
    };
  },
);
workspaceShareReducer.with(shareDataFailed, (state, { payload: [{ workspaceId, error }] }) => {
  if (!state.open || state.workspaceId !== workspaceId) return state;
  return { ...state, loadStatus: 'error', loadError: error };
});
workspaceShareReducer.with(shareInviteCreateRequested, (state) => {
  if (!state.open || state.creating) return state;
  return { ...state, creating: true, createError: null };
});
workspaceShareReducer.with(shareInviteCreated, (state, { payload: [link] }) => {
  if (!state.open) return state;
  return { ...state, creating: false, createError: null, createdLink: link };
});
workspaceShareReducer.with(shareInviteCreateFailed, (state, { payload: [error] }) => {
  if (!state.open) return state;
  return { ...state, creating: false, createError: error };
});
workspaceShareReducer.with(shareInviteRevokeRequested, (state, { payload: [inviteId] }) => {
  if (!state.open || state.revokingInviteId || state.removingPrincipalId) return state;
  return { ...state, revokingInviteId: inviteId, actionError: null };
});
workspaceShareReducer.with(shareMemberRemoveRequested, (state, { payload: [principalId] }) => {
  if (!state.open || state.revokingInviteId || state.removingPrincipalId) return state;
  return { ...state, removingPrincipalId: principalId, actionError: null };
});
workspaceShareReducer.with(shareActionSettled, (state, { payload: [error] }) => {
  if (!state.open) return state;
  return { ...state, revokingInviteId: null, removingPrincipalId: null, actionError: error };
});
