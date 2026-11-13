import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { m } from '$shared/paraglide/messages.js';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { MachineOrderRow, RemoteMachine } from '$shared/types/remote-machines';
import { formatConnectionLabel } from '$lib/utils/connection-label';
import { store } from '$store/renderer/store';
import { selectLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import { selectIsOrchestratorBackend } from '$store/renderer/slices/principal/principal-selectors';
import {
  selectProviderCatalogDefaultRemoteIncompatibility,
  selectProviderCatalogDefaultRemoteLaunch,
  selectProviderCatalogProfiles,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { selectRemoteReadyProfilesSupported } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { remoteModelSwitchSupport, type RemoteModelSwitchSupport } from './remote-model-picker';
import { sortByMachineOrder } from './machine-order';
import {
  cloudProfileBlockReason,
  startOnCloud,
} from '$features/cloud-machines/cloud-machines-selectors';
import {
  resolveStartOn,
  START_ON_BACKEND,
  startOnOptions,
  startOnVisible,
  type StartOnCloud,
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

/**
 * Remote-ready marks and the Default's "Use on remote machines" option: only
 * with remote machines visible and a backend that stores the choice. Never on
 * an orchestrator, where every profile counts as remote-compatible without
 * the mark (PROTOCOL `provider-profiles.md` → "Profiles on an orchestrator").
 */
export const selectRemoteReadyProfilesVisible = store.createSelector(
  (state) =>
    selectRemoteMachinesVisible.select(state) &&
    selectRemoteReadyProfilesSupported.select(state) &&
    !selectIsOrchestratorBackend.select(state),
);

/**
 * Settings → Machines shows one ordered list: remote surfaces on, the backend
 * advertises exactly `machineOrder: 1`, and its list was read.
 */
export const selectMachineOrderVisible = store.createSelector(
  (state) =>
    selectRemoteMachinesVisible.select(state) &&
    state.remoteMachines.machineOrder === true &&
    state.remoteMachines.order !== null,
);

/** The backend's ordered machine list (first = preferred); empty while hidden. */
export const selectMachineOrder = store.createSelector((state): MachineOrderRow[] =>
  selectMachineOrderVisible.select(state) ? (state.remoteMachines.order ?? []) : [],
);

/** A reorder is in flight. */
export const selectMachineOrderSaving = store.createSelector(
  (state) => state.remoteMachines.orderSaving !== null,
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

/** The current backend's display label, as used in "Let <backend> run agents here". */
export const selectCurrentBackendLabel = store.createSelector((state) =>
  selectConnectionLabel.select(state, state.connections.windowBackendId),
);

/**
 * The current backend's `remoteMachines.list` row for `machineId` (or its
 * `cloudMachines.list` sandbox row), or null.
 * Not gated on the Labs flag: rows are only loaded while it is on, and agent
 * location badges fall back to the agent's own fields without one.
 */
export const selectRemoteMachine = store.createSelector(
  (state, machineId?: string): RemoteMachine | null =>
    (machineId
      ? (state.remoteMachines.machines[machineId] ?? state.cloudMachines?.machines[machineId])
      : undefined) ?? null,
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
      defaultRemoteLaunch: selectProviderCatalogDefaultRemoteLaunch.select(state, workspaceId),
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
    cloud: startOnCloud(state),
  }),
);

/** The current backend's own host platform, from the connections list (only while connected). */
function backendHostPlatform(state: Parameters<typeof selectCurrentBackendLabel.select>[0]) {
  const connection = getItem(state.connections.connections, state.connections.windowBackendId);
  return connection?.hostOs ? { os: connection.hostOs, arch: connection.hostArch } : undefined;
}

/**
 * The backend first (by its label), then each machine available to it, usable
 * or not; in the stored order with `machineOrder: 1`. On an orchestrator the
 * first row is "First available machine" (no placement) instead of the
 * backend, and it stays first: the list it walks has no row for the backend.
 */
export const selectStartOnRows = store.createSelector((state): StartOnOption[] => {
  const orchestrator = selectIsOrchestratorBackend.select(state);
  const options = startOnOptions({
    backendLabel: selectCurrentBackendLabel.select(state),
    backendPlatform: backendHostPlatform(state),
    machines: selectRemoteMachines.select(state),
    cloud: startOnCloud(state),
    orchestrator,
  });
  if (!selectMachineOrderVisible.select(state)) return options;
  // With `machineOrder: 1` the rows follow the user's ordered machine list.
  if (!orchestrator) return sortByMachineOrder(options, selectMachineOrder.select(state));
  const [first, ...machines] = options;
  return [first, ...sortByMachineOrder(machines, selectMachineOrder.select(state))];
});

/** `selectStartOnRows`; empty while hidden. */
export const selectStartOnOptions = store.createSelector((state): StartOnOption[] =>
  selectStartOnVisible.select(state) ? selectStartOnRows.select(state) : [],
);

/** The backend accepts `workspace.create.initialAgent.placement` (`remoteInitialAgent: 1`). */
export const selectInitialAgentPlacementSupported = store.createSelector(
  (state) => state.remoteMachines?.initialAgentPlacement === true,
);

/**
 * The machine the first agent starts on for a remembered choice: that
 * machine while the row shows and it is usable, else the backend ('').
 */
export const selectEffectiveStartOn = store.createSelector(
  (state, remembered?: string, providerRef?: string): string =>
    selectStartOnVisible.select(state)
      ? resolveStartOn(
          remembered,
          selectRemoteMachines.select(state),
          startOnCloudFor(state, providerRef),
        )
      : START_ON_BACKEND,
);

/**
 * The E2B rows for a model: an entry is unavailable when the configuration
 * can't run on E2B (no API key or token) or its templates lack the CLI.
 * Without a model only each entry's state counts.
 */
function startOnCloudFor(
  state: Parameters<typeof startOnCloud>[0],
  providerRef?: string,
): StartOnCloud | null {
  const cloud = startOnCloud(state);
  if (!cloud || !providerRef) return cloud;
  const providers = state.cloudMachines?.providers ?? {};
  return cloud.map((row) => {
    if (row.unavailableReason) return row;
    const blocked = cloudProfileBlockReason(
      state,
      providerRef,
      providers[row.cloudMachineId] ?? null,
    );
    return blocked ? { ...row, unavailableReason: blocked } : row;
  });
}

/** `startOnCloudFor` as a store, for the picker. */
export const selectStartOnCloud = store.createSelector(
  (state, providerRef?: string): StartOnCloud | null => startOnCloudFor(state, providerRef),
);
