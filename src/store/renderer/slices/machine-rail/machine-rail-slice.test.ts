import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';

import type { ConnectionRecord } from '$shared/types/connections';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import {
  selectIsRailMachineShown,
  selectMachineRailCandidates,
  selectMachineRailGuestCandidates,
  selectMachineRailItems,
} from './machine-rail-selectors';
import { machineRailReducer, machineRailStateReceived } from './machine-rail-slice';

const initialState = machineRailReducer(undefined, { type: '@@INIT' } as never);

function record(id: string, extra: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
    id,
    label: id,
    host: id === 'local' ? null : '10.0.0.1',
    port: id === 'local' ? null : 5181,
    fingerprint: null,
    isLocal: id === 'local',
    status: 'connected',
    ...extra,
  };
}

function guest(id: string): GuestSessionRecord {
  return { id, label: `${id}.example:5181`, hostname: id } as GuestSessionRecord;
}

function stateWith(
  rail: Partial<typeof initialState>,
  records: ConnectionRecord[],
  windowBackendId = 'local',
  guests: { sessions: GuestSessionRecord[]; connectedIds: string[] } = {
    sessions: [],
    connectedIds: [],
  },
) {
  return {
    machineRail: { ...initialState, ...rail },
    connections: {
      connections: createCollection<ConnectionRecord, 'id'>('id', records),
      windowBackendId,
    },
    guestSessions: {
      sessions: createCollection<GuestSessionRecord, 'id'>('id', guests.sessions),
      connectedIds: guests.connectedIds,
    },
  } as any;
}

describe('machineRailReducer', () => {
  it('starts with the lab off and no machines', () => {
    expect(machineRailReducer(undefined, { type: '@@INIT' })).toEqual({
      enabled: false,
      homeId: '',
      machineIds: [],
      selectedId: '',
      shownId: '',
      pendingId: '',
      degradedIds: [],
    });
  });

  it('replaces the state with what main sent', () => {
    const next = {
      enabled: true,
      homeId: 'local',
      machineIds: ['local', 'b'],
      selectedId: 'b',
      shownId: 'local',
      pendingId: '',
      degradedIds: [],
    };
    expect(machineRailReducer(initialState, machineRailStateReceived(next))).toMatchObject(next);
  });
});

describe('machine rail selectors', () => {
  const rail = { enabled: true, homeId: 'local', machineIds: ['local', 'b', 'c'], selectedId: 'b' };

  it('lists machines in rail order with selection, home and offline state; still connecting is offline', () => {
    const items = selectMachineRailItems.select(
      stateWith(
        rail,
        [
          record('local'),
          record('b', { status: 'disconnected' }),
          record('c', { status: 'connecting' }),
        ],
        'b',
      ),
    );
    expect(
      items.map(({ id, selected, home, offline }) => ({ id, selected, home, offline })),
    ).toEqual([
      { id: 'local', selected: false, home: true, offline: false },
      { id: 'b', selected: true, home: false, offline: true },
      { id: 'c', selected: false, home: false, offline: true },
    ]);
  });

  it("draws a hidden machine's rail as it will look once shown: its own machine selected, not spinning", () => {
    // `c` is still starting while `b` is shown: `c`'s own renderer is hidden.
    const state = { ...rail, pendingId: 'c' };
    const records = [record('local'), record('b'), record('c')];
    const own = selectMachineRailItems.select(stateWith(state, records, 'c'));
    expect(own.map(({ id, selected, pending }) => ({ id, selected, pending }))).toEqual([
      { id: 'local', selected: false, pending: false },
      { id: 'b', selected: false, pending: false },
      { id: 'c', selected: true, pending: false },
    ]);
    // The rail on screen (b's) shows b selected and c spinning.
    const shown = selectMachineRailItems.select(stateWith(state, records, 'b'));
    expect(shown.map(({ id, selected, pending }) => ({ id, selected, pending }))).toEqual([
      { id: 'local', selected: false, pending: false },
      { id: 'b', selected: true, pending: false },
      { id: 'c', selected: false, pending: true },
    ]);
  });

  it('treats a machine whose connection was never opened as offline', () => {
    const [, b] = selectMachineRailItems.select(
      stateWith(rail, [record('local'), record('b', { status: 'not-open' })]),
    );
    expect(b.offline).toBe(true);
  });

  it('offers saved machines that are not in the rail and never nodes', () => {
    const candidates = selectMachineRailCandidates.select(
      stateWith({ ...rail, machineIds: ['local', 'b'] }, [
        record('local'),
        record('b'),
        record('c'),
        record('node-1', { daemonMode: 'node' }),
      ]),
    );
    expect(candidates.map((candidate) => candidate.id)).toEqual(['c']);
  });

  it('lists guest hosts after your own machines, whatever order they were added in', () => {
    const items = selectMachineRailItems.select(
      stateWith(
        { ...rail, machineIds: ['local', 'g1', 'b', 'g2'], selectedId: 'local', pendingId: 'g2' },
        [record('local'), record('b')],
        'local',
        { sessions: [guest('g1'), guest('g2')], connectedIds: ['g1'] },
      ),
    );
    expect(items.map(({ id, guest, status }) => ({ id, guest: !!guest, status }))).toEqual([
      { id: 'local', guest: false, status: 'connected' },
      { id: 'b', guest: false, status: 'connected' },
      { id: 'g1', guest: true, status: 'connected' },
      { id: 'g2', guest: true, status: 'connecting' },
    ]);
  });

  it('offers guest hosts that are not in the rail', () => {
    const candidates = selectMachineRailGuestCandidates.select(
      stateWith({ ...rail, machineIds: ['local', 'g1'] }, [record('local')], 'local', {
        sessions: [guest('g1'), guest('g2')],
        connectedIds: [],
      }),
    );
    expect(candidates.map((candidate) => candidate.id)).toEqual(['g2']);
  });

  it('marks only the renderer of the selected machine as shown', () => {
    expect(selectIsRailMachineShown.select(stateWith(rail, [], 'b'))).toBe(true);
    expect(selectIsRailMachineShown.select(stateWith(rail, [], 'local'))).toBe(false);
  });

  it('keeps a renderer shown while the lab is off or before main answered', () => {
    expect(selectIsRailMachineShown.select(stateWith({ ...rail, enabled: false }, []))).toBe(true);
    expect(selectIsRailMachineShown.select(stateWith({}, []))).toBe(true);
  });
});
