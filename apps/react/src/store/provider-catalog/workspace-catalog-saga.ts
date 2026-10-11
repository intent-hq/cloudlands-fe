import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
} from '@/features/backend/backend-transport';
import {
  providers,
  listSpecialistCatalog,
  getProviderAuthVerdicts,
} from '@/features/providers/provider-read-clients';
import { selectProviderStatusMap } from '../agent-availability/agent-availability-selectors';
import {
  selectWorkspaceCatalogEpoch,
  selectSettledProviderReadiness,
  selectWorkspaceCatalogFresh,
} from './workspace-catalog-selectors';
import {
  createWorkspaceCatalogReader,
  type WorkspaceCatalogReaders,
} from '../../../../../src/store/renderer/slices/provider-catalog/workspace-catalog-reader';
import { createWorkspaceCatalogSaga } from '../../../../../src/store/renderer/slices/provider-catalog/workspace-catalog-saga-factory';

/** Full snapshot only; the root binds canonical workspace lifetime and real settings reads. */
export function createReactWorkspaceCatalogSaga({
  settings,
  selectMountedWorkspaceIds,
}: {
  settings: WorkspaceCatalogReaders['settings'];
  selectMountedWorkspaceIds: Parameters<
    typeof createWorkspaceCatalogSaga
  >[0]['selectMountedWorkspaceIds'];
}) {
  const readWorkspaceCatalog = createWorkspaceCatalogReader({
    providers,
    settings,
    backendRequest,
    getProviderAuthVerdicts,
    specialists: {
      listCatalog: listSpecialistCatalog,
      list: async (provider, workspaceId) =>
        (await listSpecialistCatalog(provider, workspaceId)).specialists,
    },
  });
  return createWorkspaceCatalogSaga({
    readWorkspaceCatalog,
    onBackendNotification,
    onBackendReconnected,
    selectMountedWorkspaceIds,
    selectWorkspaceCatalogEpoch,
    selectSettledProviderReadiness,
    selectWorkspaceCatalogFresh,
    selectProviderStatusMap,
  }).workspaceCatalogSaga;
}
