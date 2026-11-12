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
  /** The machine this renderer serves; its status menu opens from this item. */
  own: boolean;
  /** Not connected right now: shown greyed out. */
  offline: boolean;
}

/** Whether the Labs setting is on (the rail shows, even with one machine). */
export const selectMachineRailEnabled = store.createSelector(
  // Optional chaining: partial test stores mount shell components without this slice.
  (state): boolean => state.machineRail?.enabled ?? false,
);

/**
 * Whether the rail is drawn: the lab is on and there is something to switch
 * to or add. With only this machine saved, the rail would be a column holding
 * one button, so the window keeps its usual layout until a second machine is
 * saved in Settings (or is already in this window).
 */
export const selectMachineRailVisible = store.createSelector((state): boolean => {
  const rail = state.machineRail;
  if (!rail?.enabled) return false;
  if (rail.machineIds.length > 1) return true;
  return getItems(state.connections.connections).some(
    (connection) => connection.daemonMode !== 'node' && !rail.machineIds.includes(connection.id),
  );
});

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
      own: id === state.connections.windowBackendId,
      offline: record !== null && record.status !== 'connected' && record.status !== 'connecting',
    };
  });
});

export interface MachineRailSettingsRow {
  record: ConnectionRecord;
  /** Whether this window keeps the machine in its rail. */
  inRail: boolean;
  /** The window's own machine: always in the rail. */
  home: boolean;
}

/** Every saved machine a window can show, with whether this window's rail has it. */
export const selectMachineRailSettingsRows = store.createSelector(
  (state): MachineRailSettingsRow[] => {
    // Optional chaining: partial test stores mount Settings without this slice.
    const machineIds = state.machineRail?.machineIds ?? [];
    const homeId = state.machineRail?.homeId ?? '';
    return getItems(state.connections.connections)
      .filter((connection) => connection.daemonMode !== 'node')
      .map((record) => ({
        record,
        inRail: machineIds.includes(record.id),
        home: record.id === homeId,
      }));
  },
);

/** Bumps each time this renderer is asked to open its machine's status menu. */
export const selectRailMenuRequests = store.createSelector(
  (state): number => state.machineRail.menuRequests,
);

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
