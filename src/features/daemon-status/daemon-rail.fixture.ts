import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { take } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import {
  machineRailStateReceived,
  selectRailMachineRequested,
} from '$store/renderer/slices/machine-rail/machine-rail-slice';

export function createDaemonRailFixture(rail: boolean, onSelect: (id: string) => void) {
  const previousRail = store.state.machineRail;
  const root = document.documentElement;
  root.toggleAttribute('data-machine-rail', rail);
  const connections = getItems(store.state.connections.connections).filter(
    (connection) => connection.id !== 'audit-host' && connection.id !== 'local',
  );
  store.dispatch(
    connectionsListReceived({
      connections: [
        {
          id: 'local',
          label: 'This computer',
          host: null,
          port: null,
          fingerprint: null,
          isLocal: true,
        },
        {
          id: 'audit-host',
          label: 'Build server',
          hostname: 'Build server',
          host: 'development.example.com',
          port: 4321,
          fingerprint: null,
          isLocal: false,
          status: 'disconnected',
        },
        ...connections,
      ],
      activeId: 'audit-host',
      windowBackendId: 'audit-host',
      connectedIds: ['local'],
    }),
  );
  store.dispatch(
    machineRailStateReceived({
      enabled: rail,
      homeId: 'local',
      machineIds: ['local', 'audit-host'],
      selectedId: 'audit-host',
      shownId: 'audit-host',
      pendingId: '',
      degradedIds: [],
    }),
  );
  const stop = store.runSaga(function* () {
    while (true) {
      const {
        payload: [id],
      } = yield* take(selectRailMachineRequested);
      onSelect(id);
    }
  });
  return () => {
    stop();
    root.removeAttribute('data-machine-rail');
    store.dispatch(machineRailStateReceived(previousRail));
  };
}
