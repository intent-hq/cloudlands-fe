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
  getItems,
  removeItem,
  upsertItem,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type {
  HostPrincipal,
  InvitePin,
  PrincipalIdentity,
  WorkspaceInvite,
  WorkspaceMember,
} from '$features/workspace-sharing/types';
import type { WorkspaceGuestRole } from '$shared/types';
import { isWorkspaceGuest } from '$features/workspace-sharing/utils/workspace-guest';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';

/**
 * Identity of one dialog session: the target workspace plus a `session`
 * counter that advances on every open. Every saga settlement carries the
 * target it was issued for and the reducer drops any that no longer matches —
 * a delayed `workspace.invite.create` for workspace A can never attach its
 * link once the dialog has been closed or retargeted to workspace B.
 */
export interface WorkspaceShareTarget {
  /** Captured only by the request owner; omitted on pure presentation actions. */
  authority?: string | null;
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
  /** The pinned account's forge, as the daemon resolved it. */
  pinIdentity?: PrincipalIdentity;
}

/** Hover-card roster and invite read lifetime of one workspace. */
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
  /** Invite metadata shares the canonical collection on workspaceShare. */
  inviteContext: string | null;
  inviteGeneration: number;
  inviteWithheld: boolean;
  inviteReceivedAt: number;
}

export const initialRosterState: WorkspaceRosterState = {
  members: createCollection<WorkspaceMember, 'principalId'>('principalId'),
  loadStatus: 'idle',
  withheld: false,
  removingPrincipalId: null,
  removeError: null,
  inviteContext: null,
  inviteGeneration: 0,
  inviteWithheld: false,
  inviteReceivedAt: 0,
};

export interface WorkspaceShareState {
  integrationAuth: { github: boolean; gitlab: boolean };
  /** Prerequisites belong to one admitted host identity and dialog session. */
  sharingContext: string | null;
  sharingEnabled: boolean | null;
  sharingChecking: boolean;
  sharingEnabling: boolean;
  sharingError: string | null;
  /** Workspace read lifetimes, tracked by hover cards and open People tabs. */
  byWorkspaceId: Record<string, WorkspaceRosterState>;
  open: boolean;
  workspaceId: string | null;
  workspaceTitle: string;
  /** Advances on every open; never reset by close (see `WorkspaceShareTarget`). */
  session: number;
  /** Roster in daemon order (owner first). */
  members: Collection<WorkspaceMember, 'principalId'>;
  /** Canonical open invites across workspaces; dialog and People share these rows. */
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
  pendingRolePrincipalIds: string[];
  roleErrors: Record<string, string>;
  actionError: string | null;
}

export const initialState: WorkspaceShareState = {
  integrationAuth: { github: false, gitlab: false },
  sharingContext: null,
  sharingEnabled: null,
  sharingChecking: false,
  sharingEnabling: false,
  sharingError: null,
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
  pendingRolePrincipalIds: [],
  roleErrors: {},
  actionError: null,
};

/** Open the Share dialog for a workspace; the saga loads the roster + invites. */
export const openShareDialog = createAction<
  [payload: { workspaceId: string; workspaceTitle: string }]
>('workspaceShare/openDialog');

/** Recheck the current host without resetting the dialog's selections. */
export const sharePrerequisitesRequested = createAction('workspaceShare/prerequisitesRequested');
export const shareEnableRequested = createAction('workspaceShare/enableRequested');
export const sharePrerequisitesStarted = createAction<
  [payload: { target: WorkspaceShareTarget; enabling: boolean }]
>('workspaceShare/prerequisitesStarted');
export const sharePrerequisitesSettled = createAction<
  [payload: { target: WorkspaceShareTarget; enabled: boolean | null; error: string | null }]
>('workspaceShare/prerequisitesSettled');

/** Close the dialog, retaining workspace invite metadata for People. */
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
      inviteGeneration?: number;
      receivedAt?: number;
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

/**
 * Mint an invite link; `pinLogin` (trimmed, may be empty) restricts redemption
 * and `pin` names the forge it lives on (absent: the host's identity forge).
 */
export const shareInviteCreateRequested = createAction<
  [payload: { pinLogin: string; pin?: InvitePin }]
>('workspaceShare/inviteCreateRequested');

/** Saga: creation succeeded; publish the secret-free row before refreshing the roster. */
export const shareInviteCreated = createAction<
  [
    payload: {
      target: WorkspaceShareTarget;
      request: number;
      link: WorkspaceShareCreatedLink;
      invite: WorkspaceInvite;
    },
  ]
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
    invites: createCollection(
      'id',
      getItems(state.invites).filter((row) => row.workspaceId !== state.workspaceId),
    ),
    principals: initialState.principals,
    guestCount: null,
    guestLimit: null,
    creating: false,
    createError: null,
    createdLink: null,
    revokingInviteId: null,
    removingPrincipalId: null,
    addingPrincipalId: null,
    pendingRolePrincipalIds: [],
    roleErrors: {},
    actionError: null,
  };
}

/** A dialog mutation (revoke / remove / add) is in flight; one at a time. */
function mutating(state: WorkspaceShareState): boolean {
  return (
    state.pendingRolePrincipalIds.length > 0 ||
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
    invites: state.invites,
    open: true,
    workspaceId,
    workspaceTitle,
    session: state.session + 1,
  }),
);
workspaceShareReducer.with(closeShareDialog, (state) => ({
  ...initialState,
  byWorkspaceId: state.byWorkspaceId,
  invites: state.invites,
  session: state.session,
}));
workspaceShareReducer.with(
  sharePrerequisitesStarted,
  (state, { payload: [{ target, enabling }] }) => {
    if (!targets(state, target) || state.withheld || !target.authority) return state;
    return {
      ...state,
      sharingContext: target.authority,
      createError: enabling ? null : state.createError,
      sharingEnabled: null,
      sharingChecking: !enabling,
      sharingEnabling: enabling,
      sharingError: null,
    };
  },
);
workspaceShareReducer.with(
  sharePrerequisitesSettled,
  (state, { payload: [{ target, enabled, error }] }) => {
    if (!targets(state, target) || state.withheld || state.sharingContext !== target.authority)
      return state;
    return {
      ...state,
      sharingEnabled: enabled,
      createError: state.sharingEnabling && enabled === true ? null : state.createError,
      sharingChecking: false,
      sharingEnabling: false,
      sharingError: error,
    };
  },
);
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
  (
    state,
    {
      payload: [
        {
          target,
          generation,
          inviteGeneration,
          receivedAt,
          members,
          invites,
          guestCount,
          guestLimit,
        },
      ],
    },
  ) => {
    if (!targets(state, target) || state.withheld || state.mutationGeneration !== generation) {
      return state;
    }
    const roster = getRosterState(state, target.workspaceId);
    const currentInvites =
      !roster.inviteWithheld &&
      (inviteGeneration === undefined || inviteGeneration === roster.inviteGeneration);
    const invitesById = currentInvites
      ? createCollection('id', [
          ...getItems(state.invites).filter((row) => row.workspaceId !== target.workspaceId),
          ...invites,
        ])
      : state.invites;
    const next = currentInvites
      ? setRosterState(state, target.workspaceId, {
          ...roster,
          inviteContext: target.authority ?? roster.inviteContext,
          inviteReceivedAt: receivedAt ?? roster.inviteReceivedAt,
        })
      : state;
    const createdLink =
      state.createdLink && getItem(invitesById, state.createdLink.inviteId)
        ? state.createdLink
        : null;
    return {
      ...next,
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
  return {
    ...setRosterState(withoutRows(state), target.workspaceId, {
      ...getRosterState(state, target.workspaceId),
      inviteWithheld: true,
    }),
    sharingEnabled: null,
    sharingChecking: false,
    sharingEnabling: false,
    sharingError: null,
    withheld: true,
    loadStatus: 'loaded',
    loadError: null,
  };
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
  (state, { payload: [{ target, request, link, invite }] }) => {
    if (!targets(state, target) || state.createRequest !== request || state.withheld) return state;
    const roster = getRosterState(state, target.workspaceId);
    return {
      ...setRosterState(state, target.workspaceId, {
        ...roster,
        inviteContext: target.authority ?? roster.inviteContext,
        inviteGeneration: roster.inviteGeneration + 1,
      }),
      creating: false,
      createError: null,
      createdLink: link,
      invites: upsertItem(state.invites, invite),
      guestCount:
        state.guestCount === null || getItem(state.invites, invite.id)
          ? state.guestCount
          : state.guestCount + 1,
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
      ...setRosterState(state, target.workspaceId, {
        ...getRosterState(state, target.workspaceId),
        inviteGeneration:
          getRosterState(state, target.workspaceId).inviteGeneration + (advances ? 1 : 0),
      }),
      invites:
        error === null && revokedInviteId
          ? removeItem(state.invites, revokedInviteId)
          : state.invites,
      createdLink,
      mutationGeneration: advances ? state.mutationGeneration + 1 : state.mutationGeneration,
      revokingInviteId: null,
      removingPrincipalId: null,
      addingPrincipalId: null,
      actionError: error,
    };
  },
);

export const shareIntegrationAuthRequested = createAction<
  [workspaceId: string, gitlabHost?: string]
>('workspaceShare/integrationAuthRequested');
export const shareIntegrationAuthLoaded = createAction<
  [target: WorkspaceShareTarget, auth: { github: boolean; gitlab: boolean }]
>('workspaceShare/integrationAuthLoaded');
workspaceShareReducer.with(shareIntegrationAuthRequested, (state) => ({
  ...state,
  integrationAuth: { github: false, gitlab: false },
}));
workspaceShareReducer.with(shareIntegrationAuthLoaded, (state, { payload: [target, auth] }) =>
  targets(state, target) ? { ...state, integrationAuth: auth } : state,
);

export const shareMemberRoleRequested = createAction<
  [payload: { principalId: string; role: WorkspaceGuestRole }]
>('workspaceShare/memberRoleRequested');
export const shareMemberRoleSettled = createAction<
  [
    payload: {
      target: WorkspaceShareTarget;
      principalId: string;
      error: string | null;
    },
  ]
>('workspaceShare/memberRoleSettled');

workspaceShareReducer.with(
  shareMemberRoleRequested,
  (state, { payload: [{ principalId, role }] }) => {
    const member = getItem(state.members, principalId);
    if (
      !state.open ||
      state.withheld ||
      !member ||
      !isWorkspaceGuest(member) ||
      (role !== 'collaborator' && role !== 'manager') ||
      member.role === role ||
      state.pendingRolePrincipalIds.includes(principalId) ||
      state.removingPrincipalId ||
      state.revokingInviteId ||
      state.addingPrincipalId
    )
      return state;
    const roleErrors = { ...state.roleErrors };
    delete roleErrors[principalId];
    return {
      ...state,
      pendingRolePrincipalIds: [...state.pendingRolePrincipalIds, principalId],
      roleErrors,
    };
  },
);
workspaceShareReducer.with(
  shareMemberRoleSettled,
  (state, { payload: [{ target, principalId, error }] }) => {
    if (
      !targets(state, target) ||
      state.withheld ||
      !state.pendingRolePrincipalIds.includes(principalId)
    )
      return state;
    const roleErrors = { ...state.roleErrors };
    if (error) roleErrors[principalId] = error;
    else delete roleErrors[principalId];
    return {
      ...state,
      pendingRolePrincipalIds: state.pendingRolePrincipalIds.filter((id) => id !== principalId),
      roleErrors,
      mutationGeneration: error === null ? state.mutationGeneration + 1 : state.mutationGeneration,
    };
  },
);

/** Open-tab lifetime and authority admission; the saga owns hydration. */
export const sharePeopleInvitesScopeChanged = createAction<
  [payload: { context: string | null; workspaceIds: string[] }]
>('workspaceShare/peopleInvitesScopeChanged');
export const sharePeopleInvitesRequested = createAction<[workspaceId: string]>(
  'workspaceShare/peopleInvitesRequested',
);
export const sharePeopleInvitesLoaded = createAction<
  [
    payload: {
      workspaceId: string;
      context: string;
      generation: number;
      invites: WorkspaceInvite[];
      receivedAt: number;
    },
  ]
>('workspaceShare/peopleInvitesLoaded');
export const sharePeopleInvitesWithheld = createAction<
  [read: { workspaceId: string; context: string; generation: number }]
>('workspaceShare/peopleInvitesWithheld');
export const shareInvitesExpired = createAction<[now: number]>('workspaceShare/invitesExpired');

workspaceShareReducer.with(
  sharePeopleInvitesScopeChanged,
  (state, { payload: [{ context, workspaceIds }] }) => {
    let next = state;
    for (const workspaceId of new Set([...Object.keys(state.byWorkspaceId), ...workspaceIds])) {
      const roster = getRosterState(next, workspaceId);
      const admitted = context !== null && workspaceIds.includes(workspaceId);
      const nextContext = admitted ? context : null;
      if (roster.inviteContext === nextContext) continue;
      next = setRosterState(next, workspaceId, {
        ...roster,
        inviteContext: nextContext,
        inviteGeneration: roster.inviteGeneration + 1,
        inviteWithheld: false,
        inviteReceivedAt: 0,
      });
      next = {
        ...next,
        createdLink: next.workspaceId === workspaceId ? null : next.createdLink,
        invites: createCollection(
          'id',
          getItems(next.invites).filter((row) => row.workspaceId !== workspaceId),
        ),
      };
    }
    return next;
  },
);
workspaceShareReducer.with(sharePeopleInvitesLoaded, (state, { payload: [read] }) => {
  const roster = getRosterState(state, read.workspaceId);
  if (
    roster.inviteWithheld ||
    roster.inviteGeneration !== read.generation ||
    roster.inviteContext !== read.context
  )
    return state;
  return {
    ...setRosterState(state, read.workspaceId, {
      ...roster,
      inviteContext: read.context,
      inviteReceivedAt: read.receivedAt,
    }),
    createdLink:
      state.workspaceId === read.workspaceId &&
      state.createdLink &&
      !read.invites.some((invite) => invite.id === state.createdLink?.inviteId)
        ? null
        : state.createdLink,
    invites: createCollection('id', [
      ...getItems(state.invites).filter((row) => row.workspaceId !== read.workspaceId),
      ...read.invites,
    ]),
  };
});
workspaceShareReducer.with(sharePeopleInvitesWithheld, (state, { payload: [read] }) => {
  const roster = getRosterState(state, read.workspaceId);
  if (roster.inviteContext !== read.context || roster.inviteGeneration !== read.generation)
    return state;
  return {
    ...setRosterState(state, read.workspaceId, { ...roster, inviteWithheld: true }),
    createdLink: state.workspaceId === read.workspaceId ? null : state.createdLink,
    invites: createCollection(
      'id',
      getItems(state.invites).filter((row) => row.workspaceId !== read.workspaceId),
    ),
  };
});
workspaceShareReducer.with(shareMembershipChanged, (state, { payload: [{ workspaceId }] }) => {
  if (!(workspaceId in state.byWorkspaceId)) return state;
  const roster = getRosterState(state, workspaceId);
  return setRosterState(state, workspaceId, {
    ...roster,
    inviteGeneration: roster.inviteGeneration + 1,
  });
});
workspaceShareReducer.with(shareInvitesExpired, (state, { payload: [now] }) => {
  const remaining = getItems(state.invites).filter((row) => Date.parse(row.expiresAt) > now);
  if (remaining.length === state.invites.ids.length) return state;
  const invites = createCollection('id', remaining);
  return {
    ...state,
    invites,
    createdLink:
      state.createdLink && getItem(invites, state.createdLink.inviteId) ? state.createdLink : null,
  };
});
