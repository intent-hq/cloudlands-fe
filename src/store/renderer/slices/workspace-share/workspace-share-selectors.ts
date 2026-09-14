/**
 * Workspace Share Selectors
 */

import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { Workspace } from '$shared/types';
import { store } from '../../store';
import type { WorkspaceShareTarget } from './workspace-share-slice';

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
 * True when the connected principal owns the dialog's workspace
 * (`workspace.myRole === 'owner'`, PROTOCOL §5.1) and the daemon has not
 * refused an owner-only sharing method. Gates every mutating control and RPC.
 */
export const selectShareCanManage = store.createSelector((state) => {
  const { open, workspaceId, withheld } = state.workspaceShare;
  if (!open || !workspaceId || withheld) return false;
  return getItem(state.workspace.workspaces, workspaceId as Workspace['id'])?.myRole === 'owner';
});

export const selectShareCreateRequest = store.createSelector(
  (state) => state.workspaceShare.createRequest,
);

export const selectShareWorkspaceTitle = store.createSelector(
  (state) => state.workspaceShare.workspaceTitle,
);

/** Ordered roster (owner first, as the daemon lists it). */
export const selectShareMembers = store.createSelector((state) =>
  getItems(state.workspaceShare.members),
);

/** Ordered open invites. */
export const selectShareInvites = store.createSelector((state) =>
  getItems(state.workspaceShare.invites),
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

export const selectShareActionError = store.createSelector(
  (state) => state.workspaceShare.actionError,
);
