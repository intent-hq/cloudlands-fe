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
  getItem,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { WorkspaceInvite, WorkspaceMember } from '$features/workspace-sharing/types';

/**
 * Identity of one dialog session: the target workspace plus a `session`
 * counter that advances on every open. Every saga settlement carries the
 * target it was issued for and the reducer drops any that no longer matches —
 * a delayed `workspace.invite.create` for workspace A can never attach its
 * link once the dialog has been closed or retargeted to workspace B.
 */
export interface WorkspaceShareTarget {
  workspaceId: string;
  session: number;
}

/**
 * The one-time link, by reference only: the url (which carries the invite
 * secret) is parked in `invite-link-vault` and the store keeps the opaque
 * `linkHandle`. `inviteId` ties the link to its `workspace.invite.list` row so
 * a revoke — local or daemon-side — retires it.
 */
export interface WorkspaceShareCreatedLink {
  inviteId: string;
  linkHandle: string;
  pinLogin?: string;
}

export interface WorkspaceShareState {
  open: boolean;
  workspaceId: string | null;
  workspaceTitle: string;
  /** Advances on every open; never reset by close (see `WorkspaceShareTarget`). */
  session: number;
  /** Roster in daemon order (owner first). */
  members: Collection<WorkspaceMember, 'principalId'>;
  /** Open invites in daemon order. */
  invites: Collection<WorkspaceInvite, 'id'>;
  loadStatus: 'idle' | 'loading' | 'loaded' | 'error';
  loadError: string | null;
  /**
   * The daemon refused an owner-only sharing method (`-32003`) or the caller
   * is not the workspace owner: rows are dropped and the dialog renders the
   * owner-only notice instead of the controls.
   */
  withheld: boolean;
  creating: boolean;
  /** Advances on every create request; a create settlement must echo it. */
  createRequest: number;
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
  session: 0,
  members: createCollection<WorkspaceMember, 'principalId'>('principalId'),
  invites: createCollection<WorkspaceInvite, 'id'>('id'),
  loadStatus: 'idle',
  loadError: null,
  withheld: false,
  creating: false,
  createRequest: 0,
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

/**
 * Daemon events bridge: a `workspace:updated` delta flagged `members` and/or
 * `invites` (invite created / revoked / redeemed, member removed / left —
 * PROTOCOL §5.1). The saga re-reads when the dialog targets that workspace.
 */
export const shareMembershipChanged = createAction<[payload: { workspaceId: string }]>(
  'workspaceShare/membershipChanged',
);

/** Saga: roster + invites arrived for `target` (ignored if the dialog moved on). */
export const shareDataLoaded = createAction<
  [
    payload: {
      target: WorkspaceShareTarget;
      members: WorkspaceMember[];
      invites: WorkspaceInvite[];
    },
  ]
>('workspaceShare/dataLoaded');

/** Saga: the roster/invite read failed (`error` already localized). */
export const shareDataFailed = createAction<
  [payload: { target: WorkspaceShareTarget; error: string }]
>('workspaceShare/dataFailed');

/** Saga: the caller may not manage sharing for `target` (see `withheld`). */
export const shareAccessWithheld = createAction<[payload: { target: WorkspaceShareTarget }]>(
  'workspaceShare/accessWithheld',
);

/** Mint an invite link; `pinLogin` (trimmed, may be empty) restricts redemption. */
export const shareInviteCreateRequested = createAction<[payload: { pinLogin: string }]>(
  'workspaceShare/inviteCreateRequested',
);

/** Saga: the invite for `target` / `request` was created; the link is shown once. */
export const shareInviteCreated = createAction<
  [payload: { target: WorkspaceShareTarget; request: number; link: WorkspaceShareCreatedLink }]
>('workspaceShare/inviteCreated');

/** Saga: invite creation failed (`error` already localized). */
export const shareInviteCreateFailed = createAction<
  [payload: { target: WorkspaceShareTarget; request: number; error: string }]
>('workspaceShare/inviteCreateFailed');

/** Revoke an open invite. */
export const shareInviteRevokeRequested = createAction<[inviteId: string]>(
  'workspaceShare/inviteRevokeRequested',
);

/** Remove a collaborator from the roster. */
export const shareMemberRemoveRequested = createAction<[principalId: string]>(
  'workspaceShare/memberRemoveRequested',
);

/**
 * Saga: a revoke/remove settled (`error` null on success). A successful revoke
 * names `revokedInviteId` so the matching one-time link retires at once.
 */
export const shareActionSettled = createAction<
  [payload: { target: WorkspaceShareTarget; error: string | null; revokedInviteId?: string }]
>('workspaceShare/actionSettled');

function targets(state: WorkspaceShareState, target: WorkspaceShareTarget): boolean {
  return state.open && state.workspaceId === target.workspaceId && state.session === target.session;
}

function withoutRows(state: WorkspaceShareState): WorkspaceShareState {
  return {
    ...state,
    members: initialState.members,
    invites: initialState.invites,
    creating: false,
    createError: null,
    createdLink: null,
    revokingInviteId: null,
    removingPrincipalId: null,
    actionError: null,
  };
}

export const workspaceShareReducer = createReducer<WorkspaceShareState>(initialState);
workspaceShareReducer.with(
  openShareDialog,
  (state, { payload: [{ workspaceId, workspaceTitle }] }) => ({
    ...initialState,
    open: true,
    workspaceId,
    workspaceTitle,
    session: state.session + 1,
  }),
);
workspaceShareReducer.with(closeShareDialog, (state) => ({
  ...initialState,
  session: state.session,
}));
workspaceShareReducer.with(shareDataRequested, (state) => {
  if (!state.open || state.withheld) return state;
  return { ...state, loadStatus: 'loading', loadError: null };
});
workspaceShareReducer.with(
  shareDataLoaded,
  (state, { payload: [{ target, members, invites }] }) => {
    if (!targets(state, target) || state.withheld) return state;
    const invitesById = createCollection('id', invites);
    const createdLink =
      state.createdLink && getItem(invitesById, state.createdLink.inviteId)
        ? state.createdLink
        : null;
    return {
      ...state,
      members: createCollection('principalId', members),
      invites: invitesById,
      createdLink,
      loadStatus: 'loaded',
      loadError: null,
    };
  },
);
workspaceShareReducer.with(shareDataFailed, (state, { payload: [{ target, error }] }) => {
  if (!targets(state, target) || state.withheld) return state;
  return { ...state, loadStatus: 'error', loadError: error };
});
workspaceShareReducer.with(shareAccessWithheld, (state, { payload: [{ target }] }) => {
  if (!targets(state, target)) return state;
  return { ...withoutRows(state), withheld: true, loadStatus: 'loaded', loadError: null };
});
workspaceShareReducer.with(shareInviteCreateRequested, (state) => {
  if (!state.open || state.withheld) return state;
  return {
    ...state,
    creating: true,
    createRequest: state.createRequest + 1,
    createError: null,
  };
});
workspaceShareReducer.with(
  shareInviteCreated,
  (state, { payload: [{ target, request, link }] }) => {
    if (!targets(state, target) || state.createRequest !== request || state.withheld) return state;
    return { ...state, creating: false, createError: null, createdLink: link };
  },
);
workspaceShareReducer.with(
  shareInviteCreateFailed,
  (state, { payload: [{ target, request, error }] }) => {
    if (!targets(state, target) || state.createRequest !== request || state.withheld) return state;
    return { ...state, creating: false, createError: error };
  },
);
workspaceShareReducer.with(shareInviteRevokeRequested, (state, { payload: [inviteId] }) => {
  if (!state.open || state.withheld || state.revokingInviteId || state.removingPrincipalId) {
    return state;
  }
  return { ...state, revokingInviteId: inviteId, actionError: null };
});
workspaceShareReducer.with(shareMemberRemoveRequested, (state, { payload: [principalId] }) => {
  if (!state.open || state.withheld || state.revokingInviteId || state.removingPrincipalId) {
    return state;
  }
  return { ...state, removingPrincipalId: principalId, actionError: null };
});
workspaceShareReducer.with(
  shareActionSettled,
  (state, { payload: [{ target, error, revokedInviteId }] }) => {
    if (!targets(state, target) || state.withheld) return state;
    const createdLink =
      revokedInviteId && state.createdLink?.inviteId === revokedInviteId ? null : state.createdLink;
    return {
      ...state,
      createdLink,
      revokingInviteId: null,
      removingPrincipalId: null,
      actionError: error,
    };
  },
);
