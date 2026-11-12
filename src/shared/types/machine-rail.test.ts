import { describe, expect, it } from 'vitest';

import {
  addRailMachine,
  nextRailMachine,
  normalizeRailSession,
  removeRailMachine,
} from './machine-rail';

// The documented cap: nine machines per window, the window's own included.
const MACHINE_RAIL_MAX_MACHINES = 9;

describe('addRailMachine', () => {
  it('appends a new machine and leaves a listed one where it is', () => {
    expect(addRailMachine(['local'], 'b')).toEqual(['local', 'b']);
    expect(addRailMachine(['local', 'b', 'c'], 'b')).toEqual(['local', 'b', 'c']);
  });

  it('refuses a machine once the rail is full', () => {
    const full = Array.from({ length: MACHINE_RAIL_MAX_MACHINES }, (_, index) => `m${index}`);
    expect(addRailMachine(full, 'extra')).toEqual(full);
  });
});

describe('removeRailMachine', () => {
  const rail = { homeId: 'local', machineIds: ['local', 'b', 'c'], selectedId: 'b' };

  it('selects the home machine when the shown machine is removed', () => {
    expect(removeRailMachine(rail, 'b')).toEqual({
      machineIds: ['local', 'c'],
      selectedId: 'local',
    });
  });

  it('keeps the selection when another machine is removed', () => {
    expect(removeRailMachine(rail, 'c')).toEqual({ machineIds: ['local', 'b'], selectedId: 'b' });
  });

  it('never removes the home machine', () => {
    expect(removeRailMachine(rail, 'local')).toEqual({
      machineIds: ['local', 'b', 'c'],
      selectedId: 'b',
    });
  });
});

describe('normalizeRailSession', () => {
  const saved = (ids: string[]) => (id: string) => ids.includes(id);

  it('puts home first and restores the saved selection', () => {
    expect(
      normalizeRailSession('local', { machineIds: ['b', 'c'], selectedId: 'c' }, saved(['b', 'c'])),
    ).toEqual({ machineIds: ['local', 'b', 'c'], selectedId: 'c' });
  });

  it('drops forgotten, duplicate and malformed machines', () => {
    expect(
      normalizeRailSession(
        'local',
        { machineIds: ['b', 'gone', 'b', 7, 'local'], selectedId: 'b' },
        saved(['b']),
      ),
    ).toEqual({ machineIds: ['local', 'b'], selectedId: 'b' });
  });

  it('falls back to home when the saved selection is no longer in the rail', () => {
    expect(
      normalizeRailSession('local', { machineIds: ['b'], selectedId: 'gone' }, saved(['b'])),
    ).toEqual({ machineIds: ['local', 'b'], selectedId: 'local' });
  });

  it.each([undefined, null, 'rail', { machineIds: 'b' }])('treats %j as an empty rail', (raw) => {
    expect(normalizeRailSession('remote-1', raw, saved(['b']))).toEqual({
      machineIds: ['remote-1'],
      selectedId: 'remote-1',
    });
  });

  it('caps the restored rail', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `m${index}`);
    const restored = normalizeRailSession('local', { machineIds: ids }, saved(ids));
    expect(restored.machineIds).toHaveLength(MACHINE_RAIL_MAX_MACHINES);
    expect(restored.machineIds[0]).toBe('local');
  });
});

describe('nextRailMachine', () => {
  const guests = new Set(['g1']);
  const isGuest = (id: string) => guests.has(id);

  it('moves to the next machine and loops back to the first', () => {
    expect(nextRailMachine(['local', 'b', 'c'], 'local', isGuest)).toBe('b');
    expect(nextRailMachine(['local', 'b', 'c'], 'c', isGuest)).toBe('local');
  });

  it('skips guest hosts, also when one is shown', () => {
    expect(nextRailMachine(['local', 'g1', 'b'], 'local', isGuest)).toBe('b');
    expect(nextRailMachine(['local', 'b', 'g1'], 'g1', isGuest)).toBe('local');
  });

  it('has nowhere to go without another own machine', () => {
    expect(nextRailMachine(['local', 'g1'], 'local', isGuest)).toBeNull();
    expect(nextRailMachine(['local'], 'local', isGuest)).toBeNull();
  });
});
