/**
 * Workspace Share Selectors
 */

import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { WorkspaceInvite } from '$features/workspace-sharing/types';
import { selectActiveWorkspaceIds } from '../tab-state/tab-state-selectors';
import {
  selectPrincipalActionContext,
  selectPrincipalSnapshot,
  selectCanAdministerHost,
} from '../principal/principal-selectors';
import {
  selectCanShareWorkspace,
  selectIsWorkspaceOwner,
  selectWorkspaceById,
} from '../workspace/workspace-selectors';
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
  if (
    !open ||
    !workspaceId ||
    withheld ||
    getRosterState(state.workspaceShare, workspaceId).inviteWithheld
  )
    return false;
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
  state.workspaceShare.open &&
  state.workspaceShare.workspaceId &&
  !state.workspaceShare.withheld &&
  !getRosterState(state.workspaceShare, state.workspaceShare.workspaceId).inviteWithheld
    ? getItems(state.workspaceShare.invites).filter(
        (invite) => invite.workspaceId === state.workspaceShare.workspaceId,
      )
    : [],
);

/**
 * Guests already authed on this host that are not yet on the roster
 * (`principal.list` minus `workspace.members.list`), in daemon order: the
 * candidates of the "Invite an existing user" dropdown.
 */
export const selectShareInvitablePrincipals = store.createSelector((state) => {
  const { principals, members } = state.workspaceShare;
  return getItems(principals).filter(
    (principal) =>
      !getItem(members, principal.principalId) &&
      (principal.hostRole === undefined || principal.hostRole === 'guest'),
  );
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
  (state, workspaceId: string) =>
    getRosterState(state.workspaceShare, workspaceId).loadStatus !== 'idle',
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

export const selectShareIntegrationAuth = store.createSelector(
  (state) => state.workspaceShare.integrationAuth,
);

/** Never present another host/identity's prerequisite result, even before its next read. */
const selectSharePrerequisitesCurrent = store.createSelector(
  (state) =>
    selectShareCanManage.select(state) &&
    selectCanAdministerHost.select(state) &&
    state.workspaceShare.sharingContext !== null &&
    state.workspaceShare.sharingContext === selectPrincipalActionContext.select(state),
);
export const selectShareSharingEnabled = store.createSelector((state) =>
  selectSharePrerequisitesCurrent.select(state) ? state.workspaceShare.sharingEnabled : null,
);
export const selectShareSharingChecking = store.createSelector(
  (state) => selectSharePrerequisitesCurrent.select(state) && state.workspaceShare.sharingChecking,
);
export const selectShareSharingEnabling = store.createSelector(
  (state) => selectSharePrerequisitesCurrent.select(state) && state.workspaceShare.sharingEnabling,
);
export const selectShareSharingError = store.createSelector((state) =>
  selectSharePrerequisitesCurrent.select(state) ? state.workspaceShare.sharingError : null,
);

export const selectShareCanSetMemberRole = store.createSelector(
  (state) =>
    selectShareCanManage.select(state) &&
    !!state.workspaceShare.workspaceId &&
    (selectCanAdministerHost.select(state) ||
      (selectShareOwnerPrincipalId.select(state)
        ? selectShareOwnerPrincipalId.select(state) ===
          selectPrincipalSnapshot.select(state)?.principal.id
        : selectIsWorkspaceOwner.select(state, state.workspaceShare.workspaceId))) &&
    selectPrincipalSnapshot.select(state)?.capabilities.workspaceGuestRoles === true,
);
export const selectSharePendingRolePrincipalIds = store.createSelector(
  (state) => state.workspaceShare.pendingRolePrincipalIds,
);
export const selectShareRoleErrors = store.createSelector(
  (state) => state.workspaceShare.roleErrors,
);

export const selectShareOwnerPrincipalId = store.createSelector((state) => {
  const workspaceId = state.workspaceShare.workspaceId;
  return workspaceId
    ? (selectWorkspaceById.select(state, workspaceId)?.ownerPrincipalId ?? null)
    : null;
});

/** People demand includes solo workspaces: their first guest may still be invited. */
export const selectWorkspacePeopleInviteScope = store.createSelector((state) => {
  const context = selectPrincipalActionContext.select(state);
  const ids = selectActiveWorkspaceIds.select(state);
  return {
    context,
    workspaceIds: context ? ids.filter((id) => selectCanShareWorkspace.select(state, id)) : [],
  };
});
export const selectWorkspaceInviteRead = store.createSelector((state, workspaceId: string) => {
  const roster = getRosterState(state.workspaceShare, workspaceId);
  return {
    context: roster.inviteContext,
    generation: roster.inviteGeneration,
    withheld: roster.inviteWithheld,
  };
});

const NO_INVITES: WorkspaceInvite[] = [];

/** Pending named invitees, joined only by qualified identity with accepted membership. */
export const selectWorkspacePeopleInvites = store.createSelector(
  (state, workspaceId: string): WorkspaceInvite[] => {
    const context = selectPrincipalActionContext.select(state);
    const roster = getRosterState(state.workspaceShare, workspaceId);
    if (
      !context ||
      roster.inviteContext !== context ||
      roster.inviteWithheld ||
      !selectCanShareWorkspace.select(state, workspaceId)
    )
      return NO_INVITES;
    const members =
      state.presence?.context === context ? state.presence.members[workspaceId] : undefined;
    const accepted = new Set(
      members
        ? getItems(members).flatMap((member) =>
            member.identity
              ? [
                  JSON.stringify([
                    member.identity.provider,
                    member.identity.host.toLowerCase(),
                    member.identity.externalUserId,
                  ]),
                ]
              : [],
          )
        : [],
    );
    const seen = new Set<string>();
    return getItems(state.workspaceShare.invites).filter((invite) => {
      if (
        invite.workspaceId !== workspaceId ||
        !invite.pinLogin?.trim() ||
        invite.revokedAt ||
        (invite.redeemedAt && !invite.reusable) ||
        !(Date.parse(invite.expiresAt) > roster.inviteReceivedAt)
      )
        return false;
      const identity =
        invite.pinIdentity ??
        (invite.pinGithubUserId !== undefined
          ? {
              provider: 'github',
              host: 'github.com',
              externalUserId: String(invite.pinGithubUserId),
            }
          : null);
      if (members && invite.redeemedByPrincipalId && getItem(members, invite.redeemedByPrincipalId))
        return false;
      if (!identity) return true;
      const key = JSON.stringify([
        identity.provider,
        identity.host.toLowerCase(),
        identity.externalUserId,
      ]);
      if (accepted.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
);

/** One expiry timer over the current admitted collection, never a render-time clock. */
export const selectWorkspacePeopleInviteExpiry = store.createSelector((state): number | null => {
  const scope = selectWorkspacePeopleInviteScope.select(state);
  const expiries = scope.workspaceIds.flatMap((id) =>
    selectWorkspacePeopleInvites.select(state, id).map((invite) => Date.parse(invite.expiresAt)),
  );
  return expiries.length ? Math.min(...expiries) : null;
});
