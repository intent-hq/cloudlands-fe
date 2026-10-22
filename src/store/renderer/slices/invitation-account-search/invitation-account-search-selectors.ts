import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import { selectPrincipalSnapshot } from '../principal/principal-selectors';
export const selectInvitationAccountSearch = store.createSelector(
  (state) => state.invitationAccountSearch,
);
export const selectInvitationAccountResults = store.createSelector((state) =>
  getItems(state.invitationAccountSearch.results),
);
export const selectInvitationAccountSearchSupported = store.createSelector(
  (state) => selectPrincipalSnapshot.select(state)?.capabilities.invitationAccountSearch === true,
);
