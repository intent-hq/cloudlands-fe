import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import type { ConnectionsListResult } from '$store/renderer/slices/connections/connections-types';
import { workspaceBulkTransferSaga } from '$store/renderer/slices/workspace-bulk-transfer/sagas/workspace-bulk-transfer-saga';
import { setupHomeMultiSelectFixtures } from './home-multi-select';
import { setupBulkTransferRelay } from './home-bulk-transfer-relay';

/** Home multi-select fixtures plus a second machine and a scripted transfer relay. */
export function setupHomeBulkTransferFixtures() {
  const disposeHome = setupHomeMultiSelectFixtures('list');
  store.dispatch(
    connectionsListReceived({
      connections: [
        { id: 'local', label: 'This Mac', host: '', port: 0, fingerprint: '', isLocal: true },
        {
          id: 'devbox',
          label: '10.0.0.2:5181',
          host: '10.0.0.2',
          port: 5181,
          fingerprint: 'AA:BB',
          isLocal: false,
          hostname: 'devbox',
        },
      ],
      activeId: 'local',
      windowBackendId: 'local',
    } as unknown as ConnectionsListResult),
  );
  const disposeRelay = setupBulkTransferRelay();
  const stopSaga = store.runSaga(workspaceBulkTransferSaga);

  return () => {
    stopSaga();
    disposeRelay();
    disposeHome();
  };
}
