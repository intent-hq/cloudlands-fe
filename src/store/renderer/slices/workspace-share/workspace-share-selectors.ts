/**
 * Workspace Share Selectors
 */

import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '../../store';
import { selectCanShareWorkspace } from '../workspace/workspace-selectors';
import { getRosterState, type WorkspaceShareTarget } from './workspace-share-slice';

export const selectShareDialogOpen = store.createSelector((state) => state.workspaceShare.open);

export const selectShareWorkspaceId = store.createSelector(
  (state) => state.workspaceShare.workspaceId,
);

/** The open dialog's `{ workspaceId, session }` identity; `null` while closed. */
export const selectShareTarget = store.createSelector<[], WorkspaceShareTarget | null>((state) => {
  const { open, workspaceId, session } = state.workspaceShare;
  return open && workspaceId ? { workspaceId, session } : null;
});

/**
 * True when the connected principal can manage sharing for the dialog's workspace
 * (`selectCanShareWorkspace`: server management authority and Multiplayer in this
 * window, PROTOCOL §5.1) and the daemon has not refused a sharing
 * method. Gates every mutating control and RPC.
 */
export const selectShareCanManage = store.createSelector((state) => {
  const { open, workspaceId, withheld } = state.workspaceShare;
  if (!open || !workspaceId || withheld) return false;
  return selectCanShareWorkspace.select(state, workspaceId);
});

export const selectShareCreateRequest = store.createSelector(
  (state) => state.workspaceShare.createRequest,
);

export const selectShareMutationGeneration = store.createSelector(
  (state) => state.workspaceShare.mutationGeneration,
);

export const selectShareWorkspaceTitle = store.createSelector(
  (state) => state.workspaceShare.workspaceTitle,
);

/** Ordered roster (owner first, as the daemon lists it). */
export const selectShareMembers = store.createSelector((state) =>
  getItems(state.workspaceShare.members),
);

/** True when the loaded dialog roster carries `principalId`. */
export const selectShareHasMember = store.createSelector(
  (state, principalId: string) => getItem(state.workspaceShare.members, principalId) !== undefined,
);

/** Ordered open invites. */
export const selectShareInvites = store.createSelector((state) =>
  getItems(state.workspaceShare.invites),
);

/**
 * Guests already authed on this host that are not yet on the roster
 * (`principal.list` minus `workspace.members.list`), in daemon order: the
 * candidates of the "Invite an existing GitHub user" dropdown.
 */
export const selectShareInvitablePrincipals = store.createSelector((state) => {
  const { principals, members } = state.workspaceShare;
  return getItems(principals).filter((principal) => !getItem(members, principal.principalId));
});

/** Guests spent (collaborators + open invites); `null` until read or when unreported. */
export const selectShareGuestCount = store.createSelector(
  (state) => state.workspaceShare.guestCount,
);

/** The workspace's guest cap (`sharing.maxGuestsPerWorkspace`); `null` when unreported. */
export const selectShareGuestLimit = store.createSelector(
  (state) => state.workspaceShare.guestLimit,
);

export const selectShareLoading = store.createSelector(
  (state) => state.workspaceShare.loadStatus === 'loading',
);

export const selectShareLoadError = store.createSelector((state) => state.workspaceShare.loadError);

export const selectShareCreating = store.createSelector((state) => state.workspaceShare.creating);

export const selectShareCreateError = store.createSelector(
  (state) => state.workspaceShare.createError,
);

export const selectShareCreatedLink = store.createSelector(
  (state) => state.workspaceShare.createdLink,
);

export const selectShareRevokingInviteId = store.createSelector(
  (state) => state.workspaceShare.revokingInviteId,
);

export const selectShareRemovingPrincipalId = store.createSelector(
  (state) => state.workspaceShare.removingPrincipalId,
);

export const selectShareAddingPrincipalId = store.createSelector(
  (state) => state.workspaceShare.addingPrincipalId,
);

export const selectShareActionError = store.createSelector(
  (state) => state.workspaceShare.actionError,
);

/** Saga: a hover card has asked for this workspace's roster at least once. */
export const selectWorkspaceRosterTracked = store.createSelector(
  (state, workspaceId: string) => workspaceId in state.workspaceShare.byWorkspaceId,
);

/** Hover card: the roster of `workspaceId` in daemon order (empty until read). */
export const selectWorkspaceRosterMembers = store.createSelector((state, workspaceId?: string) =>
  workspaceId ? getItems(getRosterState(state.workspaceShare, workspaceId).members) : [],
);

/**
 * Hover card: the owner may manage sharing for `workspaceId`
 * (`selectCanShareWorkspace`: server management authority and Multiplayer in this
 * window) and the daemon has not refused an owner-only method for it. Gates the
 * Share entry and every Remove control.
 */
export const selectWorkspaceRosterCanManage = store.createSelector(
  (state, workspaceId?: string) =>
    !!workspaceId &&
    !getRosterState(state.workspaceShare, workspaceId).withheld &&
    selectCanShareWorkspace.select(state, workspaceId),
);

/** Hover card: the daemon refused an owner-only method for `workspaceId`. */
export const selectWorkspaceRosterWithheld = store.createSelector(
  (state, workspaceId?: string) =>
    !!workspaceId && getRosterState(state.workspaceShare, workspaceId).withheld,
);

/** Hover card: the collaborator whose removal is in flight, if any. */
export const selectWorkspaceRosterRemovingPrincipalId = store.createSelector(
  (state, workspaceId?: string) =>
    workspaceId ? getRosterState(state.workspaceShare, workspaceId).removingPrincipalId : null,
);

/** Hover card: the localized error of the last failed removal, if any. */
export const selectWorkspaceRosterRemoveError = store.createSelector(
  (state, workspaceId?: string) =>
    workspaceId ? getRosterState(state.workspaceShare, workspaceId).removeError : null,
);
