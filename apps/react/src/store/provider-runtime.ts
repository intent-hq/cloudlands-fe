import { settingsClient, settingsRuntime } from '@/features/settings/settings-client';
import { store } from './index';
import { connectionsIdentitySaga } from './connections/sagas/connections-identity-saga';
import { daemonEventsSaga } from './workspace-events/sagas/daemon-events-saga';
import { principalSaga } from './principal/sagas/principal-saga';
import { hostExecutionSaga } from './host-execution/sagas/host-execution-saga';
import { workspaceAuthoritySaga } from './workspace-lifecycle/sagas/workspace-authority-saga';
import { selectMountedWorkspaceIds } from './workspace-lifecycle/workspace-lifecycle-selectors';
import { modelNameCacheSaga } from './provider-models/sagas/model-name-cache-saga';
import { createReactModelBootSaga } from './model/sagas/model-boot-saga';
import { modelReloadSaga } from './model/sagas/model-reload-saga';
import { providerAvailabilityReadSaga } from './agent-availability/sagas/provider-availability-saga';
import { createReactWorkspaceCatalogSaga } from './provider-catalog/workspace-catalog-saga';
import { settingsSaga } from './settings/sagas/settings-saga';

const modelBootSaga = createReactModelBootSaga(settingsClient);
const workspaceCatalogSaga = createReactWorkspaceCatalogSaga({
  settings: settingsClient,
  selectMountedWorkspaceIds,
});

/** Browser-root lifetime; the Store and backend connection must already be initialized. */
export function startProviderRuntime() {
  settingsRuntime.start();
  const cancelOwners = [
    store.runSaga(modelNameCacheSaga),
    store.runSaga(daemonEventsSaga),
    store.runSaga(principalSaga),
    store.runSaga(hostExecutionSaga),
    store.runSaga(settingsSaga),
    store.runSaga(workspaceAuthoritySaga),
    store.runSaga(modelBootSaga),
    store.runSaga(modelReloadSaga),
    store.runSaga(providerAvailabilityReadSaga),
    store.runSaga(workspaceCatalogSaga),
    store.runSaga(connectionsIdentitySaga),
  ];
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (let index = cancelOwners.length - 1; index >= 0; index -= 1) {
      cancelOwners[index]?.();
    }
    settingsRuntime.dispose();
  };
}
