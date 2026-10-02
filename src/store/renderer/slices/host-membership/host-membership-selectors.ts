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
