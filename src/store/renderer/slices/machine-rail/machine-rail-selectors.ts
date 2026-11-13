import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { ConnectionRecord } from '../connections/connections-types';
import type { GuestSessionRecord } from '../guest-sessions/guest-sessions-types';
import { nextRailMachine } from '$shared/types/machine-rail';

export type MachineRailItemStatus = 'connected' | 'connecting' | 'disconnected';

export interface MachineRailItem {
  id: string;
  /** The saved machine; absent until the connections list knows this id. */
  record: ConnectionRecord | null;
  /** The host this window joined as a guest, when the item is one. */
  guest: GuestSessionRecord | null;
  selected: boolean;
  /** The machine the window itself is bound to; it cannot be removed. */
  home: boolean;
  /** The machine this renderer serves; its status menu opens from this item. */
  own: boolean;
  status: MachineRailItemStatus;
  /** Not connected (yet) right now: shown greyed out. */
  offline: boolean;
  /** Connected, but its daemon reports degraded health: marked with a warning dot. */
  degraded: boolean;
  /** Asked for and still starting: its item spins until it is shown. */
  pending: boolean;
}

/** Whether the Labs setting is on (the rail shows, even with one machine). */
export const selectMachineRailEnabled = store.createSelector(
  // Optional chaining: partial test stores mount shell components without this slice.
  (state): boolean => state.machineRail?.enabled ?? false,
);

/**
 * The window's machines in rail order, joined with their saved records: the
 * user's own machines first, then the hosts joined as a guest.
 */
export const selectMachineRailItems = store.createSelector((state): MachineRailItem[] => {
  const { machineIds, selectedId, homeId, pendingId, degradedIds } = state.machineRail;
  const items = machineIds.map((id): MachineRailItem => {
    const record = getItem(state.connections.connections, id) ?? null;
    const guest = record ? null : (getItem(state.guestSessions.sessions, id) ?? null);
    const status: MachineRailItemStatus = guest
      ? state.guestSessions.connectedIds.includes(id)
        ? 'connected'
        : id === pendingId
          ? 'connecting'
          : 'disconnected'
      : !record || record.status === 'connecting'
        ? 'connecting'
        : record.status === 'connected'
          ? 'connected'
          : 'disconnected';
    return {
      id,
      record,
      guest,
      selected: id === selectedId,
      home: id === homeId,
      own: id === state.connections.windowBackendId,
      status,
      // Dimmed until connected: a machine that cannot be reached can stay
      // "connecting" for a long time (startup connects every rail machine).
      offline: record !== null || guest !== null ? status !== 'connected' : false,
      degraded: status === 'connected' && degradedIds.includes(id),
      pending: id === pendingId,
    };
  });
  return [...items.filter((item) => !item.guest), ...items.filter((item) => item.guest)];
});

/** Saved machines that can still be added to this window's rail. */
export const selectMachineRailCandidates = store.createSelector((state): ConnectionRecord[] => {
  const inRail = new Set(state.machineRail.machineIds);
  return getItems(state.connections.connections).filter(
    (connection) => connection.daemonMode !== 'node' && !inRail.has(connection.id),
  );
});

/**
 * Where the hardware window-cycle key goes: the next own machine in the rail
 * (guest hosts skipped, looping), `''` when there is no other, `null` while
 * the rail is off (the key cycles windows then).
 */
export const selectNextRailMachine = store.createSelector((state): string | null => {
  const rail = state.machineRail;
  if (!rail?.enabled) return null;
  const isGuest = (id: string) =>
    !getItem(state.connections.connections, id) &&
    !!state.guestSessions &&
    getItem(state.guestSessions.sessions, id) !== undefined;
  return nextRailMachine(rail.machineIds, rail.selectedId, isGuest) ?? '';
});

/** Guest hosts that can still be added to this window's rail. */
export const selectMachineRailGuestCandidates = store.createSelector(
  (state): GuestSessionRecord[] => {
    const inRail = new Set(state.machineRail.machineIds);
    return getItems(state.guestSessions.sessions).filter((session) => !inRail.has(session.id));
  },
);

/** Whether this renderer's machine is the one the window shows (or is switching to). */
export const selectIsRailMachineShown = store.createSelector((state): boolean => {
  const { enabled, selectedId } = state.machineRail;
  return !enabled || selectedId === '' || selectedId === state.connections.windowBackendId;
});

/**
 * Whether this is the window's own renderer, which sits under every other
 * machine's and paints the shell background they all share.
 */
export const selectIsRailHomeRenderer = store.createSelector((state): boolean => {
  const { enabled, homeId } = state.machineRail;
  return enabled && homeId !== '' && homeId === state.connections.windowBackendId;
});

/**
 * Whether the window's own renderer hides its page because another machine
 * is on screen; otherwise it would show through that machine's translucent
 * shell. Other machines' renderers never hide: main hides their views, and
 * one that is about to be shown must already have its page painted.
 */
export const selectIsRailPageHidden = store.createSelector((state): boolean => {
  const { enabled, homeId, selectedId, shownId } = state.machineRail;
  const own = state.connections.windowBackendId;
  return enabled && homeId === own && selectedId !== own && shownId !== own;
});

/** The machine the window shows, for its accent tint. */
export const selectRailSelectedRecord = store.createSelector(
  (state): ConnectionRecord | null =>
    getItem(state.connections.connections, state.machineRail.selectedId) ?? null,
);
