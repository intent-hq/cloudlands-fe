/**
 * Workspace Share Selectors
 */

import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '../../store';

export const selectShareDialogOpen = store.createSelector((state) => state.workspaceShare.open);

export const selectShareWorkspaceId = store.createSelector(
  (state) => state.workspaceShare.workspaceId,
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
