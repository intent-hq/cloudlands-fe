import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';

import type { ConnectionRecord } from '$shared/types/connections';
import {
  selectIsRailMachineShown,
  selectMachineRailCandidates,
  selectMachineRailItems,
  selectMachineRailSettingsRows,
  selectMachineRailVisible,
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

function stateWith(
  rail: Partial<typeof initialState>,
  records: ConnectionRecord[],
  windowBackendId = 'local',
) {
  return {
    machineRail: { ...initialState, ...rail },
    connections: {
      connections: createCollection<ConnectionRecord, 'id'>('id', records),
      windowBackendId,
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
      menuRequests: 0,
    });
  });

  it('replaces the state with what main sent', () => {
    const next = { enabled: true, homeId: 'local', machineIds: ['local', 'b'], selectedId: 'b' };
    expect(machineRailReducer(initialState, machineRailStateReceived(next))).toMatchObject(next);
  });
});

describe('machine rail selectors', () => {
  const rail = { enabled: true, homeId: 'local', machineIds: ['local', 'b', 'c'], selectedId: 'b' };

  it('lists machines in rail order with selection, home and offline state', () => {
    const items = selectMachineRailItems.select(
      stateWith(rail, [
        record('local'),
        record('b', { status: 'disconnected' }),
        record('c', { status: 'connecting' }),
      ]),
    );
    expect(
      items.map(({ id, selected, home, offline }) => ({ id, selected, home, offline })),
    ).toEqual([
      { id: 'local', selected: false, home: true, offline: false },
      { id: 'b', selected: true, home: false, offline: true },
      { id: 'c', selected: false, home: false, offline: false },
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

  it('draws the rail only once there is a second machine to switch to or add', () => {
    const alone = { enabled: true, homeId: 'local', machineIds: ['local'], selectedId: 'local' };
    // Only this machine is saved: nothing to switch to.
    expect(selectMachineRailVisible.select(stateWith(alone, [record('local')]))).toBe(false);
    // A node never opens a window, so it does not count.
    expect(
      selectMachineRailVisible.select(
        stateWith(alone, [record('local'), record('node-1', { daemonMode: 'node' })]),
      ),
    ).toBe(false);
    // A second machine saved in Settings: the rail appears with its add control.
    expect(selectMachineRailVisible.select(stateWith(alone, [record('local'), record('b')]))).toBe(
      true,
    );
    // A machine already in this window keeps the rail up.
    expect(
      selectMachineRailVisible.select(
        stateWith({ ...alone, machineIds: ['local', 'b'] }, [record('local'), record('b')]),
      ),
    ).toBe(true);
    // The lab being off always wins.
    expect(
      selectMachineRailVisible.select(
        stateWith({ ...alone, enabled: false }, [record('local'), record('b')]),
      ),
    ).toBe(false);
  });

  it('lists every saved machine for Settings with whether this window has it, never nodes', () => {
    const rows = selectMachineRailSettingsRows.select(
      stateWith({ ...rail, machineIds: ['local', 'b'] }, [
        record('local'),
        record('b'),
        record('c'),
        record('node-1', { daemonMode: 'node' }),
      ]),
    );
    expect(rows.map(({ record: saved, inRail, home }) => ({ id: saved.id, inRail, home }))).toEqual(
      [
        { id: 'local', inRail: true, home: true },
        { id: 'b', inRail: true, home: false },
        { id: 'c', inRail: false, home: false },
      ],
    );
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
