import { store } from '$store/renderer/store';
import {
  selectCollaborationCapabilities,
  selectPrincipalActionContext,
} from '$store/renderer/slices/principal/principal-selectors';

export const selectPersonalDevicesContext = store.createSelector((state) =>
  selectCollaborationCapabilities.select(state).personalPairing
    ? selectPrincipalActionContext.select(state)
    : null,
);
