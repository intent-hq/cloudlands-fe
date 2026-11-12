import { describe, expect, it } from 'vitest';

import {
  addRailMachine,
  moveRailMachine,
  normalizeRailSession,
  removeRailMachine,
  reorderRailMachines,
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
        { machineIds: ['b', 'gone', 'b', 7], selectedId: 'b' },
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

describe('reorderRailMachines', () => {
  it('accepts the same machines in another order', () => {
    expect(reorderRailMachines(['local', 'b', 'c'], ['c', 'local', 'b'])).toEqual([
      'c',
      'local',
      'b',
    ]);
  });

  it.each([
    ['a machine is missing', ['local', 'b']],
    ['a machine is not in the rail', ['local', 'b', 'x']],
    ['a machine is repeated', ['local', 'b', 'b']],
  ])('keeps the current order when %s', (_case, requested) => {
    expect(reorderRailMachines(['local', 'b', 'c'], requested)).toEqual(['local', 'b', 'c']);
  });
});

describe('moveRailMachine', () => {
  const rail = ['local', 'b', 'c', 'd'];

  it('drops a machine before or after another', () => {
    expect(moveRailMachine(rail, 'd', 'local', 'before')).toEqual(['d', 'local', 'b', 'c']);
    expect(moveRailMachine(rail, 'local', 'c', 'after')).toEqual(['b', 'c', 'local', 'd']);
    expect(moveRailMachine(rail, 'b', 'c', 'before')).toEqual(rail);
  });

  it('changes nothing for a drop on itself or an unknown machine', () => {
    expect(moveRailMachine(rail, 'b', 'b', 'after')).toEqual(rail);
    expect(moveRailMachine(rail, 'x', 'b', 'after')).toEqual(rail);
    expect(moveRailMachine(rail, 'b', 'x', 'after')).toEqual(rail);
  });
});

describe('normalizeRailSession with a rearranged rail', () => {
  it('keeps the home machine where the user put it', () => {
    expect(
      normalizeRailSession('local', { machineIds: ['b', 'local', 'c'], selectedId: 'b' }, (id) =>
        ['b', 'c'].includes(id),
      ),
    ).toEqual({ machineIds: ['b', 'local', 'c'], selectedId: 'b' });
  });

  it('never drops the home machine to make room when the saved rail is over the cap', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `m${index}`);
    const restored = normalizeRailSession('local', { machineIds: [...ids, 'local'] }, () => true);
    expect(restored.machineIds).toHaveLength(9);
    expect(restored.machineIds).toContain('local');
  });
});
