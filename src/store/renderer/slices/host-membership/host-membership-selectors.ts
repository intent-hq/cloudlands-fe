import { store } from '../../store';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  selectCollaborationCapabilities,
  selectPrincipalActionContext,
} from '../principal/principal-selectors';
export const selectHostMembershipContext = store.createSelector((state) =>
  selectCollaborationCapabilities.select(state).manageHostMembers
    ? selectPrincipalActionContext.select(state)
    : null,
);
export const selectHostMembershipState = store.createSelector((state) => state.hostMembership);
export const selectHostMembers = store.createSelector((state) =>
  getItems(state.hostMembership.members),
);
export const selectHostInvites = store.createSelector((state) =>
  getItems(state.hostMembership.invites),
);

/** Only a mounted, admitted owner with authenticated client support may read the host roster. */
export const selectHostUserPresenceSession = store.createSelector((state) => {
  const { target, withheld } = state.hostMembership;
  const context = selectHostMembershipContext.select(state);
  return target &&
    !withheld &&
    context === target.context &&
    selectCollaborationCapabilities.select(state).authenticatedDevices
    ? JSON.stringify([target.session, context])
    : null;
});
export const selectHostUserPresence = store.createSelector((state) => {
  const session = selectHostUserPresenceSession.select(state);
  const presence = state.hostMembership.presence;
  return session && presence.session === session ? presence : null;
});
