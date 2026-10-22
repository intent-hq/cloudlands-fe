import { store } from '$store/renderer/store';
import {
  selectSettingsForm,
  selectSettingsFormById,
} from '../settings-events/settings-events-selectors';
import type { SettingsFormIdentity } from '../settings-events/settings-events-types';
import type { WebSocketApiSnapshot } from './websocket-api-types';

export const selectWebsocketApiSnapshot = store.createSelector(
  (state, identity: SettingsFormIdentity): WebSocketApiSnapshot => {
    const values = selectSettingsForm.select(state, identity)?.values;
    return {
      enabled: values?.enabled === true,
      persistedPort: typeof values?.persistedPort === 'number' ? values.persistedPort : 5181,
      port: typeof values?.port === 'number' ? values.port : null,
      certFingerprint: typeof values?.certFingerprint === 'string' ? values.certFingerprint : '',
      localIps: Array.isArray(values?.localIps) ? values.localIps : [],
      availableIps: Array.isArray(values?.availableIps) ? values.availableIps : null,
      bindIps: Array.isArray(values?.bindIps) ? values.bindIps : [],
      bindAddressSupported: values?.bindAddressSupported === true,
      tunnelEnabled: values?.tunnelEnabled === true,
      tunnelOnly: values?.tunnelOnly === true,
      tunnelSupported: values?.tunnelSupported === true,
      tcAddress: typeof values?.tcAddress === 'string' ? values.tcAddress : '',
    };
  },
);

export const selectWebsocketApiSnapshotById = store.createSelector((state, formId: string) =>
  selectWebsocketApiSnapshot.select(
    state,
    selectSettingsFormById.select(state, formId) ?? { formId, sessionId: '' },
  ),
);
