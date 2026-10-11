import { eventChannel, buffers } from 'redux-saga';
import { createChannelFromSelector } from '@themislib/themis/saga';
import { call, fork, put, take, takeEvery } from 'typed-redux-saga';
import { createLogger } from '$lib/utils/client-logger';
import { takeSingleFlightInContext } from '../../utils/context-saga-effects';
import {
  workspaceMounted,
  workspaceUnmounted,
  workspaceDeleted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  workspaceCatalogRequested,
  workspaceCatalogReadStarted,
  workspaceCatalogReadFailed,
  ensureWorkspaceCatalogRequested,
  workspaceCatalogReceived,
  workspaceCatalogInvalidated,
} from './provider-catalog-slice';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';

import type * as projections1 from './workspace-catalog-projections';
import type * as projections2 from '../agent-availability/agent-availability-projections';

import type { ReadSelector, ProviderReadState } from './provider-read-types';

export function createWorkspaceCatalogSaga<State extends ProviderReadState>({
  selectMountedWorkspaceIds,
  selectWorkspaceCatalogEpoch,
  selectSettledProviderReadiness,
  selectWorkspaceCatalogFresh,
  selectProviderStatusMap,
  onBackendNotification,
  onBackendReconnected,
  readWorkspaceCatalog,
}: {
  selectMountedWorkspaceIds: import('@themislib/themis/saga').SelectorChannelSelector<
    string[],
    [],
    never
  >;
  selectWorkspaceCatalogEpoch: ReadSelector<typeof projections1.getWorkspaceCatalogEpoch, State>;
  selectSettledProviderReadiness: ReadSelector<
    typeof projections1.getSettledProviderReadiness,
    State
  >;
  selectWorkspaceCatalogFresh: ReadSelector<typeof projections1.getWorkspaceCatalogFresh, State>;
  selectProviderStatusMap: ReadSelector<typeof projections2.getProviderStatusMap, State>;
  onBackendNotification: (
    handler: (
      notification: import('$lib/client/live/backend-transport-types').BackendNotification,
    ) => void,
  ) => () => void;
  onBackendReconnected: (handler: () => void) => () => void;
  readWorkspaceCatalog: (
    workspaceId: string,
  ) => Promise<import('./provider-catalog-types').WorkspaceCatalogSnapshot>;
}) {
  const logger = createLogger('WorkspaceCatalog');

  type CatalogAction =
    | ReturnType<typeof workspaceCatalogRequested>
    | ReturnType<typeof workspaceUnmounted>
    | ReturnType<typeof workspaceDeleted>
    | ReturnType<typeof removeWorkspaceEntity>;
  function* readCatalog(pending: Set<string>, action: CatalogAction) {
    if (action.type !== workspaceCatalogRequested.type) return;
    const [workspaceId] = action.payload;
    const epoch = yield* selectWorkspaceCatalogEpoch.effect();
    pending.add(workspaceId);
    try {
      yield* put(workspaceCatalogReadStarted(workspaceId));
      const snapshot = yield* call(readWorkspaceCatalog, workspaceId);
      yield* put(workspaceCatalogReceived(workspaceId, snapshot, epoch));
    } catch (error) {
      logger.warn('Workspace catalog read failed', { workspaceId, error });
      yield* put(workspaceCatalogReadFailed(workspaceId));
    } finally {
      pending.delete(workspaceId);
    }
  }

  function* onMount(action: ReturnType<typeof workspaceMounted>) {
    yield* put(ensureWorkspaceCatalogRequested(action.payload[0]));
  }

  function* ensureCatalog(
    pending: Set<string>,
    action: ReturnType<typeof ensureWorkspaceCatalogRequested>,
  ) {
    const [workspaceId] = action.payload;
    if (!workspaceId || pending.has(workspaceId)) return;
    if (yield* selectWorkspaceCatalogFresh.effect(workspaceId)) return;
    yield* put(workspaceCatalogRequested(workspaceId));
  }

  function* refreshMountedCatalogs(resetIdentity = false) {
    yield* put(workspaceCatalogInvalidated(resetIdentity));
    const mounted = yield* selectMountedWorkspaceIds.effect();
    // Invalidating the generation abandons all old responses, so refresh all mounted contexts.
    for (const workspaceId of mounted) yield* put(workspaceCatalogRequested(workspaceId));
  }

  /** Settings rechecks can observe external CLI installation without a daemon event. */
  function* watchProviderReadiness() {
    const channel = yield* createChannelFromSelector(selectSettledProviderReadiness);
    let previous = yield* selectProviderStatusMap.effect();
    try {
      while (true) {
        const { payload } = yield* take(channel);
        // A failed or rejected stale check preserves the accepted status map.
        if (payload === null || payload === previous) continue;
        previous = payload;
        yield* refreshMountedCatalogs();
      }
    } finally {
      channel.close();
    }
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
          type === 'skills:changed' ||
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
        yield* refreshMountedCatalogs(resetIdentity);
      }
    } finally {
      channel.close();
    }
  }

  function* workspaceCatalogSaga() {
    const pending = new Set<string>();
    yield* takeSingleFlightInContext(
      [workspaceCatalogRequested, workspaceUnmounted, workspaceDeleted, removeWorkspaceEntity],
      (action: CatalogAction) =>
        action.type === workspaceCatalogRequested.type
          ? action.payload[0]
          : { context: action.payload[0], cancel: true as const },
      readCatalog,
      pending,
    );
    yield* takeEvery(ensureWorkspaceCatalogRequested, ensureCatalog, pending);
    yield* takeEvery(workspaceMounted, onMount);
    yield* fork(watchInvalidations);
    yield* fork(watchProviderReadiness);
  }

  return { workspaceCatalogSaga };
}
