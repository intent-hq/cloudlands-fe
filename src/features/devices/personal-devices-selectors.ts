import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '$store/renderer/store';
import {
  selectCollaborationCapabilities,
  selectPrincipalActionContext,
  selectPrincipalSnapshot,
} from '$store/renderer/slices/principal/principal-selectors';
import { selectLiveClients } from '$store/renderer/slices/browser-clients/browser-clients-selectors';

export const selectPersonalDevicesContext = store.createSelector((state) => {
  const capabilities = selectCollaborationCapabilities.select(state);
  return capabilities.personalPairing || capabilities.authenticatedDevices
    ? JSON.stringify([
        selectPrincipalActionContext.select(state),
        capabilities.personalPairing,
        capabilities.authenticatedDevices,
      ])
    : null;
});

export const selectPersonalDevicesSession = store.createSelector((state) => {
  const context = selectPersonalDevicesContext.select(state);
  if (!context || !state.settingsEvents) return null;
  const form = getItems(state.settingsEvents.forms).find((f) => f.kind === 'personal-devices');
  return context && form ? JSON.stringify([context, form.formId, form.sessionId]) : null;
});

export const selectPersonalDevices = store.createSelector((state) => {
  const context = selectPersonalDevicesContext.select(state);
  const principal = selectPrincipalSnapshot.select(state)?.principal;
  if (!context || !principal || state.browserClients.authenticatedContext !== context) return [];
  return selectLiveClients
    .select(state)
    .filter(
      (client) =>
        client.principalId &&
        client.hostRole &&
        (principal.hostRole !== 'guest' || client.principalId === principal.id),
    );
});
