import { hostExecutionConnectionChanged } from '../host-execution/host-execution-slice';
/**
 * Provider Catalog Slice
 *
 * Holds the daemon's static provider registry (`providers.catalog`,
 * PROTOCOL §5.38) exactly as sent on the wire — the daemon owns the registry
 * and the `visible` gating verdict; nothing is healed or re-derived here.
 * Hydrated by the root-owned provider availability saga at startup and on
 * backend reconnect (the daemon binary — and therefore the registry — may
 * have changed across a restart).
 */
import {
  workspaceUnmounted,
  workspaceDeleted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import type { ProviderCatalogResult } from '$shared/provider-catalog';
import type {
  ProviderCatalogEntry,
  ProviderCatalogState,
  WorkspaceCatalogSnapshot,
} from './provider-catalog-types';

export const initialState: ProviderCatalogState = {
  providers: createCollection<ProviderCatalogEntry, 'id'>('id'),
  loaded: false,
};

/**
 * A `providers.catalog` response landed — replace the whole catalog (the
 * registry is atomic; the daemon never sends partial rows).
 */
export const providerCatalogLoaded = createAction<[catalog: ProviderCatalogResult]>(
  'providerCatalog/providerCatalogLoaded',
);

export const providerCatalogReducer = createReducer<ProviderCatalogState>(initialState);
providerCatalogReducer.with(providerCatalogLoaded, (state, { payload: [catalog] }) => ({
  ...state,
  providers: createCollection<ProviderCatalogEntry, 'id'>('id', catalog.providers),
  loaded: true,
}));

providerCatalogReducer.with(hostExecutionConnectionChanged, (state) => ({
  ...initialState,
  workspaceEpoch: (state.workspaceEpoch ?? 0) + 1,
}));
/** Mount demand reuses a hydrated catalog; explicit refreshes use workspaceCatalogRequested. */
export const ensureWorkspaceCatalogRequested = createAction<[workspaceId: string]>(
  'providerCatalog/ensureWorkspaceCatalogRequested',
);
export const workspaceCatalogRequested = createAction<[workspaceId: string]>(
  'providerCatalog/workspaceCatalogRequested',
);
/** Each admitted read needs a new successful snapshot, including trailing refreshes. */
export const workspaceCatalogReadStarted = createAction<[workspaceId: string]>(
  'providerCatalog/workspaceCatalogReadStarted',
);
/** Read failure signal for operations waiting for a refreshed sidebar catalog. */
export const workspaceCatalogReadFailed = createAction<[workspaceId: string]>(
  'providerCatalog/workspaceCatalogReadFailed',
);
export const workspaceCatalogReceived = createAction<
  [workspaceId: string, snapshot: WorkspaceCatalogSnapshot, epoch: number]
>('providerCatalog/workspaceCatalogReceived');
export const workspaceCatalogInvalidated = createAction<[connectionChanged?: boolean]>(
  'providerCatalog/workspaceCatalogInvalidated',
);
providerCatalogReducer.with(workspaceCatalogReadStarted, (state, { payload: [workspaceId] }) => {
  const { [workspaceId]: _removed, ...workspaceSnapshotEpochs } =
    state.workspaceSnapshotEpochs ?? {};
  return { ...state, workspaceSnapshotEpochs };
});
providerCatalogReducer.with(
  workspaceCatalogReceived,
  (state, { payload: [workspaceId, snapshot, epoch] }) =>
    epoch !== (state.workspaceEpoch ?? 0)
      ? state
      : {
          ...state,
          byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: snapshot },
          workspaceSnapshotEpochs: { ...state.workspaceSnapshotEpochs, [workspaceId]: epoch },
          mcpServerNamesByWorkspaceId: {
            ...state.mcpServerNamesByWorkspaceId,
            [workspaceId]: Object.fromEntries(
              (snapshot.mcpServers ?? []).flatMap((server) =>
                server.id ? [[server.id, server.name]] : [],
              ),
            ),
          },
        },
);
providerCatalogReducer.with(
  workspaceCatalogInvalidated,
  (state, { payload: [connectionChanged] }) => ({
    ...state,
    // Keep the last successful snapshot during a refresh; a changed connection
    // must discard it so data from another daemon cannot leak into this one.
    byWorkspaceId: connectionChanged ? {} : state.byWorkspaceId,
    mcpServerNamesByWorkspaceId: connectionChanged ? {} : state.mcpServerNamesByWorkspaceId,
    workspaceEpoch: (state.workspaceEpoch ?? 0) + 1,
  }),
);

function clearWorkspaceCatalog(
  state: ProviderCatalogState,
  workspaceId: string,
): ProviderCatalogState {
  const { [workspaceId]: _removed, ...byWorkspaceId } = state.byWorkspaceId ?? {};
  const { [workspaceId]: _removedNames, ...mcpServerNamesByWorkspaceId } =
    state.mcpServerNamesByWorkspaceId ?? {};
  const { [workspaceId]: _removedEpoch, ...workspaceSnapshotEpochs } =
    state.workspaceSnapshotEpochs ?? {};
  return { ...state, byWorkspaceId, mcpServerNamesByWorkspaceId, workspaceSnapshotEpochs };
}
providerCatalogReducer.with(workspaceUnmounted, (state, { payload: [id] }) =>
  clearWorkspaceCatalog(state, id),
);
providerCatalogReducer.with(workspaceDeleted, (state, { payload: [id] }) =>
  clearWorkspaceCatalog(state, id),
);

providerCatalogReducer.with(removeWorkspaceEntity, (state, { payload: [id] }) =>
  clearWorkspaceCatalog(state, id),
);
