import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { ConnectionRecord } from '../connections/connections-types';

export interface MachineRailItem {
  id: string;
  /** The saved machine; absent until the connections list knows this id. */
  record: ConnectionRecord | null;
  selected: boolean;
  /** The machine the window itself is bound to; it cannot be removed. */
  home: boolean;
  /** Not connected right now: shown greyed out. */
  offline: boolean;
}

/** Whether the Labs setting is on (the rail shows, even with one machine). */
export const selectMachineRailEnabled = store.createSelector(
  (state): boolean => state.machineRail.enabled,
);

/** The window's machines in rail order, joined with their saved records. */
export const selectMachineRailItems = store.createSelector((state): MachineRailItem[] => {
  const { machineIds, selectedId, homeId } = state.machineRail;
  return machineIds.map((id) => {
    const record = getItem(state.connections.connections, id) ?? null;
    return {
      id,
      record,
      selected: id === selectedId,
      home: id === homeId,
      offline: record !== null && record.status !== 'connected' && record.status !== 'connecting',
    };
  });
});

/** Saved machines that can still be added to this window's rail. */
export const selectMachineRailCandidates = store.createSelector((state): ConnectionRecord[] => {
  const inRail = new Set(state.machineRail.machineIds);
  return getItems(state.connections.connections).filter(
    (connection) => connection.daemonMode !== 'node' && !inRail.has(connection.id),
  );
});

/**
 * Whether this renderer's machine is the one the window shows. A renderer
 * that is not shown hides its page so it cannot show through another
 * machine's translucent window background.
 */
export const selectIsRailMachineShown = store.createSelector((state): boolean => {
  const { enabled, selectedId } = state.machineRail;
  return !enabled || selectedId === '' || selectedId === state.connections.windowBackendId;
});
