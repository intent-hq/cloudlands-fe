import { store } from '$store/renderer/store';
import { installMockElectronBridge } from './ct-mock-electron-bridge';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { selectConnections } from '$store/renderer/slices/connections/connections-selectors';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '$store/renderer/slices/workspace-events/workspace-events-slice';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  principalContextChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';
import { selectPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-selectors';
import type { HostRole } from '$shared/types/principal';

import { personalDevicesSaga } from '$features/devices/personal-devices-saga';
export function setupPersonalDevicesFixture(role: HostRole) {
  const before = store.state;
  const previousConnections = selectConnections.select(before);
  const principal = {
    id: 'preview-person',
    login: null,
    displayName: null,
    avatarUrl: null,
    isAdministrator: role === 'owner',
    hostRole: role,
    hostMembershipRevision: 1,
  };
  const fixture = (arg: unknown) => {
    const { method } = arg as { method: string };
    if (method === 'pairing.getSelfInfo')
      return {
        ok: true,
        result: {
          version: 1,
          uri: 'intent://pair?v=1&host=192.0.2.8&port=5181&fp=AB&token=preview-not-a-real-credential',
          hosts: ['192.0.2.8'],
          port: 5181,
          fingerprint: 'AB',
          token: 'preview-not-a-real-credential',
          principal,
        },
      };
    if (method === 'client.list')
      return {
        ok: true,
        result: {
          clients: ['Preview phone', 'Preview tablet'].map((name, index) => ({
            clientId: `preview-${index}`,
            name,
            deviceKind: index ? 'tablet' : 'phone',
            principalId: principal.id,
            hostRole: role,
            login: null,
            displayName: null,
            avatarUrl: null,
            capabilities: {},
            connections: 1,
            transports: ['wss'],
            connectedAt: '2026-09-30T12:00:00Z',
          })),
        },
      };
    throw new Error('Unexpected RPC in personal Devices preview');
  };
  const previousApi = window.electronAPI;
  installMockElectronBridge({
    'pairing.getSelfInfo': () => fixture({ method: 'pairing.getSelfInfo' }).result,
    'client.list': () => fixture({ method: 'client.list' }).result,
  });
  store.dispatch(setLabsMultiplayerEnabled(true));
  store.dispatch(
    connectionsListReceived({
      connections: [
        {
          id: 'preview-host',
          label: 'Team development host',
          host: '192.0.2.8',
          port: 5181,
          fingerprint: 'AB',
          isLocal: false,
          status: 'connected',
        },
      ],
      activeId: 'preview-host',
      windowBackendId: 'preview-host',
    }),
  );
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(daemonEventsSubscribed());
  const context = selectPrincipalConnectionContext.select(store.state)!;
  store.dispatch(principalContextChanged(context));
  const { invalidation, presentationVersion } = store.state.principal;
  store.dispatch(
    principalReceived(
      { context, invalidation, presentationVersion },
      {
        principal,
        capabilities: {
          hostMembership: true,
          personalPairing: true,
          authenticatedDevices: true,
          collaborationIdentity: true,
        },
      },
    ),
  );
  const stop = store.runSaga(personalDevicesSaga);
  return () => {
    stop();
    window.electronAPI = previousApi;
    store.dispatch(setLabsMultiplayerEnabled(before.userPreferences.labsMultiplayerEnabled));
    store.dispatch(
      connectionsListReceived({
        connections: previousConnections,
        activeId: before.connections.activeId,
        windowBackendId: before.connections.windowBackendId,
      }),
    );
    store.dispatch(principalContextChanged(null));
  };
}
