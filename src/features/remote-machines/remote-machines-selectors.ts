import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { m } from '$shared/paraglide/messages.js';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { formatConnectionLabel } from '$lib/utils/connection-label';
import { store } from '$store/renderer/store';
import { selectLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';

/**
 * Every remote-machine surface shows only while the Labs "Remote agents" flag
 * is on AND the current backend advertises `remoteMachines: 1`. Turning the
 * flag off hides them; it revokes nothing.
 */
export const selectRemoteMachinesVisible = store.createSelector(
  (state) => selectLabsRemoteAgentsEnabled.select(state) && state.remoteMachines.supported === true,
);

/** The current backend's exposed machines, by name. */
export const selectRemoteMachines = store.createSelector((state): RemoteMachine[] =>
  Object.values(state.remoteMachines.machines).sort((a, b) => a.name.localeCompare(b.name)),
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
