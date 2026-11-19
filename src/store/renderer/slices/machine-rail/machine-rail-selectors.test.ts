import { describe, expect, it } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import type { ConnectionRecord } from '$shared/types/connections';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import type { MachineRailState } from '$shared/types/machine-rail';
import type { StoreState } from '../../types';
import { selectMachineRailShown, selectOpensInMachineRail } from './machine-rail-selectors';

function connection(id: string, extra: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
    id,
    label: id,
    host: id === 'local' ? null : '10.0.0.1',
    port: id === 'local' ? null : 5181,
    fingerprint: null,
    isLocal: id === 'local',
    ...extra,
  };
}

function state(rail: Partial<MachineRailState>): StoreState {
  return {
    machineRail: {
      enabled: true,
      machineIds: ['local'],
      selectedId: 'local',
      shownId: 'local',
      pendingId: '',
      degradedIds: [],
      ...rail,
    },
    connections: {
      windowBackendId: 'local',
      connections: createCollection<ConnectionRecord, 'id'>('id', [
        connection('local'),
        connection('b'),
        connection('node', { daemonMode: 'node' }),
        connection('shown-only', { displayOnly: true }),
      ]),
    },
    guestSessions: {
      sessions: createCollection<GuestSessionRecord, 'id'>('id', [
        { id: 'g1', label: 'g1.example:5181' } as GuestSessionRecord,
      ]),
    },
  } as unknown as StoreState;
}

describe('selectMachineRailShown', () => {
  it('hides the rail while the window holds a single machine', () => {
    expect(selectMachineRailShown.select(state({ machineIds: ['local'] }))).toBe(false);
  });

  it('shows the rail once the window holds a second machine, a guest host included', () => {
    expect(selectMachineRailShown.select(state({ machineIds: ['local', 'b'] }))).toBe(true);
    expect(selectMachineRailShown.select(state({ machineIds: ['local', 'g1'] }))).toBe(true);
  });

  it('never shows the rail while it is turned off', () => {
    expect(
      selectMachineRailShown.select(state({ enabled: false, machineIds: ['local', 'b'] })),
    ).toBe(false);
  });
});

describe('selectOpensInMachineRail', () => {
  it('adds a saved machine or a guest host that is not in the rail yet', () => {
    expect(selectOpensInMachineRail.select(state({}), 'b')).toBe(true);
    expect(selectOpensInMachineRail.select(state({}), 'g1')).toBe(true);
  });

  it('keeps the usual open for a machine already in the rail', () => {
    expect(selectOpensInMachineRail.select(state({ machineIds: ['local', 'b'] }), 'b')).toBe(false);
    expect(selectOpensInMachineRail.select(state({}), 'local')).toBe(false);
  });

  it('keeps the usual open for a machine a rail cannot hold, or one it does not know', () => {
    expect(selectOpensInMachineRail.select(state({}), 'node')).toBe(false);
    expect(selectOpensInMachineRail.select(state({}), 'shown-only')).toBe(false);
    expect(selectOpensInMachineRail.select(state({}), 'gone')).toBe(false);
  });

  it('keeps the usual open while the rail is turned off', () => {
    expect(selectOpensInMachineRail.select(state({ enabled: false }), 'b')).toBe(false);
  });
});
