import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { m } from '$shared/paraglide/messages.js';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { formatConnectionLabel } from '$lib/utils/connection-label';
import { store } from '$store/renderer/store';
import { selectLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import {
  selectProviderCatalogDefaultRemoteIncompatibility,
  selectProviderCatalogProfiles,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { remoteModelSwitchSupport, type RemoteModelSwitchSupport } from './remote-model-picker';
import {
  resolveStartOn,
  START_ON_BACKEND,
  startOnOptions,
  startOnVisible,
  type StartOnOption,
} from './start-on';

/**
 * Every remote-machine surface shows only while the Labs "Remote agents" flag
 * is on AND the current backend advertises `remoteMachines: 1`. Turning the
 * flag off hides them; it revokes nothing.
 */
export const selectRemoteMachinesVisible = store.createSelector(
  (state) =>
    selectLabsRemoteAgentsEnabled.select(state) && state.remoteMachines?.supported === true,
);

/** The current backend's exposed machines, by name. */
export const selectRemoteMachines = store.createSelector((state): RemoteMachine[] =>
  Object.values(state.remoteMachines?.machines ?? {}).sort((a, b) => a.name.localeCompare(b.name)),
);

/** This computer's own daemon certificate fingerprint (matches the local row). */
export const selectLocalMachineFingerprint = store.createSelector(
  (state) => state.remoteMachines.localFingerprint,
);

export const selectRemoteMachineOperations = store.createSelector(
  (state) => state.remoteMachines.pending,
);

export const selectRemoteMachineFailures = store.createSelector(
  (state) => state.remoteMachines.failures,
);

/** Backends this machine is available to; empty hides the section. */
export const selectExecutorBackends = store.createSelector(
  (state) => state.remoteMachines.executorBackends ?? [],
);

/** Display label of a saved connection: "This machine (local)" or its configured name. */
export const selectConnectionLabel = store.createSelector((state, connectionId: string) => {
  if (connectionId === LOCAL_CONNECTION_ID) return m.layout_daemonStatus_localConnection_label();
  const connection = getItem(state.connections.connections, connectionId);
  return connection ? formatConnectionLabel(connection) : connectionId;
});

/** The current backend's display label, as used in "Make available to <backend>". */
export const selectCurrentBackendLabel = store.createSelector((state) =>
  selectConnectionLabel.select(state, state.connections.windowBackendId),
);

/**
 * The current backend's `remoteMachines.list` row for `machineId`, or null.
 * Not gated on the Labs flag: rows are only loaded while it is on, and agent
 * location badges fall back to the agent's own fields without one.
 */
export const selectRemoteMachine = store.createSelector(
  (state, machineId?: string): RemoteMachine | null =>
    (machineId ? state.remoteMachines.machines[machineId] : undefined) ?? null,
);

/**
 * Whether the backend lets a remote agent switch its model (see
 * `remoteModelSwitchSupport`). Reads the profile list's Default rows when
 * the catalog alone can't tell.
 */
export const selectRemoteModelSwitchSupport = store.createSelector(
  (state, workspaceId?: string): RemoteModelSwitchSupport => {
    const profiles = state.providerSettings?.profiles;
    return remoteModelSwitchSupport({
      catalogProfiles: selectProviderCatalogProfiles.select(state, workspaceId),
      defaultRemoteIncompatibility: selectProviderCatalogDefaultRemoteIncompatibility.select(
        state,
        workspaceId,
      ),
      profileDefaults: Object.values(profiles?.defaults ?? {}),
      profilesLoadStatus: profiles?.loadStatus ?? 'idle',
    });
  },
);

/**
 * Whether each base provider's Default saves env overrides, from the
 * admin-only profile list's Default rows; empty until that list is read.
 */
export const selectDefaultHasOverrides = store.createSelector((state): Record<string, boolean> =>
  Object.fromEntries(
    Object.values(state.providerSettings?.profiles?.defaults ?? {}).map((config) => [
      config.baseProviderId,
      config.env.length > 0,
    ]),
  ),
);

/**
 * New Workspace → Start On shows: remote surfaces on, the backend accepts an
 * initial-agent placement (`remoteInitialAgent: 1`), and another machine is
 * usable.
 */
export const selectStartOnVisible = store.createSelector((state) =>
  startOnVisible({
    remoteMachinesVisible: selectRemoteMachinesVisible.select(state),
    supported: state.remoteMachines?.initialAgentPlacement === true,
    machines: selectRemoteMachines.select(state),
  }),
);

/** The backend first (by its label), then each machine available to it; empty while hidden. */
export const selectStartOnOptions = store.createSelector((state): StartOnOption[] =>
  selectStartOnVisible.select(state)
    ? startOnOptions({
        backendLabel: selectCurrentBackendLabel.select(state),
        machines: selectRemoteMachines.select(state),
      })
    : [],
);

/**
 * The machine the first agent starts on for a remembered choice: that
 * machine while the row shows and it is usable, else the backend ('').
 */
export const selectEffectiveStartOn = store.createSelector((state, remembered?: string): string =>
  selectStartOnVisible.select(state)
    ? resolveStartOn(remembered, selectRemoteMachines.select(state))
    : START_ON_BACKEND,
);
