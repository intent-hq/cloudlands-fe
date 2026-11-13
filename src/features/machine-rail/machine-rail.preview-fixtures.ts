import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { put, take } from 'typed-redux-saga';
import type { ConnectionRecord } from '$shared/types/connections';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import {
  machineRailStateReceived,
  removeRailMachineRequested,
  selectRailMachineRequested,
} from '$store/renderer/slices/machine-rail/machine-rail-slice';
import { store as appStore } from '$store/renderer/store';

type Scenario =
  'missing-home' | 'restored-home' | 'retained-home' | 'missing-secondary' | 'pending-home';

function connection(id: string, label: string): ConnectionRecord {
  return {
    id,
    label,
    host: '192.0.2.10',
    port: 5181,
    fingerprint: null,
    isLocal: false,
    status: id === 'offline-machine' ? 'disconnected' : 'connected',
    detectedDeviceKind: id === 'cloud-machine' ? 'cloudVm' : 'desktop',
  };
}

const guest: GuestSessionRecord = {
  id: 'guest-machine',
  label: 'guest.example:5181',
  host: 'guest.example',
  hosts: ['guest.example'],
  port: 5181,
  fingerprint: 'preview-guest',
  tcAddress: null,
  hostname: 'Guest host',
  principalId: 'preview-person',
  login: null,
  tokenEncrypted: true,
  workspaces: [],
  updatedAt: 0,
};

export function createMachineRailPreview(onSelect: (id: string) => void) {
  const previous = appStore.state;
  const previousConnections = getItems(previous.connections.connections);
  const stop = appStore.runSaga(function* () {
    while (true) {
      const action = yield* take([selectRailMachineRequested, removeRailMachineRequested]);
      const id = action.payload[0] as string;
      if (action.type === selectRailMachineRequested.type) onSelect(id);
      else {
        const rail = appStore.state.machineRail;
        yield* put(
          machineRailStateReceived({
            ...rail,
            machineIds: rail.machineIds.filter((item) => item !== id),
          }),
        );
      }
    }
  });

  return {
    update(scenario: Scenario) {
      appStore.dispatch(
        connectionsListReceived({
          connections: [
            connection('cloud-machine', 'reliablesite'),
            connection('offline-machine', 'Build server'),
            ...(scenario === 'restored-home' || scenario === 'missing-secondary'
              ? [connection('home-machine', 'Home workstation')]
              : []),
            ...(scenario === 'retained-home'
              ? [
                  { ...connection('home-machine', 'Home workstation'), displayOnly: true as const },
                  {
                    ...connection('other-window-machine', 'Other window machine'),
                    displayOnly: true as const,
                  },
                  connection('saved-machine', 'Saved machine'),
                ]
              : []),
          ],
          activeId: 'cloud-machine',
          windowBackendId: 'cloud-machine',
        }),
      );
      appStore.dispatch(
        guestSessionsListReceived({
          sessions: [guest],
          openIds: [guest.id],
          connectedIds: [guest.id],
        }),
      );
      appStore.dispatch(
        machineRailStateReceived({
          enabled: true,
          homeId: 'home-machine',
          machineIds: [
            'home-machine',
            'cloud-machine',
            scenario === 'missing-secondary' ? 'unknown-machine' : 'offline-machine',
            guest.id,
          ],
          selectedId: 'cloud-machine',
          shownId: 'cloud-machine',
          pendingId: scenario === 'pending-home' ? 'home-machine' : '',
          degradedIds: [],
        }),
      );
    },
    dispose() {
      stop();
      appStore.dispatch(
        connectionsListReceived({
          connections: previousConnections,
          activeId: previous.connections.activeId,
          windowBackendId: previous.connections.windowBackendId,
        }),
      );
      appStore.dispatch(
        guestSessionsListReceived({
          sessions: getItems(previous.guestSessions.sessions),
          openIds: previous.guestSessions.openIds,
          connectedIds: previous.guestSessions.connectedIds,
        }),
      );
      appStore.dispatch(machineRailStateReceived(previous.machineRail));
    },
  };
}
