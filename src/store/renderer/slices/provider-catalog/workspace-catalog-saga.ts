import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { getProviderAuthVerdicts } from '$features/providers/provider-auth-status.client';
import { createWorkspaceCatalogReader } from './workspace-catalog-reader';
const readWorkspaceCatalog = createWorkspaceCatalogReader({
  providers: { catalog: (workspaceId) => appClient.providers.catalog(workspaceId) },
  settings: {
    list: (workspaceId) => appClient.settings.list(workspaceId),
    getMcpServers: (workspaceId) => appClient.settings.getMcpServers(workspaceId),
    getMcpServerStatuses: (ids, workspaceId) =>
      appClient.settings.getMcpServerStatuses(ids, workspaceId),
  },
  specialists: {
    get listCatalog() {
      return appClient.specialists.listCatalog?.bind(appClient.specialists);
    },
    list: (provider, workspaceId) => appClient.specialists.list(provider, workspaceId),
  },
  backendRequest,
  getProviderAuthVerdicts,
});
import { onBackendNotification, onBackendReconnected } from '$lib/client/live/backend-transport';
import { selectMountedWorkspaceIds } from '../workspace-lifecycle/workspace-lifecycle-selectors';
import {
  selectWorkspaceCatalogEpoch,
  selectSettledProviderReadiness,
  selectWorkspaceCatalogFresh,
} from './workspace-catalog-selectors';
import { selectProviderStatusMap } from '../agent-availability/agent-availability-selectors';
import { createWorkspaceCatalogSaga } from './workspace-catalog-saga-factory';

export const { workspaceCatalogSaga } = createWorkspaceCatalogSaga({
  selectMountedWorkspaceIds,
  selectWorkspaceCatalogEpoch,
  selectSettledProviderReadiness,
  selectWorkspaceCatalogFresh,
  selectProviderStatusMap,
  onBackendNotification,
  onBackendReconnected,
  readWorkspaceCatalog,
});
