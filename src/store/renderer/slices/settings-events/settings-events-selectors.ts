import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '$store/renderer/store';
import type { SettingsFormIdentity, SettingsFormRequest } from './settings-events-types';
import { getActiveBackendId } from '../../utils/backend-storage-namespace';

export const selectSettingsMigrationContext = store.createSelector((state) => ({
  backendId: getActiveBackendId(state),
  connectionsReady: !state.connections || state.connections.hasReceivedList,
  model: state.model,
  providerSettings: state.providerSettings,
}));

export const selectSettingsFormById = store.createSelector((state, formId: string) =>
  getItem(state.settingsEvents.forms, formId),
);

export const selectSettingsFormOperationById = store.createSelector(
  (state, formId: string, resource: string) => {
    const form = selectSettingsFormById.select(state, formId);
    return form ? getItem(form.operations, resource) : undefined;
  },
);

export const selectSettingsForm = store.createSelector((state, identity: SettingsFormIdentity) => {
  const form = getItem(state.settingsEvents.forms, identity.formId);
  return form?.sessionId === identity.sessionId ? form : undefined;
});

export const selectSettingsFormEntry = store.createSelector(
  (state, identity: SettingsFormIdentity, path: string) => {
    const form = selectSettingsForm.select(state, identity);
    return form ? getItem(form.entries, path) : undefined;
  },
);

export const selectSettingsFormEntries = store.createSelector(
  (state, identity: SettingsFormIdentity) => {
    const form = selectSettingsForm.select(state, identity);
    return Object.fromEntries(
      (form ? getItems(form.entries) : []).map((entry) => [entry.path, entry]),
    );
  },
);

export const selectSettingsFormOperation = store.createSelector(
  (state, identity: SettingsFormIdentity, resource: string) => {
    const form = selectSettingsForm.select(state, identity);
    return form ? getItem(form.operations, resource) : undefined;
  },
);

export const selectSettingsFormRequestCurrent = store.createSelector(
  (state, request: SettingsFormRequest) => {
    const operation = selectSettingsFormOperation.select(state, request, request.resource);
    return operation?.requestId === request.requestId && operation.status === 'pending';
  },
);

export const selectSettingsFormError = store.createSelector(
  (state, identity: SettingsFormIdentity) => {
    const form = selectSettingsForm.select(state, identity);
    return form
      ? (getItems(form.operations).find((operation) => operation.error)?.error ?? '')
      : '';
  },
);
