import { eventChannel, buffers } from 'redux-saga';
import { call, fork, put, take, takeEvery } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import { getProviderAuthVerdicts } from '$features/providers/provider-auth-status.client';
import { createLogger } from '$lib/utils/client-logger';
import { takeSingleFlightInContext } from '../../utils/context-saga-effects';
import { selectMountedWorkspaceIds } from '../workspace-lifecycle/workspace-lifecycle-selectors';
import {
  workspaceMounted,
  workspaceUnmounted,
  workspaceDeleted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  workspaceCatalogRequested,
  workspaceCatalogReceived,
  workspaceCatalogInvalidated,
} from './provider-catalog-slice';
import { selectWorkspaceCatalogEpoch } from './workspace-catalog-selectors';

import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import { copyServerForState } from '../mcp-settings/mcp-settings-normalization';

const logger = createLogger('WorkspaceCatalog');

type CatalogAction =
  | ReturnType<typeof workspaceCatalogRequested>
  | ReturnType<typeof workspaceUnmounted>
  | ReturnType<typeof workspaceDeleted>
  | ReturnType<typeof removeWorkspaceEntity>;
function* readCatalog(action: CatalogAction) {
  if (action.type !== workspaceCatalogRequested.type) return;
  const [workspaceId] = action.payload;
  const epoch = yield* selectWorkspaceCatalogEpoch.effect();
  try {
    const [catalog, settings, specialists, discovery, auth, mcpServers] = yield* call(async () =>
      Promise.all([
        appClient.providers.catalog(workspaceId),
        appClient.settings.list(workspaceId),
        appClient.specialists.list(undefined, workspaceId),
        backendRequest<{
          providers: Array<{
            id: string;
            installed: boolean;
            gatedOff?: string | null;
            hasNpxFallback?: boolean;
          }>;
        }>('host.providerDiscovery', { workspaceId }),
        getProviderAuthVerdicts({ workspaceId }),
        appClient.settings.getMcpServers(workspaceId),
      ]),
    );
    // Discovery's Claude adapter probe does not replace its CLI prerequisite.
    const claude = discovery.providers.find((provider) => provider.id === 'claude-code');
    const claudeCli = claude?.installed
      ? yield* call(backendRequest<{ available: boolean }>, 'host.findBinary', {
          name: 'claude',
          workspaceId,
        })
      : undefined;
    const mcpStatuses = yield* call(
      [appClient.settings, appClient.settings.getMcpServerStatuses],
      mcpServers.flatMap((server) => (server.id ? [server.id] : [])),
      workspaceId,
    );
    yield* put(
      workspaceCatalogReceived(
        workspaceId,
        {
          catalog,
          settings,
          specialists,
          mcpServers: mcpServers.map(copyServerForState),
          mcpStatuses,
          readiness: Object.fromEntries(
            discovery.providers.map((p) => [
              p.id,
              {
                available:
                  p.installed &&
                  !p.gatedOff &&
                  (p.id !== 'claude-code' || claudeCli?.available === true),
                ...auth[p.id],
                hasNpxFallback: p.hasNpxFallback,
              },
            ]),
          ),
        },
        epoch,
      ),
    );
  } catch (error) {
    logger.warn('Workspace catalog read failed', { workspaceId, error });
  }
}

function* onMount(action: ReturnType<typeof workspaceMounted>) {
  yield* put(workspaceCatalogRequested(action.payload[0]));
}

function* watchInvalidations() {
  let connectionChanged = false;
  const channel = eventChannel<true>((emit) => {
    const offNotification = onBackendNotification((notification) => {
      const params = notification.params as
        | { type?: string; workspaceId?: string; event?: { type?: string; workspaceId?: string } }
        | undefined;
      const event = params?.event ?? params;
      const type = notification.method === 'events.event' ? event?.type : notification.method;
      if (
        type === 'settings:changed' ||
        type === 'specialists:changed' ||
        type === 'provider:auth-changed' ||
        type?.startsWith('mcp.servers:') ||
        (type === 'workspace:updated' &&
          !!(event as { data?: { changes?: { mcpServerToggled?: unknown } } })?.data?.changes
            ?.mcpServerToggled)
      ) {
        // An unqualified daemon event invalidates every context; never attribute its payload to focus.
        emit(true);
      }
    });
    const offReconnect = onBackendReconnected(() => {
      connectionChanged = true;
      emit(true);
    });
    return () => {
      offNotification();
      offReconnect();
    };
  }, buffers.sliding(1));
  try {
    while (true) {
      yield* take(channel);
      const resetIdentity = connectionChanged;
      connectionChanged = false;
      yield* put(workspaceCatalogInvalidated(resetIdentity));
      const mounted = yield* selectMountedWorkspaceIds.effect();
      // Invalidating the generation abandons all old responses, so refresh all mounted contexts.
      for (const workspaceId of mounted) yield* put(workspaceCatalogRequested(workspaceId));
    }
  } finally {
    channel.close();
  }
}

export function* workspaceCatalogSaga() {
  yield* takeSingleFlightInContext(
    [workspaceCatalogRequested, workspaceUnmounted, workspaceDeleted, removeWorkspaceEntity],
    (action: CatalogAction) =>
      action.type === workspaceCatalogRequested.type
        ? action.payload[0]
        : { context: action.payload[0], cancel: true as const },
    readCatalog,
  );
  yield* takeEvery(workspaceMounted, onMount);
  yield* fork(watchInvalidations);
}
