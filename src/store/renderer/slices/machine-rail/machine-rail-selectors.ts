import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { ConnectionRecord, ConnectionWorkflow } from '../connections/connections-types';
import type { GuestSessionRecord } from '../guest-sessions/guest-sessions-types';
import { nextRailMachine } from '$shared/types/machine-rail';
import { canRequestDeviceUpdate } from '$lib/utils/device-update-eligibility';
import { connectionShellTintColor } from '$lib/utils/connection-accents';

export type MachineRailItemStatus = 'connected' | 'connecting' | 'disconnected';

export interface MachineRailItem {
  id: string;
  /** The saved machine; absent until the connections list knows this id. */
  record: ConnectionRecord | null;
  /** The host this window joined as a guest, when the item is one. */
  guest: GuestSessionRecord | null;
  selected: boolean;
  /** The machine this renderer serves; its status menu opens from this item. */
  own: boolean;
  status: MachineRailItemStatus;
  /** Not connected (yet) right now: shown greyed out. */
  offline: boolean;
  /** Connected, but its daemon reports degraded health: marked with a warning dot. */
  degraded: boolean;
  /** Its daemon is behind this app and can be updated from here: marked with a badge. */
  updatable: boolean;
  /** An update the rail started for it is still running. */
  updating: boolean;
  /** Asked for and still starting: its item spins until it is shown. */
  pending: boolean;
}

/** The connection workflow that tracks an update the rail started for `id`. */
export function railUpdateConsumerId(id: string): string {
  return `machine-rail:update:${id}`;
}

function isRailUpdateRunning(
  workflows: Collection<ConnectionWorkflow, 'id'> | undefined,
  id: string,
) {
  const workflow = workflows ? getItem(workflows, railUpdateConsumerId(id)) : undefined;
  return !!workflow && workflow.phase !== 'settled';
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
  const { machineIds, selectedId, pendingId, degradedIds } = state.machineRail;
  const own = state.connections.windowBackendId;
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
      // A renderer's rail is only seen while its own machine is shown, so it
      // is drawn that way even while hidden: no stale selection or spinner
      // flashes when it comes on screen.
      selected: own ? id === own : id === selectedId,
      own: id === own,
      status,
      // Dimmed until connected: a machine that cannot be reached can stay
      // "connecting" for a long time (startup connects every rail machine).
      offline: record !== null || guest !== null ? status !== 'connected' : false,
      degraded: status === 'connected' && degradedIds.includes(id),
      updatable:
        record !== null &&
        canRequestDeviceUpdate(
          record,
          state.connections.connectedIds,
          state.connections.pinnedVersion,
        ),
      updating: isRailUpdateRunning(state.connections.workflows, id),
      pending: id === pendingId && id !== own,
    };
  });
  return [...items.filter((item) => !item.guest), ...items.filter((item) => item.guest)];
});

/** Saved machines that can still be added to this window's rail. */
export const selectMachineRailCandidates = store.createSelector((state): ConnectionRecord[] => {
  const inRail = new Set(state.machineRail.machineIds);
  return getItems(state.connections.connections).filter(
    (connection) =>
      !connection.displayOnly && connection.daemonMode !== 'node' && !inRail.has(connection.id),
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

/** What this renderer's machine paints under it as the frame's backdrop while it is shown. */
export interface RailBackdropInputs {
  enabled: boolean;
  /** This machine's accent tint (`transparent` when it has none). */
  tint: string;
  /** Shell transparency is off: the backdrop is the opaque shell colour. */
  opaque: boolean;
  /** Changes whenever the theme does, so the colours are resolved again. */
  theme: string;
}

let lastBackdropInputs: RailBackdropInputs | null = null;

/** {@link RailBackdropInputs}, the same object until one of them changes. */
export const selectRailBackdropInputs = store.createSelector((state): RailBackdropInputs => {
  const record = getItem(state.connections.connections, state.connections.windowBackendId);
  const next: RailBackdropInputs = {
    enabled: state.machineRail?.enabled ?? false,
    tint: connectionShellTintColor(record?.accent, record?.isLocal ?? true),
    opaque: !(state.userPreferences?.shellTransparencyEnabled ?? true),
    theme: `${state.theme?.name}:${state.theme?.activePresetId}:${state.theme?.hasCustomTheme}`,
  };
  const last = lastBackdropInputs;
  if (
    last &&
    last.enabled === next.enabled &&
    last.tint === next.tint &&
    last.opaque === next.opaque &&
    last.theme === next.theme
  ) {
    return last;
  }
  lastBackdropInputs = next;
  return next;
});
