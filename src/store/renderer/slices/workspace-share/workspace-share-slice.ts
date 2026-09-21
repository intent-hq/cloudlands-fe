/**
 * Workspace Share Slice
 *
 * State for the owner-side Share dialog (multiplayer w4). The dialog is
 * global — one host in the app layout serves every entry point (sidebar
 * header kebab, tab context menu) — so the target workspace, the member
 * roster, the open invites, and every in-flight mutation ride in the store.
 * The saga performs the sharing RPCs and settles the `*Loaded` / `*Failed`
 * actions; the dialog only renders this state and dispatches intent.
 *
 * The workspace hover card's member roster rides here too, keyed by
 * workspace id (`byWorkspaceId`): several cards can be live at once and a card can
 * retarget mid-flight, so every roster settlement names its workspace and
 * only that entry moves. The card keeps nothing but its confirmation UI local.
 */

import {
  createCollection,
  getItem,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  HostPrincipal,
  WorkspaceInvite,
  WorkspaceMember,
} from '$features/workspace-sharing/types';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';

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
 * The link the last `workspace.invite.create` of this session returned, by
 * reference only: the url (a capability carrying the invite secret) is parked
 * in `invite-link-vault` under `inviteId`, which also ties the panel to its
 * `workspace.invite.list` row so a revoke — local or daemon-side — retires it.
 */
export interface WorkspaceShareCreatedLink {
  inviteId: string;
  pinLogin?: string;
}

/** Hover-card roster of one workspace (see `WorkspaceShareState.byWorkspaceId`). */
export interface WorkspaceRosterState {
  /** Roster in daemon order (owner first). */
  members: Collection<WorkspaceMember, 'principalId'>;
  loadStatus: 'idle' | 'loading' | 'loaded' | 'error';
  /**
   * The daemon refused an owner-only sharing method (`-32003`) or the caller
   * is not the owner: the card withholds Share/Remove for this workspace.
   */
  withheld: boolean;
  removingPrincipalId: string | null;
  removeError: string | null;
}

export const initialRosterState: WorkspaceRosterState = {
  members: createCollection<WorkspaceMember, 'principalId'>('principalId'),
  loadStatus: 'idle',
  withheld: false,
  removingPrincipalId: null,
  removeError: null,
};

export interface WorkspaceShareState {
  /** Hover-card rosters by workspace id; absent until a card asks for one. */
  byWorkspaceId: Record<string, WorkspaceRosterState>;
  open: boolean;
  workspaceId: string | null;
  workspaceTitle: string;
  /** Advances on every open; never reset by close (see `WorkspaceShareTarget`). */
  session: number;
  /** Roster in daemon order (owner first). */
  members: Collection<WorkspaceMember, 'principalId'>;
  /** Open invites in daemon order. */
  invites: Collection<WorkspaceInvite, 'id'>;
  /**
   * Guests already authed on this host (`principal.list`, in daemon order),
   * offered for direct member add; the dialog filters out the current roster
   * at render time. Empty until read or when the daemon cannot list them.
   */
  principals: Collection<HostPrincipal, 'principalId'>;
  /**
   * Guest cap of the dialog's workspace as `workspace.members.list` reports
   * it (intent-hq/intentd#1917): `guestCount` collaborators plus open invites
   * spent against `guestLimit`. `null` until read, or when the daemon omits
   * the fields; the dialog gates Create only on a known cap.
   */
  guestCount: number | null;
  guestLimit: number | null;
  loadStatus: 'idle' | 'loading' | 'loaded' | 'error';
  loadError: string | null;
  /**
   * Advances on every local mutation of this session that the saga follows
   * with its own re-read (invite created, revoke / remove succeeded). A read
   * snapshot must echo the generation it was taken under: a pre-mutation
   * snapshot settling late is stale and dropped, so the trailing
   * post-mutation read stays authoritative (it would otherwise retire a
   * `createdLink` its list predates). A successful member add does NOT
   * advance it: its roster is reconciled by the daemon's `workspace:updated`
   * members event, whose read may already be in flight when the add reply
   * lands (the daemon commits before it emits) and must not be dropped.
   */
  mutationGeneration: number;
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
  /** `workspace.members.add` in flight for this host principal. */
  addingPrincipalId: string | null;
  actionError: string | null;
}

export const initialState: WorkspaceShareState = {
  byWorkspaceId: {},
  open: false,
  workspaceId: null,
  workspaceTitle: '',
  session: 0,
  members: createCollection<WorkspaceMember, 'principalId'>('principalId'),
  invites: createCollection<WorkspaceInvite, 'id'>('id'),
  principals: createCollection<HostPrincipal, 'principalId'>('principalId'),
  guestCount: null,
  guestLimit: null,
  loadStatus: 'idle',
  loadError: null,
  mutationGeneration: 0,
  withheld: false,
  creating: false,
  createRequest: 0,
  createError: null,
  createdLink: null,
  revokingInviteId: null,
  removingPrincipalId: null,
  addingPrincipalId: null,
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

/**
 * Saga: roster + invites arrived for `target` (ignored if the dialog moved on
 * or a mutation landed since the read started — see `mutationGeneration`).
 */
export const shareDataLoaded = createAction<
  [
    payload: {
      target: WorkspaceShareTarget;
      generation: number;
      members: WorkspaceMember[];
      invites: WorkspaceInvite[];
      guestCount: number | null;
      guestLimit: number | null;
    },
  ]
>('workspaceShare/dataLoaded');

/**
 * Saga: the host's credentialed guests (`principal.list`) arrived for
 * `target`. Read beside the roster; a failed read leaves the previous rows.
 */
export const sharePrincipalsLoaded = createAction<
  [payload: { target: WorkspaceShareTarget; principals: HostPrincipal[] }]
>('workspaceShare/principalsLoaded');

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

/** Attach a `principal.list` guest as a collaborator (`workspace.members.add`). */
export const shareMemberAddRequested = createAction<[principalId: string]>(
  'workspaceShare/memberAddRequested',
);

/**
 * Saga: a revoke/remove/add settled (`error` null on success). A successful
 * revoke names `revokedInviteId` so the matching one-time link retires at once.
 */
export const shareActionSettled = createAction<
  [payload: { target: WorkspaceShareTarget; error: string | null; revokedInviteId?: string }]
>('workspaceShare/actionSettled');

/** Hover card: read (or re-read) the roster of `workspaceId`. */
export const shareRosterRequested = createAction<[payload: { workspaceId: string }]>(
  'workspaceShare/rosterRequested',
);

/** Saga: the roster of `workspaceId` arrived. */
export const shareRosterLoaded = createAction<
  [payload: { workspaceId: string; members: WorkspaceMember[] }]
>('workspaceShare/rosterLoaded');

/** Saga: the roster read failed; the previous rows stay. */
export const shareRosterFailed = createAction<[payload: { workspaceId: string }]>(
  'workspaceShare/rosterFailed',
);

/** Saga: the caller may not manage sharing for `workspaceId` (see `withheld`). */
export const shareRosterWithheld = createAction<[payload: { workspaceId: string }]>(
  'workspaceShare/rosterWithheld',
);

/** Hover card: remove a collaborator (after the card's own confirmation step). */
export const shareRosterMemberRemoveRequested = createAction<
  [payload: { workspaceId: string; principalId: string }]
>('workspaceShare/rosterMemberRemoveRequested');

/** Saga: a hover-card removal settled (`error` null on success). */
export const shareRosterActionSettled = createAction<
  [payload: { workspaceId: string; error: string | null }]
>('workspaceShare/rosterActionSettled');

function targets(state: WorkspaceShareState, target: WorkspaceShareTarget): boolean {
  return state.open && state.workspaceId === target.workspaceId && state.session === target.session;
}

function withoutRows(state: WorkspaceShareState): WorkspaceShareState {
  return {
    ...state,
    members: initialState.members,
    invites: initialState.invites,
    principals: initialState.principals,
    guestCount: null,
    guestLimit: null,
    creating: false,
    createError: null,
    createdLink: null,
    revokingInviteId: null,
    removingPrincipalId: null,
    addingPrincipalId: null,
    actionError: null,
  };
}

/** A dialog mutation (revoke / remove / add) is in flight; one at a time. */
function mutating(state: WorkspaceShareState): boolean {
  return (
    state.revokingInviteId !== null ||
    state.removingPrincipalId !== null ||
    state.addingPrincipalId !== null
  );
}

const { getWorkspaceState: getRosterState, setWorkspaceState: setRosterState } =
  createWorkspaceScopedHelpers(initialRosterState);
export { getRosterState };

export const workspaceShareReducer = createReducer<WorkspaceShareState>(initialState);
workspaceShareReducer.with(
  openShareDialog,
  (state, { payload: [{ workspaceId, workspaceTitle }] }) => ({
    ...initialState,
    byWorkspaceId: state.byWorkspaceId,
    open: true,
    workspaceId,
    workspaceTitle,
    session: state.session + 1,
  }),
);
workspaceShareReducer.with(closeShareDialog, (state) => ({
  ...initialState,
  byWorkspaceId: state.byWorkspaceId,
  session: state.session,
}));
workspaceShareReducer.with(shareRosterRequested, (state, { payload: [{ workspaceId }] }) => {
  const roster = getRosterState(state, workspaceId);
  if (roster.withheld) return state;
  return setRosterState(state, workspaceId, { ...roster, loadStatus: 'loading' });
});
workspaceShareReducer.with(shareRosterLoaded, (state, { payload: [{ workspaceId, members }] }) => {
  const roster = getRosterState(state, workspaceId);
  if (roster.withheld) return state;
  return setRosterState(state, workspaceId, {
    ...roster,
    members: createCollection('principalId', members),
    loadStatus: 'loaded',
  });
});
workspaceShareReducer.with(shareRosterFailed, (state, { payload: [{ workspaceId }] }) => {
  const roster = getRosterState(state, workspaceId);
  if (roster.withheld) return state;
  return setRosterState(state, workspaceId, { ...roster, loadStatus: 'error' });
});
workspaceShareReducer.with(shareRosterWithheld, (state, { payload: [{ workspaceId }] }) =>
  setRosterState(state, workspaceId, {
    ...getRosterState(state, workspaceId),
    loadStatus: 'loaded',
    withheld: true,
    removingPrincipalId: null,
    removeError: null,
  }),
);
workspaceShareReducer.with(
  shareRosterMemberRemoveRequested,
  (state, { payload: [{ workspaceId, principalId }] }) => {
    const roster = getRosterState(state, workspaceId);
    if (roster.withheld || roster.removingPrincipalId) return state;
    return setRosterState(state, workspaceId, {
      ...roster,
      removingPrincipalId: principalId,
      removeError: null,
    });
  },
);
workspaceShareReducer.with(
  shareRosterActionSettled,
  (state, { payload: [{ workspaceId, error }] }) => {
    const roster = getRosterState(state, workspaceId);
    if (roster.withheld) return state;
    return setRosterState(state, workspaceId, {
      ...roster,
      removingPrincipalId: null,
      removeError: error,
    });
  },
);
workspaceShareReducer.with(shareDataRequested, (state) => {
  if (!state.open || state.withheld) return state;
  return { ...state, loadStatus: 'loading', loadError: null };
});
workspaceShareReducer.with(
  shareDataLoaded,
  (state, { payload: [{ target, generation, members, invites, guestCount, guestLimit }] }) => {
    if (!targets(state, target) || state.withheld || state.mutationGeneration !== generation) {
      return state;
    }
    const invitesById = createCollection('id', invites);
    const createdLink =
      state.createdLink && getItem(invitesById, state.createdLink.inviteId)
        ? state.createdLink
        : null;
    return {
      ...state,
      members: createCollection('principalId', members),
      invites: invitesById,
      guestCount,
      guestLimit,
      createdLink,
      loadStatus: 'loaded',
      loadError: null,
    };
  },
);
workspaceShareReducer.with(
  sharePrincipalsLoaded,
  (state, { payload: [{ target, principals }] }) => {
    if (!targets(state, target) || state.withheld) return state;
    return { ...state, principals: createCollection('principalId', principals) };
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
    return {
      ...state,
      creating: false,
      createError: null,
      createdLink: link,
      mutationGeneration: state.mutationGeneration + 1,
    };
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
  if (!state.open || state.withheld || mutating(state)) return state;
  return { ...state, revokingInviteId: inviteId, actionError: null };
});
workspaceShareReducer.with(shareMemberRemoveRequested, (state, { payload: [principalId] }) => {
  if (!state.open || state.withheld || mutating(state)) return state;
  return { ...state, removingPrincipalId: principalId, actionError: null };
});
workspaceShareReducer.with(shareMemberAddRequested, (state, { payload: [principalId] }) => {
  if (!state.open || state.withheld || mutating(state)) return state;
  return { ...state, addingPrincipalId: principalId, actionError: null };
});
workspaceShareReducer.with(
  shareActionSettled,
  (state, { payload: [{ target, error, revokedInviteId }] }) => {
    if (!targets(state, target) || state.withheld) return state;
    const createdLink =
      revokedInviteId && state.createdLink?.inviteId === revokedInviteId ? null : state.createdLink;
    // One mutation at a time (`mutating`): an in-flight add is the one settling.
    const advances = error === null && state.addingPrincipalId === null;
    return {
      ...state,
      createdLink,
      mutationGeneration: advances ? state.mutationGeneration + 1 : state.mutationGeneration,
      revokingInviteId: null,
      removingPrincipalId: null,
      addingPrincipalId: null,
      actionError: error,
    };
  },
);
